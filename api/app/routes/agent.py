from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.agents.customer_agent import generate_visit_plan
from app.agents.inventory_agent import generate_inventory_insights
from app.auth import UserContext, assert_cafe_scope, get_optional_user, require_staff
from app.config import Settings, get_settings
from app.models import OpsInsightRequest, OpsInsightResponse, VisitPlanRequest, VisitPlanResponse
from app.services.rate_limit import ai_rate_limiter
from app.store.factory import get_store

router = APIRouter(prefix="/api/v1/agent", tags=["agent"])


@router.post("/plan", response_model=VisitPlanResponse)
async def customer_visit_plan(
    body: VisitPlanRequest,
    cafeId: str | None = Query(default=None),
    user: UserContext | None = Depends(get_optional_user),
    settings: Settings = Depends(get_settings),
) -> VisitPlanResponse:
    cid = assert_cafe_scope(cafeId or body.cafeId, user, settings)
    user_key = user.uid if user else "guest-anon"
    ai_rate_limiter.check_and_consume(user_key, settings)
    store = get_store(settings)
    return await generate_visit_plan(
        store=store,
        cafe_id=cid,
        req=body,
        user=user,
        settings=settings,
    )


@router.post("/ops-insights", response_model=OpsInsightResponse)
async def staff_ops_insights(
    body: OpsInsightRequest,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_staff),
    settings: Settings = Depends(get_settings),
) -> OpsInsightResponse:
    cid = assert_cafe_scope(cafeId or body.cafeId, user, settings)
    ai_rate_limiter.check_and_consume(user.uid, settings)
    store = get_store(settings)
    return await generate_inventory_insights(
        store=store,
        cafe_id=cid,
        req=body,
        actor_id=user.uid,
        settings=settings,
        persist_proposals=True,
    )
