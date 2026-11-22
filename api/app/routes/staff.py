from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth import UserContext, assert_cafe_scope, require_manager, require_staff
from app.config import Settings, get_settings
from app.models import (
    DecideRecommendationRequest,
    OrderStatusUpdateRequest,
    RestockRequest,
    ToggleMenuAvailabilityRequest,
)
from app.services.eta import estimate_pickup_eta
from app.services.events import event_bus
from app.services.inventory import (
    compute_demand_leaders,
    enrich_ingredients_view,
    enrich_menu_with_availability,
)
from app.store.base import DomainConflictError, DomainNotFoundError, DomainValidationError
from app.store.factory import get_store

router = APIRouter(prefix="/api/v1/staff", tags=["staff"])


@router.get("/dashboard")
def get_staff_dashboard(
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_staff),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    menu = store.list_menu_items(cid)
    ings = store.list_ingredients(cid)
    orders = store.list_orders(cid)
    tables = store.list_tables(cid)
    recs = store.list_recommendations(cid)
    inv_events = store.list_inventory_events(cid, limit=25)
    demo_state = store.get_demo_state(cid)

    ing_map = {i["id"]: i for i in ings}
    enriched_menu = enrich_menu_with_availability(menu, ing_map)
    ing_views = enrich_ingredients_view(ings, menu)
    eta = estimate_pickup_eta(3, orders, {m["id"]: m for m in menu}, demo_state)

    orders_by_status: dict[str, int] = {"confirmed": 0, "preparing": 0, "ready": 0, "collected": 0, "cancelled": 0}
    total_revenue_paise = 0
    for o in orders:
        st = o["status"]
        orders_by_status[st] = orders_by_status.get(st, 0) + 1
        if st != "cancelled":
            total_revenue_paise += int(o["totalPaise"])

    return {
        "cafeId": cid,
        "kpis": {
            "activeQueue": orders_by_status["confirmed"] + orders_by_status["preparing"],
            "readyForPickup": orders_by_status["ready"],
            "ordersByStatus": orders_by_status,
            "totalRevenueRupees": round(total_revenue_paise / 100.0, 2),
            "atRiskIngredients": sum(1 for v in ing_views if v.status in ("out", "critical", "low")),
            "availableDrinks": sum(1 for m in enriched_menu if m.isAvailable),
            "totalDrinks": len(enriched_menu),
            "freeTables": sum(1 for t in tables if t["status"] == "free"),
            "totalTables": len(tables),
        },
        "etaEstimate": eta,
        "atRiskStrip": [v.model_dump() for v in ing_views if v.status in ("out", "critical", "low")][:8],
        "demandLeaders": compute_demand_leaders(orders, top_n=6),
        "activeOrders": [o for o in orders if o["status"] in ("confirmed", "preparing", "ready")][:25],
        "recentInventoryEvents": inv_events[:15],
        "pendingRecommendations": [r for r in recs if r["status"] == "pending"],
        "demoState": demo_state,
        "staffRole": user.role,
        "dataAsOf": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/orders")
def list_all_orders(
    cafeId: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    user: UserContext = Depends(require_staff),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    orders = store.list_orders(cid)
    if status_filter and status_filter != "all":
        orders = [o for o in orders if o["status"] == status_filter]
    events = store.list_order_events(cid)[:40]
    return {"cafeId": cid, "orders": orders, "recentEvents": events}


@router.patch("/orders/{order_id}/status")
def update_order_status(
    order_id: str,
    body: OrderStatusUpdateRequest,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_staff),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    try:
        updated = store.transition_order_tx(
            cafe_id=cid,
            order_id=order_id,
            target_status=body.status,
            actor_id=user.uid,
            actor_role=user.role,
            reason=body.reason,
        )
    except DomainNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.message) from exc
    except DomainConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message) from exc

    event_bus.publish(cid, "order_updated", {"orderId": order_id, "status": updated["status"]})
    event_bus.publish(cid, "inventory_updated", {"reason": f"Order {order_id} -> {updated['status']}"})
    return {"order": updated}


@router.get("/inventory")
def get_inventory_ledger(
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_staff),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    menu = store.list_menu_items(cid)
    ings = store.list_ingredients(cid)
    views = enrich_ingredients_view(ings, menu)
    enriched_menu = enrich_menu_with_availability(menu, {i["id"]: i for i in ings})
    events = store.list_inventory_events(cid, limit=60)
    return {
        "cafeId": cid,
        "ingredients": [v.model_dump() for v in views],
        "menuServings": [
            {
                "id": m.id,
                "name": m.name,
                "category": m.category,
                "priceRupees": m.priceRupees,
                "active": m.active,
                "availableServings": m.availableServings,
                "isAvailable": m.isAvailable,
                "limitingIngredientName": m.limitingIngredientName,
            }
            for m in sorted(enriched_menu, key=lambda x: (x.availableServings, x.name))
        ],
        "events": events,
        "dataAsOf": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/inventory/adjust")
def adjust_inventory(
    body: RestockRequest,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_manager),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    try:
        ing, ev = store.adjust_ingredient_tx(
            cafe_id=cid,
            ingredient_id=body.ingredientId,
            delta_on_hand=body.deltaOnHand,
            actor_id=user.uid,
            reason=body.reason,
            expected_version=body.expectedVersion,
        )
    except DomainNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.message) from exc
    except DomainValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message) from exc
    except DomainConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message) from exc

    event_bus.publish(cid, "inventory_updated", {"ingredientId": body.ingredientId, "delta": body.deltaOnHand})
    return {"ingredient": ing, "event": ev}


@router.patch("/menu/{item_id}/availability")
def toggle_menu_availability(
    item_id: str,
    body: ToggleMenuAvailabilityRequest,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_manager),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    try:
        item = store.set_menu_item_active(cid, item_id, body.active)
    except DomainNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.message) from exc
    event_bus.publish(cid, "inventory_updated", {"menuItemId": item_id, "active": body.active})
    return {"item": item}


@router.get("/recommendations")
def list_operational_recommendations(
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_staff),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    return {"cafeId": cid, "recommendations": get_store(settings).list_recommendations(cid)}


@router.post("/recommendations/{rec_id}/decide")
def decide_recommendation(
    rec_id: str,
    body: DecideRecommendationRequest,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_manager),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    try:
        rec = store.decide_recommendation(cid, rec_id, body.decision, user.uid, body.note)
    except DomainNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.message) from exc

    event_bus.publish(cid, "recommendation_updated", {"recId": rec_id, "decision": body.decision})
    return {"recommendation": rec, "demoState": store.get_demo_state(cid)}
