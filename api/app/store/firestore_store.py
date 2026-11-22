from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore

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
from app.store.memory_store import VALID_TRANSITIONS


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


def _split_session_docs(sess: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Splits a community session into:
      1. Public doc (no member UIDs, no pending requests, no private meeting note)
      2. Private subcollection doc at sessions/{id}/private/members
    """
    approved = list(sess.get("approvedMemberIds", []))
    pending = list(sess.get("pendingRequests", []))
    meeting_note = sess.get("meetingNoteForApproved", "")

    public_doc = {
        "id": sess["id"],
        "cafeId": sess["cafeId"],
        "title": sess["title"],
        "description": sess["description"],
        "tags": list(sess.get("tags", [])),
        "hostId": sess["hostId"],
        "hostDisplayName": sess["hostDisplayName"],
        "zoneHint": sess["zoneHint"],
        "startTimeLabel": sess["startTimeLabel"],
        "joinPolicy": sess.get("joinPolicy", "approval"),
        "visibility": sess.get("visibility", "public"),
        "maxMembers": int(sess.get("maxMembers", 6)),
        "memberCount": len(approved),
        "createdAt": sess["createdAt"],
    }
    private_doc = {
        "hostId": sess["hostId"],
        "approvedMemberIds": approved,
        "pendingRequests": pending,
        "meetingNoteForApproved": meeting_note,
    }
    return public_doc, private_doc


def _merge_session_docs(public_doc: dict[str, Any], private_doc: dict[str, Any] | None) -> dict[str, Any]:
    priv = private_doc or {}
    return {
        **public_doc,
        "approvedMemberIds": list(priv.get("approvedMemberIds", [])),
        "pendingRequests": list(priv.get("pendingRequests", [])),
        "meetingNoteForApproved": priv.get("meetingNoteForApproved", ""),
    }


class FirestoreCafeStore(CafeStore):
    """Production & Emulator Google Cloud Firestore transactional store under /cafes/{cafeId}/..."""

    def __init__(self, project_id: str | None = None) -> None:
        if os.environ.get("FIRESTORE_EMULATOR_HOST"):
            self._db = firestore.Client(
                project=project_id or "aura-emulator-test",
                credentials=AnonymousCredentials(),
            )
        else:
            self._db = firestore.Client(project=project_id or None)

    def _cafe_ref(self, cafe_id: str):
        return self._db.collection("cafes").document(cafe_id)

    def _col(self, cafe_id: str, name: str):
        return self._cafe_ref(cafe_id).collection(name)

    def _delete_collection(self, cafe_id: str, name: str) -> None:
        col = self._col(cafe_id, name)
        for doc in col.stream():
            if name == "sessions":
                for sub in doc.reference.collection("private").stream():
                    sub.reference.delete()
            doc.reference.delete()

    def seed_cafe(self, cafe_id: str, reset: bool = False) -> dict[str, int]:
        cafe_ref = self._cafe_ref(cafe_id)
        cafe_ref.set({"id": cafe_id, "updatedAt": _iso()}, merge=True)

        if reset:
            for col_name in (
                "ingredients",
                "menuItems",
                "tables",
                "orders",
                "orderEvents",
                "inventoryEvents",
                "reservations",
                "idempotencyKeys",
                "sessions",
                "operationalRecommendations",
            ):
                self._delete_collection(cafe_id, col_name)

        def _seed_collection(col_name: str, items: list[dict[str, Any]]) -> int:
            col = self._col(cafe_id, col_name)
            existing_ids = {doc.id for doc in col.stream()}
            batch = self._db.batch()
            ops = 0
            for item in items:
                doc_id = item["id"]
                if reset or doc_id not in existing_ids:
                    batch.set(col.document(doc_id), item)
                    ops += 1
            if ops:
                batch.commit()
            return len(existing_ids | {i["id"] for i in items})

        # Seed sessions using public + private subcollection split
        sess_col = self._col(cafe_id, "sessions")
        existing_sess_ids = {doc.id for doc in sess_col.stream()}
        seed_sessions = build_seed_sessions(cafe_id)
        batch = self._db.batch()
        sess_ops = 0
        for s in seed_sessions:
            if reset or s["id"] not in existing_sess_ids:
                pub_doc, priv_doc = _split_session_docs(s)
                ref = sess_col.document(s["id"])
                batch.set(ref, pub_doc)
                batch.set(ref.collection("private").document("members"), priv_doc)
                sess_ops += 1
        if sess_ops:
            batch.commit()

        counts = {
            "ingredients": _seed_collection("ingredients", build_seed_ingredients()),
            "menuItems": _seed_collection("menuItems", build_seed_menu()),
            "tables": _seed_collection("tables", build_seed_tables()),
            "orders": _seed_collection("orders", build_seed_historical_orders(cafe_id)),
            "sessions": len(existing_sess_ids | {s["id"] for s in seed_sessions}),
        }
        demo_ref = self._col(cafe_id, "demoState").document("current")
        if reset or not demo_ref.get().exists:
            demo_ref.set(build_seed_demo_state(cafe_id))
        return counts

    def list_menu_items(self, cafe_id: str) -> list[dict[str, Any]]:
        return [d.to_dict() for d in self._col(cafe_id, "menuItems").stream() if d.exists]

    def get_menu_item(self, cafe_id: str, item_id: str) -> dict[str, Any] | None:
        snap = self._col(cafe_id, "menuItems").document(item_id).get()
        return snap.to_dict() if snap.exists else None

    def set_menu_item_active(self, cafe_id: str, item_id: str, active: bool) -> dict[str, Any]:
        ref = self._col(cafe_id, "menuItems").document(item_id)
        snap = ref.get()
        if not snap.exists:
            raise DomainNotFoundError(f"Menu item '{item_id}' not found")
        data = snap.to_dict()
        data["active"] = bool(active)
        ref.update({"active": bool(active)})
        return data

    def list_ingredients(self, cafe_id: str) -> list[dict[str, Any]]:
        return [d.to_dict() for d in self._col(cafe_id, "ingredients").stream() if d.exists]

    def get_ingredient(self, cafe_id: str, ingredient_id: str) -> dict[str, Any] | None:
        snap = self._col(cafe_id, "ingredients").document(ingredient_id).get()
        return snap.to_dict() if snap.exists else None

    def adjust_ingredient_tx(
        self,
        cafe_id: str,
        ingredient_id: str,
        delta_on_hand: int,
        actor_id: str,
        reason: str,
        expected_version: int | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        ing_ref = self._col(cafe_id, "ingredients").document(ingredient_id)
        ev_col = self._col(cafe_id, "inventoryEvents")

        @firestore.transactional
        def _txn(transaction: firestore.Transaction):
            snap = ing_ref.get(transaction=transaction)
            if not snap.exists:
                raise DomainNotFoundError(f"Ingredient '{ingredient_id}' not found")
            ing = snap.to_dict()
            if expected_version is not None and int(ing["version"]) != int(expected_version):
                raise DomainConflictError("Ingredient stock changed concurrently.", code="version_conflict")
            new_on_hand = int(ing["onHand"]) + int(delta_on_hand)
            if new_on_hand < 0:
                raise DomainValidationError("On-hand stock cannot be negative.", code="negative_inventory")
            if new_on_hand < int(ing["reserved"]):
                raise DomainValidationError("On-hand stock cannot drop below reserved.", code="below_reserved")

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
            transaction.set(ing_ref, ing)
            transaction.set(ev_col.document(ev["id"]), ev)
            return ing, ev

        return _txn(self._db.transaction())

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
        idem_doc_id = f"{user_id}__{idempotency_key}"
        idem_ref = self._col(cafe_id, "idempotencyKeys").document(idem_doc_id)
        menu_items = {m["id"]: m for m in self.list_menu_items(cafe_id)}
        try:
            total_reqs, snapshots, total_paise = aggregate_cart_requirements(cart_items, menu_items)
        except ValueError as exc:
            raise DomainValidationError(str(exc), code="invalid_cart") from exc

        active_orders = self.list_orders(cafe_id)
        demo_state = self.get_demo_state(cafe_id)

        @firestore.transactional
        def _txn(transaction: firestore.Transaction):
            idem_snap = idem_ref.get(transaction=transaction)
            if idem_snap.exists:
                existing_id = idem_snap.to_dict()["orderId"]
                existing_order = self._col(cafe_id, "orders").document(existing_id).get(transaction=transaction)
                if existing_order.exists:
                    return existing_order.to_dict(), True

            # Read all required ingredients inside the transaction
            ing_refs = {iid: self._col(cafe_id, "ingredients").document(iid) for iid in total_reqs}
            ing_docs: dict[str, dict[str, Any]] = {}
            shortages = []
            for iid, ref in ing_refs.items():
                snap = ref.get(transaction=transaction)
                if not snap.exists:
                    shortages.append({"ingredientId": iid, "name": iid, "available": 0, "required": total_reqs[iid]})
                    continue
                doc = snap.to_dict()
                ing_docs[iid] = doc
                avail = compute_available_units(doc)
                if avail < total_reqs[iid]:
                    shortages.append(
                        {
                            "ingredientId": iid,
                            "name": doc["name"],
                            "available": avail,
                            "required": total_reqs[iid],
                            "unit": doc["unit"],
                        }
                    )

            if shortages:
                first = shortages[0]
                raise DomainConflictError(
                    f"Just sold out: insufficient {first['name']} ({first['available']} available, {first['required']} needed).",
                    code="insufficient_stock",
                    details={"shortages": shortages},
                )

            now_dt = _now()
            now_iso = _iso(now_dt)
            reservation_id: str | None = None
            tbl_ref = None
            tbl_doc = None
            res_doc = None

            if table_id:
                tbl_ref = self._col(cafe_id, "tables").document(table_id)
                tbl_snap = tbl_ref.get(transaction=transaction)
                if not tbl_snap.exists:
                    raise DomainNotFoundError(f"Table '{table_id}' not found")
                tbl_doc = tbl_snap.to_dict()
                if tbl_doc["status"] == "reserved":
                    exp = _parse_iso(tbl_doc.get("reservationExpiresAt"))
                    if exp and exp <= now_dt:
                        tbl_doc["status"] = "free"
                        tbl_doc["reservationId"] = None
                        tbl_doc["reservedByUserId"] = None
                        tbl_doc["reservationExpiresAt"] = None
                if tbl_doc["status"] == "occupied":
                    raise DomainConflictError(f"Table '{tbl_doc['label']}' is occupied.", code="table_unavailable")
                if tbl_doc["status"] == "reserved" and tbl_doc.get("reservedByUserId") != user_id:
                    raise DomainConflictError(f"Table '{tbl_doc['label']}' was just reserved.", code="table_unavailable")
                if tbl_doc["status"] == "reserved":
                    reservation_id = tbl_doc.get("reservationId")
                else:
                    reservation_id = f"res_{uuid.uuid4().hex[:10]}"
                    exp_iso = _iso(now_dt + timedelta(minutes=60))
                    tbl_doc["status"] = "reserved"
                    tbl_doc["reservationId"] = reservation_id
                    tbl_doc["reservedByUserId"] = user_id
                    tbl_doc["reservationExpiresAt"] = exp_iso
                    tbl_doc["updatedAt"] = now_iso
                    res_doc = {
                        "id": reservation_id,
                        "cafeId": cafe_id,
                        "tableId": table_id,
                        "userId": user_id,
                        "expiresAt": exp_iso,
                        "state": "active",
                        "createdAt": now_iso,
                    }

            order_id = f"ord_{uuid.uuid4().hex[:10]}"
            order_work_units = sum(
                int(menu_items[s["menuItemId"]]["prepWorkUnits"]) * int(s["qty"])
                for s in snapshots
            )
            eta = estimate_pickup_eta(order_work_units, active_orders, menu_items, demo_state)

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

            # All writes after all reads
            for iid, doc in ing_docs.items():
                req_qty = total_reqs[iid]
                doc["reserved"] = int(doc["reserved"]) + req_qty
                doc["version"] = int(doc["version"]) + 1
                doc["updatedAt"] = now_iso
                transaction.set(ing_refs[iid], doc)
                ev_id = f"invev_{uuid.uuid4().hex[:12]}"
                transaction.set(
                    self._col(cafe_id, "inventoryEvents").document(ev_id),
                    {
                        "id": ev_id,
                        "cafeId": cafe_id,
                        "ingredientId": iid,
                        "ingredientName": doc["name"],
                        "deltaOnHand": 0,
                        "deltaReserved": req_qty,
                        "eventType": "reserve",
                        "orderId": order_id,
                        "actorId": user_id,
                        "reason": f"Reserved for order {order_id}",
                        "at": now_iso,
                    },
                )

            if tbl_ref and tbl_doc and res_doc:
                transaction.set(tbl_ref, tbl_doc)
                transaction.set(self._col(cafe_id, "reservations").document(res_doc["id"]), res_doc)

            transaction.set(self._col(cafe_id, "orders").document(order_id), order_doc)
            transaction.set(idem_ref, {"orderId": order_id, "createdAt": now_iso})
            ordev_id = f"ordev_{uuid.uuid4().hex[:12]}"
            transaction.set(
                self._col(cafe_id, "orderEvents").document(ordev_id),
                {
                    "id": ordev_id,
                    "cafeId": cafe_id,
                    "orderId": order_id,
                    "fromStatus": None,
                    "toStatus": "confirmed",
                    "actorId": user_id,
                    "actorRole": "customer",
                    "at": now_iso,
                    "reason": "Order confirmed and ingredients reserved",
                },
            )
            return order_doc, False

        return _txn(self._db.transaction())

    def transition_order_tx(
        self,
        cafe_id: str,
        order_id: str,
        target_status: str,
        actor_id: str,
        actor_role: str,
        reason: str,
    ) -> dict[str, Any]:
        order_ref = self._col(cafe_id, "orders").document(order_id)

        @firestore.transactional
        def _txn(transaction: firestore.Transaction):
            order_snap = order_ref.get(transaction=transaction)
            if not order_snap.exists:
                raise DomainNotFoundError(f"Order '{order_id}' not found")
            order = order_snap.to_dict()
            current = order["status"]
            if target_status == current:
                raise DomainConflictError(f"Order '{order_id}' is already '{current}'.", code="duplicate_transition")
            if target_status not in VALID_TRANSITIONS.get(current, set()):
                raise DomainConflictError(f"Cannot transition from '{current}' to '{target_status}'.", code="invalid_transition")

            order_ing_totals: dict[str, int] = {}
            for snap in order.get("items", []):
                qty = int(snap["qty"])
                for req in snap.get("recipeSnapshot", []):
                    iid = req["ingredientId"]
                    order_ing_totals[iid] = order_ing_totals.get(iid, 0) + int(req["qty"]) * qty

            # Consume stock on 'ready' ONLY, guarded by consumedAt is None
            needs_consume = target_status == "ready" and order.get("consumedAt") is None
            needs_release = target_status == "cancelled" and order.get("consumedAt") is None

            ing_refs = {}
            ing_docs = {}
            if needs_consume or needs_release:
                for iid in order_ing_totals:
                    ref = self._col(cafe_id, "ingredients").document(iid)
                    s = ref.get(transaction=transaction)
                    if s.exists:
                        ing_refs[iid] = ref
                        ing_docs[iid] = s.to_dict()

            tbl_ref = None
            tbl_doc = None
            if target_status == "cancelled" and order.get("tableId"):
                tbl_ref = self._col(cafe_id, "tables").document(order["tableId"])
                ts = tbl_ref.get(transaction=transaction)
                if ts.exists:
                    tbl_doc = ts.to_dict()

            now_iso = _iso()
            if needs_consume:
                for iid, doc in ing_docs.items():
                    req_qty = order_ing_totals[iid]
                    new_on_hand = int(doc["onHand"]) - req_qty
                    new_reserved = int(doc["reserved"]) - req_qty
                    if new_on_hand < 0 or new_reserved < 0:
                        raise DomainConflictError(
                            f"Inventory invariant guard triggered for {doc['name']}.",
                            code="inventory_invariant_error",
                        )
                    doc["onHand"] = new_on_hand
                    doc["reserved"] = new_reserved
                    doc["version"] = int(doc["version"]) + 1
                    doc["updatedAt"] = now_iso
                    transaction.set(ing_refs[iid], doc)
                    ev_id = f"invev_{uuid.uuid4().hex[:12]}"
                    transaction.set(
                        self._col(cafe_id, "inventoryEvents").document(ev_id),
                        {
                            "id": ev_id,
                            "cafeId": cafe_id,
                            "ingredientId": iid,
                            "ingredientName": doc["name"],
                            "deltaOnHand": -req_qty,
                            "deltaReserved": -req_qty,
                            "eventType": "consume",
                            "orderId": order_id,
                            "actorId": actor_id,
                            "reason": "Consumed once on order ready",
                            "at": now_iso,
                        },
                    )
                order["consumedAt"] = now_iso

            effective_reason = reason
            if target_status == "cancelled":
                order["cancelledAt"] = now_iso
                if needs_release:
                    for iid, doc in ing_docs.items():
                        req_qty = order_ing_totals[iid]
                        doc["reserved"] = max(0, int(doc["reserved"]) - req_qty)
                        doc["version"] = int(doc["version"]) + 1
                        doc["updatedAt"] = now_iso
                        transaction.set(ing_refs[iid], doc)
                        ev_id = f"invev_{uuid.uuid4().hex[:12]}"
                        transaction.set(
                            self._col(cafe_id, "inventoryEvents").document(ev_id),
                            {
                                "id": ev_id,
                                "cafeId": cafe_id,
                                "ingredientId": iid,
                                "ingredientName": doc["name"],
                                "deltaOnHand": 0,
                                "deltaReserved": -req_qty,
                                "eventType": "release",
                                "orderId": order_id,
                                "actorId": actor_id,
                                "reason": f"Reservation released: {reason}",
                                "at": now_iso,
                            },
                        )
                else:
                    effective_reason = f"{reason} (Post-consumption cancel: ingredients already consumed per waste policy)"
                if tbl_ref and tbl_doc and tbl_doc.get("reservationId") == order.get("reservationId"):
                    tbl_doc["status"] = "free"
                    tbl_doc["reservationId"] = None
                    tbl_doc["reservedByUserId"] = None
                    tbl_doc["reservationExpiresAt"] = None
                    tbl_doc["updatedAt"] = now_iso
                    transaction.set(tbl_ref, tbl_doc)

            order["status"] = target_status
            order["updatedAt"] = now_iso
            transaction.set(order_ref, order)
            ev_id = f"ordev_{uuid.uuid4().hex[:12]}"
            transaction.set(
                self._col(cafe_id, "orderEvents").document(ev_id),
                {
                    "id": ev_id,
                    "cafeId": cafe_id,
                    "orderId": order_id,
                    "fromStatus": current,
                    "toStatus": target_status,
                    "actorId": actor_id,
                    "actorRole": actor_role,
                    "at": now_iso,
                    "reason": effective_reason,
                },
            )
            return order

        return _txn(self._db.transaction())

    def get_order(self, cafe_id: str, order_id: str) -> dict[str, Any] | None:
        snap = self._col(cafe_id, "orders").document(order_id).get()
        return snap.to_dict() if snap.exists else None

    def list_orders(self, cafe_id: str, user_id: str | None = None) -> list[dict[str, Any]]:
        docs = [d.to_dict() for d in self._col(cafe_id, "orders").stream() if d.exists]
        if user_id is not None:
            docs = [d for d in docs if d.get("userId") == user_id]
        docs.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
        return docs

    def list_order_events(self, cafe_id: str, order_id: str | None = None) -> list[dict[str, Any]]:
        docs = [d.to_dict() for d in self._col(cafe_id, "orderEvents").stream() if d.exists]
        if order_id is not None:
            docs = [d for d in docs if d.get("orderId") == order_id]
        docs.sort(key=lambda x: x.get("at", ""), reverse=True)
        return docs

    def list_inventory_events(self, cafe_id: str, limit: int = 50) -> list[dict[str, Any]]:
        docs = [d.to_dict() for d in self._col(cafe_id, "inventoryEvents").stream() if d.exists]
        docs.sort(key=lambda x: x.get("at", ""), reverse=True)
        return docs[:limit]

    def list_tables(self, cafe_id: str) -> list[dict[str, Any]]:
        now = _now()
        result = []
        for snap in self._col(cafe_id, "tables").stream():
            if not snap.exists:
                continue
            tbl = snap.to_dict()
            if tbl.get("status") == "reserved":
                exp = _parse_iso(tbl.get("reservationExpiresAt"))
                if exp and exp <= now:
                    tbl["status"] = "free"
                    tbl["reservationId"] = None
                    tbl["reservedByUserId"] = None
                    tbl["reservationExpiresAt"] = None
                    tbl["updatedAt"] = _iso(now)
                    snap.reference.set(tbl)
            result.append(tbl)
        return result

    def reserve_table_tx(
        self,
        cafe_id: str,
        table_id: str,
        user_id: str,
        duration_minutes: int = 45,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        tbl_ref = self._col(cafe_id, "tables").document(table_id)

        @firestore.transactional
        def _txn(transaction: firestore.Transaction):
            snap = tbl_ref.get(transaction=transaction)
            if not snap.exists:
                raise DomainNotFoundError(f"Table '{table_id}' not found")
            tbl = snap.to_dict()
            now_dt = _now()
            if tbl["status"] == "reserved":
                exp = _parse_iso(tbl.get("reservationExpiresAt"))
                if exp and exp <= now_dt:
                    tbl["status"] = "free"
                    tbl["reservationId"] = None
                    tbl["reservedByUserId"] = None
                    tbl["reservationExpiresAt"] = None
            if tbl["status"] != "free":
                raise DomainConflictError(f"Table '{tbl['label']}' is currently {tbl['status']}.", code="table_unavailable")
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
            tbl["status"] = "reserved"
            tbl["reservationId"] = res_id
            tbl["reservedByUserId"] = user_id
            tbl["reservationExpiresAt"] = exp_iso
            tbl["updatedAt"] = now_iso
            transaction.set(tbl_ref, tbl)
            transaction.set(self._col(cafe_id, "reservations").document(res_id), res_doc)
            return tbl, res_doc

        return _txn(self._db.transaction())

    def release_table_tx(self, cafe_id: str, table_id: str, user_id: str, is_staff: bool = False) -> dict[str, Any]:
        tbl_ref = self._col(cafe_id, "tables").document(table_id)
        snap = tbl_ref.get()
        if not snap.exists:
            raise DomainNotFoundError(f"Table '{table_id}' not found")
        tbl = snap.to_dict()
        if tbl["status"] == "free":
            return tbl
        if not is_staff and tbl.get("reservedByUserId") != user_id:
            raise DomainConflictError("Only reservation holder or staff can release this seat.", code="forbidden")
        tbl["status"] = "free"
        tbl["reservationId"] = None
        tbl["reservedByUserId"] = None
        tbl["reservationExpiresAt"] = None
        tbl["updatedAt"] = _iso()
        tbl_ref.set(tbl)
        return tbl

    # --- Sessions split across public doc + private/members subcollection ---

    def _get_merged_session(self, cafe_id: str, session_id: str) -> dict[str, Any] | None:
        pub_ref = self._col(cafe_id, "sessions").document(session_id)
        pub_snap = pub_ref.get()
        if not pub_snap.exists:
            return None
        priv_snap = pub_ref.collection("private").document("members").get()
        return _merge_session_docs(pub_snap.to_dict(), priv_snap.to_dict() if priv_snap.exists else None)

    def _save_split_session(self, cafe_id: str, sess: dict[str, Any]) -> None:
        pub_doc, priv_doc = _split_session_docs(sess)
        ref = self._col(cafe_id, "sessions").document(sess["id"])
        batch = self._db.batch()
        batch.set(ref, pub_doc)
        batch.set(ref.collection("private").document("members"), priv_doc)
        batch.commit()

    def list_sessions(self, cafe_id: str) -> list[dict[str, Any]]:
        result = []
        for pub_snap in self._col(cafe_id, "sessions").stream():
            if not pub_snap.exists:
                continue
            priv_snap = pub_snap.reference.collection("private").document("members").get()
            result.append(_merge_session_docs(pub_snap.to_dict(), priv_snap.to_dict() if priv_snap.exists else None))
        result.sort(key=lambda s: s.get("createdAt", ""), reverse=True)
        return result

    def create_session(self, cafe_id: str, session_data: dict[str, Any]) -> dict[str, Any]:
        sid = f"sess_{uuid.uuid4().hex[:10]}"
        doc = {**session_data, "id": sid, "cafeId": cafe_id, "createdAt": _iso()}
        self._save_split_session(cafe_id, doc)
        return doc

    def request_join_session(
        self, cafe_id: str, session_id: str, user_id: str, display_name: str, note: str
    ) -> dict[str, Any]:
        sess = self._get_merged_session(cafe_id, session_id)
        if not sess:
            raise DomainNotFoundError("Session not found")
        if user_id in sess["approvedMemberIds"]:
            return sess
        if len(sess["approvedMemberIds"]) >= int(sess["maxMembers"]):
            raise DomainConflictError("Session is full.", code="session_full")
        if sess["joinPolicy"] == "open":
            sess["approvedMemberIds"].append(user_id)
        elif not any(r["userId"] == user_id for r in sess["pendingRequests"]):
            sess["pendingRequests"].append(
                {"userId": user_id, "displayName": display_name, "note": note, "requestedAt": _iso()}
            )
        self._save_split_session(cafe_id, sess)
        return sess

    def decide_join_session(
        self, cafe_id: str, session_id: str, host_id: str, target_user_id: str, approve: bool
    ) -> dict[str, Any]:
        sess = self._get_merged_session(cafe_id, session_id)
        if not sess:
            raise DomainNotFoundError("Session not found")
        if sess["hostId"] != host_id:
            raise DomainConflictError("Only host can decide join requests.", code="forbidden")
        sess["pendingRequests"] = [r for r in sess["pendingRequests"] if r["userId"] != target_user_id]
        if approve and target_user_id not in sess["approvedMemberIds"]:
            if len(sess["approvedMemberIds"]) >= int(sess["maxMembers"]):
                raise DomainConflictError("Session is already at maximum capacity.", code="session_full")
            sess["approvedMemberIds"].append(target_user_id)
        self._save_split_session(cafe_id, sess)
        return sess

    def leave_session(self, cafe_id: str, session_id: str, user_id: str) -> dict[str, Any]:
        sess = self._get_merged_session(cafe_id, session_id)
        if not sess:
            raise DomainNotFoundError("Session not found")
        sess["approvedMemberIds"] = [u for u in sess["approvedMemberIds"] if u != user_id]
        sess["pendingRequests"] = [r for r in sess["pendingRequests"] if r["userId"] != user_id]
        self._save_split_session(cafe_id, sess)
        return sess

    def get_preferences(self, cafe_id: str, user_id: str) -> dict[str, Any]:
        ref = self._col(cafe_id, "preferences").document(user_id)
        snap = ref.get()
        if snap.exists:
            return snap.to_dict()
        doc = {
            "userId": user_id,
            "discoverableInConnect": False,
            "interestTags": [],
            "dietaryPreferences": [],
            "defaultIntent": None,
            "consentGranted": False,
            "updatedAt": _iso(),
        }
        ref.set(doc)
        return doc

    def update_preferences(self, cafe_id: str, user_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        prefs = self.get_preferences(cafe_id, user_id)
        for k, v in patch.items():
            if v is not None:
                prefs[k] = v
        prefs["updatedAt"] = _iso()
        self._col(cafe_id, "preferences").document(user_id).set(prefs)
        return prefs

    def list_recommendations(self, cafe_id: str) -> list[dict[str, Any]]:
        docs = [d.to_dict() for d in self._col(cafe_id, "operationalRecommendations").stream() if d.exists]
        docs.sort(key=lambda r: r.get("createdAt", ""), reverse=True)
        return docs

    def save_recommendation(self, cafe_id: str, rec: dict[str, Any]) -> dict[str, Any]:
        rec_id = rec.get("id") or f"rec_{uuid.uuid4().hex[:10]}"
        doc = {**rec, "id": rec_id, "cafeId": cafe_id}
        self._col(cafe_id, "operationalRecommendations").document(rec_id).set(doc)
        return doc

    def decide_recommendation(
        self, cafe_id: str, rec_id: str, decision: str, actor_id: str, note: str
    ) -> dict[str, Any]:
        ref = self._col(cafe_id, "operationalRecommendations").document(rec_id)
        snap = ref.get()
        if not snap.exists:
            raise DomainNotFoundError(f"Recommendation '{rec_id}' not found")
        rec = snap.to_dict()
        rec["status"] = decision
        rec["decidedBy"] = actor_id
        rec["decidedAt"] = _iso()
        ref.set(rec)
        if decision == "approved" and rec.get("type") == "substitute_promo":
            demo_ref = self._col(cafe_id, "demoState").document("current")
            demo_ref.set({"promoBanner": rec.get("suggestedAction") or rec.get("title"), "updatedAt": _iso()}, merge=True)
        return rec

    def get_demo_state(self, cafe_id: str) -> dict[str, Any]:
        snap = self._col(cafe_id, "demoState").document("current").get()
        if snap.exists:
            return snap.to_dict()
        state = build_seed_demo_state(cafe_id)
        self._col(cafe_id, "demoState").document("current").set(state)
        return state

    def set_demo_scenario(self, cafe_id: str, scenario: str, actor_id: str) -> dict[str, Any]:
        state = self.get_demo_state(cafe_id)
        now_iso = _iso()
        if scenario == "calm":
            state.update({"scenario": "calm", "activeBaristas": 2, "workUnitsPerMinute": 2.0, "simulatedQueueWorkUnits": 0, "updatedAt": now_iso})
        elif scenario == "rush":
            state.update({"scenario": "rush", "activeBaristas": 2, "workUnitsPerMinute": 1.5, "simulatedQueueWorkUnits": 24, "updatedAt": now_iso})
        elif scenario == "low_stock":
            state.update({"scenario": "low_stock", "activeBaristas": 2, "workUnitsPerMinute": 2.0, "simulatedQueueWorkUnits": 8, "updatedAt": now_iso})
            # Transactionally clamp oat_milk_ml >= reserved (1 serving left above reserved)
            oat_ref = self._col(cafe_id, "ingredients").document("oat_milk_ml")
            ev_col = self._col(cafe_id, "inventoryEvents")

            @firestore.transactional
            def _clamp_oat(transaction: firestore.Transaction):
                snap = oat_ref.get(transaction=transaction)
                if not snap.exists:
                    return
                oat = snap.to_dict()
                reserved_now = int(oat["reserved"])
                target = max(reserved_now, reserved_now + 180)
                delta = target - int(oat["onHand"])
                if delta != 0:
                    oat["onHand"] = target
                    oat["version"] = int(oat["version"]) + 1
                    oat["updatedAt"] = now_iso
                    transaction.set(oat_ref, oat)
                    ev_id = f"invev_{uuid.uuid4().hex[:12]}"
                    transaction.set(
                        ev_col.document(ev_id),
                        {
                            "id": ev_id,
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
                        },
                    )

            _clamp_oat(self._db.transaction())
        else:
            raise DomainValidationError(f"Unknown demo scenario '{scenario}'")
        self._col(cafe_id, "demoState").document("current").set(state)
        return state
