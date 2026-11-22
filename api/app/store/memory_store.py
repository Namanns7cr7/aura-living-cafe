from __future__ import annotations

import copy
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.eta import estimate_pickup_eta
from app.services.inventory import aggregate_cart_requirements, compute_available_units
from app.services.seed import (
    build_seed_demo_state,
    build_seed_historical_orders,
    build_seed_ingredients,
    build_seed_menu,
    build_seed_sessions,
    build_seed_tables,
)
from app.store.base import (
    CafeStore,
    DomainConflictError,
    DomainNotFoundError,
    DomainValidationError,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None = None) -> str:
    return (dt or _now()).isoformat()


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


VALID_TRANSITIONS: dict[str, set[str]] = {
    "confirmed": {"preparing", "ready", "cancelled"},
    "preparing": {"ready", "cancelled"},
    "ready": {"collected"},
    "collected": set(),
    "cancelled": set(),
}


class MemoryCafeStore(CafeStore):
    """Thread-safe transactional local store matching Cloud Firestore invariants."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._cafes: dict[str, dict[str, Any]] = {}

    def _bucket(self, cafe_id: str) -> dict[str, Any]:
        if cafe_id not in self._cafes:
            self._cafes[cafe_id] = {
                "menuItems": {},
                "ingredients": {},
                "orders": {},
                "orderEvents": [],
                "inventoryEvents": [],
                "tables": {},
                "reservations": {},
                "sessions": {},
                "preferences": {},
                "recommendations": {},
                "demoState": build_seed_demo_state(cafe_id),
            }
        return self._cafes[cafe_id]

    def _expire_stale_reservations_locked(self, cafe_id: str) -> None:
        bucket = self._bucket(cafe_id)
        now = _now()
        for table in bucket["tables"].values():
            if table["status"] == "reserved":
                exp = _parse_iso(table.get("reservationExpiresAt"))
                if exp is not None and exp <= now:
                    res_id = table.get("reservationId")
                    if res_id and res_id in bucket["reservations"]:
                        bucket["reservations"][res_id]["state"] = "expired"
                    table["status"] = "free"
                    table["reservationId"] = None
                    table["reservedByUserId"] = None
                    table["reservationExpiresAt"] = None
                    table["updatedAt"] = _iso(now)

    def seed_cafe(self, cafe_id: str, reset: bool = False) -> dict[str, int]:
        with self._lock:
            if reset and cafe_id in self._cafes:
                del self._cafes[cafe_id]
            bucket = self._bucket(cafe_id)

            for ing in build_seed_ingredients():
                bucket["ingredients"].setdefault(ing["id"], copy.deepcopy(ing))
            for item in build_seed_menu():
                bucket["menuItems"].setdefault(item["id"], copy.deepcopy(item))
            for tbl in build_seed_tables():
                bucket["tables"].setdefault(tbl["id"], copy.deepcopy(tbl))
            for ord_doc in build_seed_historical_orders(cafe_id):
                bucket["orders"].setdefault(ord_doc["id"], copy.deepcopy(ord_doc))
            for sess in build_seed_sessions(cafe_id):
                bucket["sessions"].setdefault(sess["id"], copy.deepcopy(sess))
            if reset or not bucket.get("demoState"):
                bucket["demoState"] = build_seed_demo_state(cafe_id)

            return {
                "menuItems": len(bucket["menuItems"]),
                "ingredients": len(bucket["ingredients"]),
                "tables": len(bucket["tables"]),
                "orders": len(bucket["orders"]),
                "sessions": len(bucket["sessions"]),
            }

    def list_menu_items(self, cafe_id: str) -> list[dict[str, Any]]:
        with self._lock:
            bucket = self._bucket(cafe_id)
            return copy.deepcopy(list(bucket["menuItems"].values()))

    def get_menu_item(self, cafe_id: str, item_id: str) -> dict[str, Any] | None:
        with self._lock:
            item = self._bucket(cafe_id)["menuItems"].get(item_id)
            return copy.deepcopy(item) if item else None

    def set_menu_item_active(self, cafe_id: str, item_id: str, active: bool) -> dict[str, Any]:
        with self._lock:
            items = self._bucket(cafe_id)["menuItems"]
            if item_id not in items:
                raise DomainNotFoundError(f"Menu item '{item_id}' not found")
            items[item_id]["active"] = bool(active)
            return copy.deepcopy(items[item_id])

    def list_ingredients(self, cafe_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return copy.deepcopy(list(self._bucket(cafe_id)["ingredients"].values()))

    def get_ingredient(self, cafe_id: str, ingredient_id: str) -> dict[str, Any] | None:
        with self._lock:
            ing = self._bucket(cafe_id)["ingredients"].get(ingredient_id)
            return copy.deepcopy(ing) if ing else None

    def adjust_ingredient_tx(
        self,
        cafe_id: str,
        ingredient_id: str,
        delta_on_hand: int,
        actor_id: str,
        reason: str,
        expected_version: int | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        with self._lock:
            bucket = self._bucket(cafe_id)
            ing = bucket["ingredients"].get(ingredient_id)
            if not ing:
                raise DomainNotFoundError(f"Ingredient '{ingredient_id}' not found")
            if expected_version is not None and int(ing["version"]) != int(expected_version):
                raise DomainConflictError(
                    "Ingredient stock was updated concurrently. Refresh and retry.",
                    code="version_conflict",
                )
            new_on_hand = int(ing["onHand"]) + int(delta_on_hand)
            if new_on_hand < 0:
                raise DomainValidationError(
                    f"Stock adjustment rejected: on-hand quantity for '{ing['name']}' cannot be negative.",
                    code="negative_inventory",
                )
            if new_on_hand < int(ing["reserved"]):
                raise DomainValidationError(
                    f"Stock adjustment rejected: on-hand ({new_on_hand}) cannot drop below reserved ({ing['reserved']}).",
                    code="below_reserved",
                )

            now_iso = _iso()
            ing["onHand"] = new_on_hand
            ing["version"] = int(ing["version"]) + 1
            ing["updatedAt"] = now_iso

            ev = {
                "id": f"invev_{uuid.uuid4().hex[:12]}",
                "cafeId": cafe_id,
                "ingredientId": ingredient_id,
                "ingredientName": ing["name"],
                "deltaOnHand": int(delta_on_hand),
                "deltaReserved": 0,
                "eventType": "restock" if delta_on_hand >= 0 else "adjust",
                "orderId": None,
                "actorId": actor_id,
                "reason": reason,
                "at": now_iso,
            }
            bucket["inventoryEvents"].append(ev)
            return copy.deepcopy(ing), copy.deepcopy(ev)

    def confirm_order_tx(
        self,
        cafe_id: str,
        user_id: str,
        customer_name: str,
        cart_items: list[dict[str, Any]],
        idempotency_key: str,
        table_id: str | None = None,
        notes: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        with self._lock:
            bucket = self._bucket(cafe_id)
            self._expire_stale_reservations_locked(cafe_id)

            # 1. Idempotency check
            for existing in bucket["orders"].values():
                if existing["userId"] == user_id and existing["idempotencyKey"] == idempotency_key:
                    return copy.deepcopy(existing), True

            # 2. Validate recipes, modifiers & prices
            try:
                total_reqs, snapshots, total_paise = aggregate_cart_requirements(cart_items, bucket["menuItems"])
            except ValueError as exc:
                raise DomainValidationError(str(exc), code="invalid_cart") from exc

            # 3. Verify ingredient availability atomically
            shortages = []
            for iid, req_qty in total_reqs.items():
                ing = bucket["ingredients"].get(iid)
                if not ing:
                    shortages.append({"ingredientId": iid, "name": iid, "available": 0, "required": req_qty})
                    continue
                avail = compute_available_units(ing)
                if avail < req_qty:
                    shortages.append(
                        {
                            "ingredientId": iid,
                            "name": ing["name"],
                            "available": avail,
                            "required": req_qty,
                            "unit": ing["unit"],
                        }
                    )
            if shortages:
                first = shortages[0]
                raise DomainConflictError(
                    f"Just sold out: insufficient {first['name']} ({first['available']} available, {first['required']} needed).",
                    code="insufficient_stock",
                    details={"shortages": shortages},
                )

            # 4. Validate optional table reservation atomically
            reservation_id: str | None = None
            now_dt = _now()
            now_iso = _iso(now_dt)
            if table_id:
                tbl = bucket["tables"].get(table_id)
                if not tbl:
                    raise DomainNotFoundError(f"Table '{table_id}' does not exist")
                if tbl["status"] == "occupied":
                    raise DomainConflictError(f"Table '{tbl['label']}' is currently occupied.", code="table_unavailable")
                if tbl["status"] == "reserved":
                    if tbl.get("reservedByUserId") != user_id:
                        raise DomainConflictError(
                            f"Table '{tbl['label']}' was just reserved by another guest.",
                            code="table_unavailable",
                        )
                    reservation_id = tbl.get("reservationId")
                else:
                    reservation_id = f"res_{uuid.uuid4().hex[:10]}"
                    exp_iso = _iso(now_dt + timedelta(minutes=60))
                    tbl["status"] = "reserved"
                    tbl["reservationId"] = reservation_id
                    tbl["reservedByUserId"] = user_id
                    tbl["reservationExpiresAt"] = exp_iso
                    tbl["updatedAt"] = now_iso
                    bucket["reservations"][reservation_id] = {
                        "id": reservation_id,
                        "cafeId": cafe_id,
                        "tableId": table_id,
                        "userId": user_id,
                        "expiresAt": exp_iso,
                        "state": "active",
                        "createdAt": now_iso,
                    }

            # 5. Reserve ingredients atomically
            order_id = f"ord_{uuid.uuid4().hex[:10]}"
            for iid, req_qty in total_reqs.items():
                ing = bucket["ingredients"][iid]
                ing["reserved"] = int(ing["reserved"]) + int(req_qty)
                ing["version"] = int(ing["version"]) + 1
                ing["updatedAt"] = now_iso
                bucket["inventoryEvents"].append(
                    {
                        "id": f"invev_{uuid.uuid4().hex[:12]}",
                        "cafeId": cafe_id,
                        "ingredientId": iid,
                        "ingredientName": ing["name"],
                        "deltaOnHand": 0,
                        "deltaReserved": int(req_qty),
                        "eventType": "reserve",
                        "orderId": order_id,
                        "actorId": user_id,
                        "reason": f"Reserved for order {order_id}",
                        "at": now_iso,
                    }
                )

            # 6. Deterministic ETA calculation
            order_work_units = sum(
                int(bucket["menuItems"][s["menuItemId"]]["prepWorkUnits"]) * int(s["qty"])
                for s in snapshots
            )
            eta = estimate_pickup_eta(
                order_work_units=order_work_units,
                active_orders=list(bucket["orders"].values()),
                menu_by_id=bucket["menuItems"],
                demo_state=bucket["demoState"],
            )

            order_doc = {
                "id": order_id,
                "cafeId": cafe_id,
                "userId": user_id,
                "customerName": customer_name,
                "items": snapshots,
                "totalPaise": total_paise,
                "status": "confirmed",
                "estimatedReadyAt": eta["estimatedReadyAt"],
                "etaMinMinutes": eta["minMinutes"],
                "etaMaxMinutes": eta["maxMinutes"],
                "tableId": table_id,
                "reservationId": reservation_id,
                "idempotencyKey": idempotency_key,
                "consumedAt": None,
                "cancelledAt": None,
                "notes": notes,
                "createdAt": now_iso,
                "updatedAt": now_iso,
            }
            bucket["orders"][order_id] = order_doc
            bucket["orderEvents"].append(
                {
                    "id": f"ordev_{uuid.uuid4().hex[:12]}",
                    "cafeId": cafe_id,
                    "orderId": order_id,
                    "fromStatus": None,
                    "toStatus": "confirmed",
                    "actorId": user_id,
                    "actorRole": "customer",
                    "at": now_iso,
                    "reason": "Order confirmed and ingredients reserved",
                }
            )
            return copy.deepcopy(order_doc), False

    def transition_order_tx(
        self,
        cafe_id: str,
        order_id: str,
        target_status: str,
        actor_id: str,
        actor_role: str,
        reason: str,
    ) -> dict[str, Any]:
        with self._lock:
            bucket = self._bucket(cafe_id)
            order = bucket["orders"].get(order_id)
            if not order:
                raise DomainNotFoundError(f"Order '{order_id}' not found")

            current = order["status"]
            if target_status == current:
                raise DomainConflictError(
                    f"Order '{order_id}' is already in status '{current}'. Duplicate transition ignored.",
                    code="duplicate_transition",
                )
            if target_status not in VALID_TRANSITIONS.get(current, set()):
                raise DomainConflictError(
                    f"Cannot transition order from '{current}' to '{target_status}'.",
                    code="invalid_transition",
                )

            now_iso = _iso()

            # Aggregate order recipe quantities from immutable order snapshot
            order_ing_totals: dict[str, int] = {}
            for snap in order.get("items", []):
                qty = int(snap["qty"])
                for req in snap.get("recipeSnapshot", []):
                    iid = req["ingredientId"]
                    order_ing_totals[iid] = order_ing_totals.get(iid, 0) + int(req["qty"]) * qty

            # Exactly-once consumption on transition to 'ready' ONLY (with consumedAt guard)
            if target_status == "ready" and order.get("consumedAt") is None:
                for iid, req_qty in order_ing_totals.items():
                    ing = bucket["ingredients"].get(iid)
                    if not ing:
                        continue
                    new_on_hand = int(ing["onHand"]) - req_qty
                    new_reserved = int(ing["reserved"]) - req_qty
                    if new_on_hand < 0 or new_reserved < 0:
                        raise DomainConflictError(
                            f"Inventory invariant guard triggered for '{ing['name']}'.",
                            code="inventory_invariant_error",
                        )
                    ing["onHand"] = new_on_hand
                    ing["reserved"] = new_reserved
                    ing["version"] = int(ing["version"]) + 1
                    ing["updatedAt"] = now_iso
                    bucket["inventoryEvents"].append(
                        {
                            "id": f"invev_{uuid.uuid4().hex[:12]}",
                            "cafeId": cafe_id,
                            "ingredientId": iid,
                            "ingredientName": ing["name"],
                            "deltaOnHand": -req_qty,
                            "deltaReserved": -req_qty,
                            "eventType": "consume",
                            "orderId": order_id,
                            "actorId": actor_id,
                            "reason": "Consumed once on order ready",
                            "at": now_iso,
                        }
                    )
                order["consumedAt"] = now_iso

            # Cancellation handling: release reservation if not yet consumed; else waste policy (no silent rollback)
            if target_status == "cancelled":
                order["cancelledAt"] = now_iso
                if order.get("consumedAt") is None:
                    for iid, req_qty in order_ing_totals.items():
                        ing = bucket["ingredients"].get(iid)
                        if not ing:
                            continue
                        ing["reserved"] = max(0, int(ing["reserved"]) - req_qty)
                        ing["version"] = int(ing["version"]) + 1
                        ing["updatedAt"] = now_iso
                        bucket["inventoryEvents"].append(
                            {
                                "id": f"invev_{uuid.uuid4().hex[:12]}",
                                "cafeId": cafe_id,
                                "ingredientId": iid,
                                "ingredientName": ing["name"],
                                "deltaOnHand": 0,
                                "deltaReserved": -req_qty,
                                "eventType": "release",
                                "orderId": order_id,
                                "actorId": actor_id,
                                "reason": f"Reservation released on pre-prep cancel: {reason}",
                                "at": now_iso,
                            }
                        )
                else:
                    reason = f"{reason} (Post-preparation cancel: ingredients already consumed per café waste policy)"

                # Release table reservation if linked
                res_id = order.get("reservationId")
                tbl_id = order.get("tableId")
                if tbl_id and tbl_id in bucket["tables"]:
                    tbl = bucket["tables"][tbl_id]
                    if tbl.get("reservationId") == res_id and tbl["status"] == "reserved":
                        tbl["status"] = "free"
                        tbl["reservationId"] = None
                        tbl["reservedByUserId"] = None
                        tbl["reservationExpiresAt"] = None
                        tbl["updatedAt"] = now_iso
                if res_id and res_id in bucket["reservations"]:
                    bucket["reservations"][res_id]["state"] = "released"

            order["status"] = target_status
            order["updatedAt"] = now_iso
            bucket["orderEvents"].append(
                {
                    "id": f"ordev_{uuid.uuid4().hex[:12]}",
                    "cafeId": cafe_id,
                    "orderId": order_id,
                    "fromStatus": current,
                    "toStatus": target_status,
                    "actorId": actor_id,
                    "actorRole": actor_role,
                    "at": now_iso,
                    "reason": reason,
                }
            )
            return copy.deepcopy(order)

    def get_order(self, cafe_id: str, order_id: str) -> dict[str, Any] | None:
        with self._lock:
            o = self._bucket(cafe_id)["orders"].get(order_id)
            return copy.deepcopy(o) if o else None

    def list_orders(self, cafe_id: str, user_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            orders = list(self._bucket(cafe_id)["orders"].values())
            if user_id is not None:
                orders = [o for o in orders if o["userId"] == user_id]
            orders.sort(key=lambda x: x["createdAt"], reverse=True)
            return copy.deepcopy(orders)

    def list_order_events(self, cafe_id: str, order_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            events = self._bucket(cafe_id)["orderEvents"]
            if order_id is not None:
                events = [e for e in events if e["orderId"] == order_id]
            return copy.deepcopy(list(reversed(events)))

    def list_inventory_events(self, cafe_id: str, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            events = self._bucket(cafe_id)["inventoryEvents"]
            return copy.deepcopy(list(reversed(events[-limit:])))

    def list_tables(self, cafe_id: str) -> list[dict[str, Any]]:
        with self._lock:
            self._expire_stale_reservations_locked(cafe_id)
            return copy.deepcopy(list(self._bucket(cafe_id)["tables"].values()))

    def reserve_table_tx(
        self,
        cafe_id: str,
        table_id: str,
        user_id: str,
        duration_minutes: int = 45,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        with self._lock:
            bucket = self._bucket(cafe_id)
            self._expire_stale_reservations_locked(cafe_id)
            tbl = bucket["tables"].get(table_id)
            if not tbl:
                raise DomainNotFoundError(f"Table '{table_id}' not found")
            if tbl["status"] != "free":
                raise DomainConflictError(
                    f"Table '{tbl['label']}' is currently {tbl['status']} and cannot be booked.",
                    code="table_unavailable",
                )
            now_dt = _now()
            now_iso = _iso(now_dt)
            exp_iso = _iso(now_dt + timedelta(minutes=duration_minutes))
            res_id = f"res_{uuid.uuid4().hex[:10]}"
            res_doc = {
                "id": res_id,
                "cafeId": cafe_id,
                "tableId": table_id,
                "userId": user_id,
                "expiresAt": exp_iso,
                "state": "active",
                "createdAt": now_iso,
            }
            bucket["reservations"][res_id] = res_doc
            tbl["status"] = "reserved"
            tbl["reservationId"] = res_id
            tbl["reservedByUserId"] = user_id
            tbl["reservationExpiresAt"] = exp_iso
            tbl["updatedAt"] = now_iso
            return copy.deepcopy(tbl), copy.deepcopy(res_doc)

    def release_table_tx(self, cafe_id: str, table_id: str, user_id: str, is_staff: bool = False) -> dict[str, Any]:
        with self._lock:
            bucket = self._bucket(cafe_id)
            self._expire_stale_reservations_locked(cafe_id)
            tbl = bucket["tables"].get(table_id)
            if not tbl:
                raise DomainNotFoundError(f"Table '{table_id}' not found")
            if tbl["status"] == "free":
                return copy.deepcopy(tbl)
            if not is_staff and tbl.get("reservedByUserId") != user_id:
                raise DomainConflictError("Only the reservation holder or staff can release this seat.", code="forbidden")
            res_id = tbl.get("reservationId")
            if res_id and res_id in bucket["reservations"]:
                bucket["reservations"][res_id]["state"] = "released"
            tbl["status"] = "free"
            tbl["reservationId"] = None
            tbl["reservedByUserId"] = None
            tbl["reservationExpiresAt"] = None
            tbl["updatedAt"] = _iso()
            return copy.deepcopy(tbl)

    def list_sessions(self, cafe_id: str) -> list[dict[str, Any]]:
        with self._lock:
            sessions = list(self._bucket(cafe_id)["sessions"].values())
            sessions.sort(key=lambda s: s["createdAt"], reverse=True)
            return copy.deepcopy(sessions)

    def create_session(self, cafe_id: str, session_data: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            bucket = self._bucket(cafe_id)
            sid = f"sess_{uuid.uuid4().hex[:10]}"
            doc = {**session_data, "id": sid, "cafeId": cafe_id, "createdAt": _iso()}
            bucket["sessions"][sid] = doc
            return copy.deepcopy(doc)

    def request_join_session(
        self, cafe_id: str, session_id: str, user_id: str, display_name: str, note: str
    ) -> dict[str, Any]:
        with self._lock:
            sess = self._bucket(cafe_id)["sessions"].get(session_id)
            if not sess:
                raise DomainNotFoundError("Session not found")
            if user_id in sess["approvedMemberIds"]:
                return copy.deepcopy(sess)
            if len(sess["approvedMemberIds"]) >= int(sess["maxMembers"]):
                raise DomainConflictError("This session is currently full.", code="session_full")
            if sess["joinPolicy"] == "open":
                sess["approvedMemberIds"].append(user_id)
            else:
                if not any(r["userId"] == user_id for r in sess["pendingRequests"]):
                    sess["pendingRequests"].append(
                        {
                            "userId": user_id,
                            "displayName": display_name,
                            "note": note,
                            "requestedAt": _iso(),
                        }
                    )
            return copy.deepcopy(sess)

    def decide_join_session(
        self, cafe_id: str, session_id: str, host_id: str, target_user_id: str, approve: bool
    ) -> dict[str, Any]:
        with self._lock:
            sess = self._bucket(cafe_id)["sessions"].get(session_id)
            if not sess:
                raise DomainNotFoundError("Session not found")
            if sess["hostId"] != host_id:
                raise DomainConflictError("Only the session host can approve or decline requests.", code="forbidden")
            sess["pendingRequests"] = [r for r in sess["pendingRequests"] if r["userId"] != target_user_id]
            if approve and target_user_id not in sess["approvedMemberIds"]:
                if len(sess["approvedMemberIds"]) >= int(sess["maxMembers"]):
                    raise DomainConflictError("Session is already at maximum capacity.", code="session_full")
                sess["approvedMemberIds"].append(target_user_id)
            return copy.deepcopy(sess)

    def leave_session(self, cafe_id: str, session_id: str, user_id: str) -> dict[str, Any]:
        with self._lock:
            sess = self._bucket(cafe_id)["sessions"].get(session_id)
            if not sess:
                raise DomainNotFoundError("Session not found")
            sess["approvedMemberIds"] = [uid for uid in sess["approvedMemberIds"] if uid != user_id]
            sess["pendingRequests"] = [r for r in sess["pendingRequests"] if r["userId"] != user_id]
            return copy.deepcopy(sess)

    def get_preferences(self, cafe_id: str, user_id: str) -> dict[str, Any]:
        with self._lock:
            prefs = self._bucket(cafe_id)["preferences"].get(user_id)
            if not prefs:
                prefs = {
                    "userId": user_id,
                    "discoverableInConnect": False,
                    "interestTags": [],
                    "dietaryPreferences": [],
                    "defaultIntent": None,
                    "consentGranted": False,
                    "updatedAt": _iso(),
                }
                self._bucket(cafe_id)["preferences"][user_id] = prefs
            return copy.deepcopy(prefs)

    def update_preferences(self, cafe_id: str, user_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            prefs = self.get_preferences(cafe_id, user_id)
            for k, v in patch.items():
                if v is not None:
                    prefs[k] = v
            prefs["updatedAt"] = _iso()
            self._bucket(cafe_id)["preferences"][user_id] = prefs
            return copy.deepcopy(prefs)

    def list_recommendations(self, cafe_id: str) -> list[dict[str, Any]]:
        with self._lock:
            recs = list(self._bucket(cafe_id)["recommendations"].values())
            recs.sort(key=lambda r: r["createdAt"], reverse=True)
            return copy.deepcopy(recs)

    def save_recommendation(self, cafe_id: str, rec: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            bucket = self._bucket(cafe_id)
            rec_id = rec.get("id") or f"rec_{uuid.uuid4().hex[:10]}"
            doc = {**rec, "id": rec_id, "cafeId": cafe_id}
            bucket["recommendations"][rec_id] = doc
            return copy.deepcopy(doc)

    def decide_recommendation(
        self, cafe_id: str, rec_id: str, decision: str, actor_id: str, note: str
    ) -> dict[str, Any]:
        with self._lock:
            bucket = self._bucket(cafe_id)
            rec = bucket["recommendations"].get(rec_id)
            if not rec:
                raise DomainNotFoundError(f"Recommendation '{rec_id}' not found")
            rec["status"] = decision
            rec["decidedBy"] = actor_id
            rec["decidedAt"] = _iso()
            # If manager approves a substitute promotion recommendation, publish safe customer banner
            if decision == "approved" and rec.get("type") == "substitute_promo":
                bucket["demoState"]["promoBanner"] = rec.get("suggestedAction") or rec.get("title")
                bucket["demoState"]["updatedAt"] = _iso()
            return copy.deepcopy(rec)

    def get_demo_state(self, cafe_id: str) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._bucket(cafe_id)["demoState"])

    def set_demo_scenario(self, cafe_id: str, scenario: str, actor_id: str) -> dict[str, Any]:
        with self._lock:
            bucket = self._bucket(cafe_id)
            now_iso = _iso()
            if scenario == "calm":
                bucket["demoState"].update(
                    {
                        "scenario": "calm",
                        "activeBaristas": 2,
                        "workUnitsPerMinute": 2.0,
                        "simulatedQueueWorkUnits": 0,
                        "updatedAt": now_iso,
                    }
                )
            elif scenario == "rush":
                bucket["demoState"].update(
                    {
                        "scenario": "rush",
                        "activeBaristas": 2,
                        "workUnitsPerMinute": 1.5,
                        "simulatedQueueWorkUnits": 24,
                        "updatedAt": now_iso,
                    }
                )
            elif scenario == "low_stock":
                bucket["demoState"].update(
                    {
                        "scenario": "low_stock",
                        "activeBaristas": 2,
                        "workUnitsPerMinute": 2.0,
                        "simulatedQueueWorkUnits": 8,
                        "updatedAt": now_iso,
                    }
                )
                # Clamp low_stock so onHand NEVER drops below reserved (leaves 1 serving free above reserved)
                oat = bucket["ingredients"].get("oat_milk_ml")
                if oat:
                    reserved_now = int(oat["reserved"])
                    target = max(reserved_now, reserved_now + 180)
                    delta = target - int(oat["onHand"])
                    if delta != 0:
                        oat["onHand"] = target
                        oat["version"] = int(oat["version"]) + 1
                        oat["updatedAt"] = now_iso
                        bucket["inventoryEvents"].append(
                            {
                                "id": f"invev_{uuid.uuid4().hex[:12]}",
                                "cafeId": cafe_id,
                                "ingredientId": "oat_milk_ml",
                                "ingredientName": oat["name"],
                                "deltaOnHand": delta,
                                "deltaReserved": 0,
                                "eventType": "adjust",
                                "orderId": None,
                                "actorId": actor_id,
                                "reason": "Demo simulation: Low Oat Milk scenario triggered (clamped >= reserved)",
                                "at": now_iso,
                            }
                        )
            else:
                raise DomainValidationError(f"Unknown demo scenario '{scenario}'")
            return copy.deepcopy(bucket["demoState"])
