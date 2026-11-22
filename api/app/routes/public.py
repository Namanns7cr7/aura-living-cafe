from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth import (
    DEMO_PERSONAS,
    UserContext,
    assert_cafe_scope,
    get_optional_user,
    issue_demo_token,
)
from app.config import Settings, get_settings
from app.services.eta import estimate_pickup_eta
from app.services.events import event_bus
from app.services.inventory import (
    compute_available_units,
    enrich_ingredients_view,
    enrich_menu_with_availability,
)
from app.store.factory import get_store

router = APIRouter(prefix="/api/v1/public", tags=["public"])


class DemoLoginRequest(BaseModel):
    persona: str
    staffPasscode: str | None = None


@router.get("/menu")
def get_public_menu(
    cafeId: str | None = Query(default=None),
    category: str | None = Query(default=None),
    search: str | None = Query(default=None),
    dietary: str | None = Query(default=None),
    excludeAllergen: str | None = Query(default=None),
    user: UserContext | None = Depends(get_optional_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    menu = store.list_menu_items(cid)
    ings = {i["id"]: i for i in store.list_ingredients(cid)}
    enriched = enrich_menu_with_availability(menu, ings)

    if category and category != "all":
        enriched = [m for m in enriched if m.category == category]
    if search:
        q = search.lower().strip()
        enriched = [
            m
            for m in enriched
            if q in m.name.lower()
            or q in m.description.lower()
            or any(q in tn.lower() for tn in m.tastingNotes)
        ]
    if dietary:
        d = dietary.lower().strip()
        enriched = [m for m in enriched if d in [t.lower() for t in m.dietaryTags]]
    if excludeAllergen:
        ex = excludeAllergen.lower().strip()
        enriched = [m for m in enriched if ex not in [a.lower() for a in m.allergens]]

    demo_state = store.get_demo_state(cid)
    return {
        "cafeId": cid,
        "items": [m.model_dump() for m in enriched],
        "promoBanner": demo_state.get("promoBanner"),
        "scenario": demo_state.get("scenario", "calm"),
        "dataAsOf": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/tables")
def get_public_tables(
    cafeId: str | None = Query(default=None),
    user: UserContext | None = Depends(get_optional_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    tables = store.list_tables(cid)
    # Sanitize: never expose another customer's UID publicly
    sanitized = []
    for t in tables:
        is_mine = bool(user and t.get("reservedByUserId") == user.uid)
        sanitized.append(
            {
                "id": t["id"],
                "label": t["label"],
                "zone": t["zone"],
                "seats": t["seats"],
                "hasOutlet": t["hasOutlet"],
                "status": t["status"],
                "ambientNoiseDb": t["ambientNoiseDb"],
                "noiseSource": t["noiseSource"],
                "reservationExpiresAt": t["reservationExpiresAt"] if is_mine else None,
                "reservedByMe": is_mine,
                "x": t["x"],
                "y": t["y"],
                "updatedAt": t["updatedAt"],
            }
        )
    return {
        "cafeId": cid,
        "tables": sanitized,
        "freeCount": sum(1 for t in sanitized if t["status"] == "free"),
        "dataAsOf": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/overview")
def get_public_overview(
    cafeId: str | None = Query(default=None),
    user: UserContext | None = Depends(get_optional_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """
    Live café pulse powering both the physics homepage (Scene 3 & 4) and customer dashboard.
    Never exposes raw staff ledger values; shares normalized flow health & safe aggregate stats.
    """
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    menu = store.list_menu_items(cid)
    ings = store.list_ingredients(cid)
    ing_map = {i["id"]: i for i in ings}
    enriched_menu = enrich_menu_with_availability(menu, ing_map)
    ing_views = enrich_ingredients_view(ings, menu)
    tables = store.list_tables(cid)
    orders = store.list_orders(cid)
    demo_state = store.get_demo_state(cid)

    active_orders = [o for o in orders if o["status"] in ("confirmed", "preparing")]
    eta = estimate_pickup_eta(3, orders, {m["id"]: m for m in menu}, demo_state)

    # Highlight 5 signature ingredient flow nodes (normalized ratio 0..1 + safe servings label)
    key_nodes = []
    featured_ids = [
        ("espresso_beans_g", "Espresso Roast", 18),
        ("oat_milk_ml", "Barista Oat Milk", 180),
        ("cold_brew_concentrate_ml", "Cold Brew", 150),
        ("almond_milk_ml", "Almond Milk", 180),
        ("ceremonial_matcha_g", "Uji Matcha", 4),
    ]
    for iid, label, serving_unit in featured_ids:
        ing = ing_map.get(iid)
        if not ing:
            continue
        avail = compute_available_units(ing)
        servings = avail // serving_unit
        ratio = min(1.0, avail / max(1.0, float(ing["lowThreshold"]) * 3.0))
        key_nodes.append(
            {
                "id": iid,
                "label": label,
                "servingsEstimate": servings,
                "healthRatio": round(ratio, 2),
                "status": "out" if servings == 0 else ("low" if avail <= ing["lowThreshold"] else "healthy"),
            }
        )

    return {
        "cafeId": cid,
        "availableMenuCount": sum(1 for m in enriched_menu if m.isAvailable),
        "totalMenuCount": len(enriched_menu),
        "freeSeatsCount": sum(1 for t in tables if t["status"] == "free"),
        "totalTablesCount": len(tables),
        "activeQueueCount": len(active_orders),
        "etaEstimate": eta,
        "lowStockAlertCount": sum(1 for v in ing_views if v.status in ("out", "critical", "low")),
        "ingredientFlowNodes": key_nodes,
        "scenario": demo_state.get("scenario", "calm"),
        "scenarioLabel": demo_state.get("label", "Demo simulation"),
        "promoBanner": demo_state.get("promoBanner"),
        "dataAsOf": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/events")
async def stream_cafe_events(
    cafeId: str | None = Query(default=None),
    settings: Settings = Depends(get_settings),
):
    cid = assert_cafe_scope(cafeId, None, settings)
    return StreamingResponse(
        event_bus.subscribe(cid),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.post("/demo-login")
def demo_login(
    body: DemoLoginRequest,
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    token, ctx = issue_demo_token(
        body.persona,
        settings,
        staff_passcode=body.staffPasscode,
        require_staff_passcode=True,
    )
    return {
        "token": token,
        "user": {
            "uid": ctx.uid,
            "email": ctx.email,
            "displayName": ctx.display_name,
            "role": ctx.role,
            "cafeId": ctx.cafe_id,
            "isDemo": ctx.is_demo,
        },
        "availablePersonas": list(DEMO_PERSONAS.keys()),
        "staffPasscodeRequired": True,
    }


@router.get("/me")
def get_me(user: UserContext | None = Depends(get_optional_user)) -> dict[str, Any]:
    if not user:
        return {"authenticated": False, "user": None}
    return {
        "authenticated": True,
        "user": {
            "uid": user.uid,
            "email": user.email,
            "displayName": user.display_name,
            "role": user.role,
            "cafeId": user.cafe_id,
            "isDemo": user.is_demo,
        },
    }
