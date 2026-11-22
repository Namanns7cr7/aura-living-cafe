from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth import UserContext, assert_cafe_scope, require_manager
from app.config import Settings, get_settings
from app.models import SetDemoScenarioRequest
from app.services.events import event_bus
from app.store.base import DomainValidationError
from app.store.factory import get_store

router = APIRouter(prefix="/api/v1/demo", tags=["demo"])


@router.post("/scenario")
def set_demo_scenario(
    body: SetDemoScenarioRequest,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_manager),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    try:
        state = store.set_demo_scenario(cid, body.scenario, user.uid)
    except DomainValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message) from exc

    event_bus.publish(cid, "demo_updated", {"scenario": state["scenario"]})
    event_bus.publish(cid, "inventory_updated", {"reason": f"Demo scenario -> {state['scenario']}"})
    return {"demoState": state}


@router.post("/reset")
def reset_demo_cafe(
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_manager),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    counts = get_store(settings).seed_cafe(cid, reset=True)
    event_bus.publish(cid, "demo_updated", {"scenario": "calm", "reset": True})
    event_bus.publish(cid, "inventory_updated", {"reason": "Demo reset"})
    event_bus.publish(cid, "table_updated", {"reset": True})
    return {"cafeId": cid, "reset": True, "counts": counts}
