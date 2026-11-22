from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from app.agents.customer_agent import generate_visit_plan
from app.agents.inventory_agent import generate_inventory_insights
from app.auth import UserContext, assert_cafe_scope, get_optional_user, require_staff
from app.config import Settings, get_settings
from app.models import OpsInsightRequest, OpsInsightResponse, VisitPlanRequest, VisitPlanResponse
from app.services.rate_limit import ai_rate_limiter
from app.store.factory import get_store

router = APIRouter(prefix="/api/v1/agent", tags=["agent"])


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    if request.client and request.client.host:
        return request.client.host
    return "unknown-ip"


@router.post("/plan", response_model=VisitPlanResponse)
async def customer_visit_plan(
    body: VisitPlanRequest,
    request: Request,
    cafeId: str | None = Query(default=None),
    user: UserContext | None = Depends(get_optional_user),
    settings: Settings = Depends(get_settings),
) -> VisitPlanResponse:
    cid = assert_cafe_scope(cafeId or body.cafeId, user, settings)
    if user is not None:
        ai_rate_limiter.check_and_consume(f"uid:{user.uid}", settings, is_guest=False)
    else:
        ai_rate_limiter.check_and_consume(f"ip:{_client_ip(request)}", settings, is_guest=True)
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
    ai_rate_limiter.check_and_consume(f"uid:{user.uid}", settings, is_guest=False)
    store = get_store(settings)
    return await generate_inventory_insights(
        store=store,
        cafe_id=cid,
        req=body,
        actor_id=user.uid,
        settings=settings,
        persist_proposals=True,
    )
