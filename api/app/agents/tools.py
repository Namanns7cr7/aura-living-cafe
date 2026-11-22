from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.auth import UserContext, create_approval_token
from app.config import Settings, get_settings
from app.models import ApprovalPreviewResponse, OrderItemInput, OrderItemSnapshot
from app.services.eta import estimate_pickup_eta
from app.services.inventory import (
    aggregate_cart_requirements,
    calculate_item_servings,
    compute_available_units,
    compute_demand_leaders,
    enrich_ingredients_view,
    enrich_menu_with_availability,
    find_in_stock_substitutes,
)
from app.store.base import CafeStore


def build_customer_tools(store: CafeStore, cafe_id: str, user: UserContext | None):
    """
    Creates strictly scoped, customer-safe read tools for the Customer Experience Agent.
    Never exposes raw staff inventory ledgers or other customers' orders.
    """

    def get_menu(category: str | None = None) -> list[dict[str, Any]]:
        """Return live menu items with real stock-backed availability and paise/rupee prices."""
        menu = store.list_menu_items(cafe_id)
        ings = {i["id"]: i for i in store.list_ingredients(cafe_id)}
        enriched = enrich_menu_with_availability(menu, ings)
        if category:
            enriched = [m for m in enriched if m.category == category]
        return [
            {
                "id": m.id,
                "name": m.name,
                "description": m.description,
                "pricePaise": m.pricePaise,
                "priceRupees": m.priceRupees,
                "category": m.category,
                "temperature": m.temperature,
                "sweetness": m.sweetness,
                "allergens": m.allergens,
                "dietaryTags": m.dietaryTags,
                "availableServings": m.availableServings,
                "isAvailable": m.isAvailable,
                "prepWorkUnits": m.prepWorkUnits,
            }
            for m in enriched
        ]

    def find_available_drinks(
        max_price_paise: int | None = None,
        temperature: str | None = None,
        not_too_sweet: bool = False,
        dietary_tags: list[str] | None = None,
        exclude_allergens: list[str] | None = None,
        caffeine_free: bool = False,
        category: str | None = None,
    ) -> dict[str, Any]:
        """Search genuinely in-stock menu items matching customer constraints."""
        menu = store.list_menu_items(cafe_id)
        ings = {i["id"]: i for i in store.list_ingredients(cafe_id)}
        enriched = enrich_menu_with_availability(menu, ings)

        req_tags = {t.lower().strip() for t in (dietary_tags or []) if t.strip()}
        banned_allergens = {a.lower().strip() for a in (exclude_allergens or []) if a.strip()}
        if "dairy-free" in req_tags or "vegan" in req_tags:
            banned_allergens.add("dairy")

        matched = []
        unavailable_matches = []
        for m in enriched:
            if category and m.category != category:
                continue
            if temperature and m.temperature != temperature:
                continue
            if max_price_paise is not None and m.pricePaise > max_price_paise:
                continue
            if not_too_sweet and m.sweetness == "sweet":
                continue
            if caffeine_free and "caffeine-free" not in m.dietaryTags and "decaf" not in m.dietaryTags:
                continue
            item_allergens = {a.lower() for a in m.allergens}
            if banned_allergens.intersection(item_allergens):
                continue
            item_tags = {t.lower() for t in m.dietaryTags}
            if req_tags and not req_tags.issubset(item_tags):
                # Allow "oat" check via item name/allergens
                if not ("oat" in req_tags and "oats" in item_allergens):
                    continue

            entry = {
                "id": m.id,
                "name": m.name,
                "pricePaise": m.pricePaise,
                "priceRupees": m.priceRupees,
                "category": m.category,
                "temperature": m.temperature,
                "sweetness": m.sweetness,
                "dietaryTags": m.dietaryTags,
                "allergens": m.allergens,
                "availableServings": m.availableServings,
                "isAvailable": m.isAvailable,
                "prepWorkUnits": m.prepWorkUnits,
                "tastingNotes": m.tastingNotes,
            }
            if m.isAvailable:
                matched.append(entry)
            else:
                unavailable_matches.append(
                    {**entry, "reasonUnavailable": f"Limited by {m.limitingIngredientName or 'stock'}"}
                )

        # Sort by available servings health + price balance
        matched.sort(key=lambda x: (-min(x["availableServings"], 12), x["pricePaise"]))
        return {
            "matches": matched,
            "unavailableMatches": unavailable_matches,
            "totalAvailableMatches": len(matched),
        }

    def check_ingredients(menu_item_ids: list[str]) -> list[dict[str, Any]]:
        """Check whether requested menu items have sufficient real stock (no raw staff ledger leaked)."""
        menu_by_id = {m["id"]: m for m in store.list_menu_items(cafe_id)}
        ings = {i["id"]: i for i in store.list_ingredients(cafe_id)}
        enriched = enrich_menu_with_availability(list(menu_by_id.values()), ings)
        results = []
        for mid in menu_item_ids:
            item = menu_by_id.get(mid)
            if not item:
                results.append({"menuItemId": mid, "exists": False, "isAvailable": False, "availableServings": 0})
                continue
            servings, _, lim_name = calculate_item_servings(item, ings)
            subs = []
            if servings == 0:
                subs = [
                    {"id": s.id, "name": s.name, "priceRupees": s.priceRupees, "availableServings": s.availableServings}
                    for s in find_in_stock_substitutes(item, enriched, limit=2)
                ]
            results.append(
                {
                    "menuItemId": mid,
                    "name": item["name"],
                    "exists": True,
                    "isAvailable": bool(item.get("active", True) and servings > 0),
                    "availableServings": servings,
                    "lowStock": 0 < servings <= 3,
                    "limitingFactor": lim_name if servings <= 3 else None,
                    "substitutes": subs,
                }
            )
        return results

    def get_available_seats(
        zone: str | None = None,
        needs_outlet: bool = False,
        min_seats: int = 1,
    ) -> list[dict[str, Any]]:
        """Return currently free café tables matching zone, outlet, and seating capacity."""
        tables = store.list_tables(cafe_id)
        out = []
        for t in tables:
            if t["status"] != "free":
                continue
            if zone and t["zone"] != zone:
                continue
            if needs_outlet and not t["hasOutlet"]:
                continue
            if int(t["seats"]) < min_seats:
                continue
            out.append(
                {
                    "tableId": t["id"],
                    "label": t["label"],
                    "zone": t["zone"],
                    "seats": t["seats"],
                    "hasOutlet": t["hasOutlet"],
                    "ambientNoiseDb": t["ambientNoiseDb"],
                    "noiseSource": t["noiseSource"],
                }
            )
        out.sort(key=lambda x: (x["ambientNoiseDb"], not x["hasOutlet"]))
        return out

    def estimate_wait(item_ids: list[str]) -> dict[str, Any]:
        """Deterministic work-unit queue ETA estimator."""
        menu_by_id = {m["id"]: m for m in store.list_menu_items(cafe_id)}
        wu = sum(int(menu_by_id[mid]["prepWorkUnits"]) for mid in item_ids if mid in menu_by_id) or 3
        active_orders = store.list_orders(cafe_id)
        demo_state = store.get_demo_state(cafe_id)
        return estimate_pickup_eta(wu, active_orders, menu_by_id, demo_state)

    def get_order_status(order_id: str) -> dict[str, Any]:
        """Return status of an order ONLY if owned by the authenticated customer (or staff)."""
        if user is None:
            return {"error": "Authentication required to inspect order status."}
        order = store.get_order(cafe_id, order_id)
        if not order:
            return {"error": f"Order '{order_id}' not found."}
        if user.role == "customer" and order["userId"] != user.uid:
            return {"error": "Authorization denied: you can only view your own orders."}
        return {
            "orderId": order["id"],
            "status": order["status"],
            "totalPaise": order["totalPaise"],
            "etaMinMinutes": order["etaMinMinutes"],
            "etaMaxMinutes": order["etaMaxMinutes"],
            "tableId": order.get("tableId"),
            "updatedAt": order["updatedAt"],
        }

    return {
        "get_menu": get_menu,
        "find_available_drinks": find_available_drinks,
        "check_ingredients": check_ingredients,
        "get_available_seats": get_available_seats,
        "estimate_wait": estimate_wait,
        "get_order_status": get_order_status,
    }


def build_approval_preview(
    store: CafeStore,
    cafe_id: str,
    user: UserContext,
    items: list[OrderItemInput],
    table_id: str | None = None,
    settings: Settings | None = None,
) -> ApprovalPreviewResponse:
    """
    Validates current stock, prices, ETA, and table availability and mints a short-lived
    cryptographic approvalToken bound to the exact cart + table. Does NOT mutate state.
    """
    cfg = settings or get_settings()
    menu_by_id = {m["id"]: m for m in store.list_menu_items(cafe_id)}
    ings = {i["id"]: i for i in store.list_ingredients(cafe_id)}
    cart_dicts = [i.model_dump() for i in items]
    total_reqs, snapshots, total_paise = aggregate_cart_requirements(cart_dicts, menu_by_id)

    warnings: list[str] = []
    impact: list[dict[str, Any]] = []
    for iid, req_qty in total_reqs.items():
        ing = ings.get(iid)
        avail = compute_available_units(ing) if ing else 0
        if avail < req_qty:
            raise ValueError(
                f"Insufficient stock for {ing['name'] if ing else iid} ({avail} available, {req_qty} required)."
            )
        remaining_after = avail - req_qty
        if ing and remaining_after <= int(ing["lowThreshold"]):
            warnings.append(f"{ing['name']} is running low ({remaining_after}{ing['unit']} left after this order).")
        impact.append(
            {
                "ingredientId": iid,
                "ingredientName": ing["name"] if ing else iid,
                "required": req_qty,
                "unit": ing["unit"] if ing else "each",
                "availableBefore": avail,
                "availableAfter": remaining_after,
            }
        )

    if table_id:
        tables = {t["id"]: t for t in store.list_tables(cafe_id)}
        tbl = tables.get(table_id)
        if not tbl:
            raise ValueError(f"Table '{table_id}' does not exist.")
        if tbl["status"] != "free" and tbl.get("reservedByUserId") != user.uid:
            raise ValueError(f"Table '{tbl['label']}' is currently {tbl['status']}.")

    order_wu = sum(int(menu_by_id[s["menuItemId"]]["prepWorkUnits"]) * int(s["qty"]) for s in snapshots)
    eta = estimate_pickup_eta(order_wu, store.list_orders(cafe_id), menu_by_id, store.get_demo_state(cafe_id))

    approval_payload = {
        "items": [
            {"menuItemId": i.menuItemId, "qty": i.qty, "selectedModifierIds": sorted(i.selectedModifierIds)}
            for i in items
        ],
        "tableId": table_id,
    }
    token, exp_ts = create_approval_token(user.uid, cafe_id, approval_payload, cfg)
    expires_at = datetime.fromtimestamp(exp_ts, tz=timezone.utc).isoformat()

    return ApprovalPreviewResponse(
        approvalToken=token,
        expiresAt=expires_at,
        items=[OrderItemSnapshot(**s) for s in snapshots],
        totalPaise=total_paise,
        totalRupees=round(total_paise / 100.0, 2),
        tableId=table_id,
        etaMinMinutes=eta["minMinutes"],
        etaMaxMinutes=eta["maxMinutes"],
        ingredientImpact=impact,
        warnings=warnings,
    )


def build_inventory_tools(store: CafeStore, cafe_id: str):
    """Read-only analytical tools for the Inventory Operations Agent (staff/manager only)."""

    def get_inventory_summary() -> dict[str, Any]:
        ings = store.list_ingredients(cafe_id)
        menu = store.list_menu_items(cafe_id)
        views = enrich_ingredients_view(ings, menu)
        counts = {"healthy": 0, "low": 0, "critical": 0, "out": 0}
        for v in views:
            counts[v.status] += 1
        return {
            "totalIngredients": len(views),
            "statusCounts": counts,
            "atRisk": [
                {
                    "id": v.id,
                    "name": v.name,
                    "unit": v.unit,
                    "onHand": v.onHand,
                    "reserved": v.reserved,
                    "available": v.available,
                    "lowThreshold": v.lowThreshold,
                    "status": v.status,
                    "affectedDrinks": v.affectedDrinks,
                }
                for v in views
                if v.status in ("out", "critical", "low")
            ],
        }

    def calculate_available_servings() -> list[dict[str, Any]]:
        menu = store.list_menu_items(cafe_id)
        ings = {i["id"]: i for i in store.list_ingredients(cafe_id)}
        enriched = enrich_menu_with_availability(menu, ings)
        enriched.sort(key=lambda m: (m.availableServings, m.name))
        return [
            {
                "menuItemId": m.id,
                "name": m.name,
                "availableServings": m.availableServings,
                "isAvailable": m.isAvailable,
                "limitingIngredient": m.limitingIngredientName,
            }
            for m in enriched
        ]

    def find_low_stock_items() -> list[dict[str, Any]]:
        return get_inventory_summary()["atRisk"]

    def analyze_order_demand() -> dict[str, Any]:
        orders = store.list_orders(cafe_id)
        leaders = compute_demand_leaders(orders, top_n=6)
        by_status: dict[str, int] = {}
        for o in orders:
            by_status[o["status"]] = by_status.get(o["status"], 0) + 1
        return {
            "totalOrdersWindow": len(orders),
            "ordersByStatus": by_status,
            "demandLeaders": leaders,
            "inputWindowNote": "Based on current café session + seeded historical orders.",
        }

    def recommend_restock() -> list[dict[str, Any]]:
        low = find_low_stock_items()
        recs = []
        for item in low:
            target = max(int(item["lowThreshold"]) * 3, int(item["lowThreshold"]) + 10)
            suggested_add = max(1, target - int(item["available"]))
            recs.append(
                {
                    "ingredientId": item["id"],
                    "ingredientName": item["name"],
                    "currentAvailable": item["available"],
                    "lowThreshold": item["lowThreshold"],
                    "unit": item["unit"],
                    "suggestedRestockQty": suggested_add,
                    "affectedDrinks": item["affectedDrinks"],
                }
            )
        return recs

    def explain_shortages() -> list[dict[str, Any]]:
        servings = calculate_available_servings()
        low_drinks = [s for s in servings if s["availableServings"] <= 5]
        menu = store.list_menu_items(cafe_id)
        ings = {i["id"]: i for i in store.list_ingredients(cafe_id)}
        enriched = enrich_menu_with_availability(menu, ings)
        menu_map = {m["id"]: m for m in menu}
        explanations = []
        for d in low_drinks[:5]:
            raw = menu_map.get(d["menuItemId"])
            subs = find_in_stock_substitutes(raw, enriched, limit=2) if raw else []
            explanations.append(
                {
                    "menuItemId": d["menuItemId"],
                    "name": d["name"],
                    "availableServings": d["availableServings"],
                    "limitingIngredient": d["limitingIngredient"],
                    "inStockSubstitutes": [
                        {"id": s.id, "name": s.name, "availableServings": s.availableServings, "priceRupees": s.priceRupees}
                        for s in subs
                    ],
                }
            )
        return explanations

    return {
        "get_inventory_summary": get_inventory_summary,
        "calculate_available_servings": calculate_available_servings,
        "find_low_stock_items": find_low_stock_items,
        "analyze_order_demand": analyze_order_demand,
        "recommend_restock": recommend_restock,
        "explain_shortages": explain_shortages,
    }
