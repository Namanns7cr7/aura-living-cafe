from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.agents.tools import build_approval_preview
from app.auth import (
    UserContext,
    assert_cafe_scope,
    require_authenticated,
    verify_approval_token,
)
from app.config import Settings, get_settings
from app.models import (
    ApprovalPreviewResponse,
    ConfirmOrderRequest,
    CreateSessionRequest,
    DecideJoinRequest,
    JoinSessionRequest,
    PrepareApprovalRequest,
    ReserveTableRequest,
    UpdatePreferencesRequest,
)
from app.services.events import event_bus
from app.services.inventory import enrich_menu_with_availability, find_in_stock_substitutes
from app.store.base import DomainConflictError, DomainNotFoundError, DomainValidationError
from app.store.factory import get_store

router = APIRouter(prefix="/api/v1/customer", tags=["customer"])


@router.post("/orders/preview", response_model=ApprovalPreviewResponse)
def preview_order_approval(
    body: PrepareApprovalRequest,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_authenticated),
    settings: Settings = Depends(get_settings),
) -> ApprovalPreviewResponse:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    try:
        return build_approval_preview(
            store=store,
            cafe_id=cid,
            user=user,
            items=body.items,
            table_id=body.tableId,
            settings=settings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/orders/confirm")
def confirm_order(
    body: ConfirmOrderRequest,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_authenticated),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)

    # Enforce explicit human approval token matching exact normalized cart & table
    approval_payload = {
        "items": [
            {"menuItemId": i.menuItemId, "qty": i.qty, "selectedModifierIds": sorted(i.selectedModifierIds)}
            for i in body.items
        ],
        "tableId": body.tableId,
    }
    verify_approval_token(body.approvalToken, user.uid, cid, approval_payload, settings)

    store = get_store(settings)
    try:
        order, was_replay = store.confirm_order_tx(
            cafe_id=cid,
            user_id=user.uid,
            customer_name=user.display_name,
            cart_items=[i.model_dump() for i in body.items],
            idempotency_key=body.idempotencyKey,
            table_id=body.tableId,
            notes=body.notes,
        )
    except DomainConflictError as exc:
        # Provide helpful real in-stock substitutes when sold out!
        substitutes = []
        if exc.code == "insufficient_stock":
            menu = store.list_menu_items(cid)
            ings = {i["id"]: i for i in store.list_ingredients(cid)}
            enriched = enrich_menu_with_availability(menu, ings)
            first_item = next((m for m in menu if m["id"] == body.items[0].menuItemId), None)
            if first_item:
                subs = find_in_stock_substitutes(first_item, enriched, limit=3)
                substitutes = [
                    {"id": s.id, "name": s.name, "priceRupees": s.priceRupees, "availableServings": s.availableServings}
                    for s in subs
                ]
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": exc.message, "code": exc.code, "details": exc.details, "substitutes": substitutes},
        ) from exc
    except DomainValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message) from exc
    except DomainNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.message) from exc

    if not was_replay:
        event_bus.publish(cid, "order_created", {"orderId": order["id"], "status": order["status"]})
        event_bus.publish(cid, "inventory_updated", {"reason": f"Order {order['id']} reserved"})
        if order.get("tableId"):
            event_bus.publish(cid, "table_updated", {"tableId": order["tableId"], "status": "reserved"})

    return {"order": order, "idempotentReplay": was_replay}


@router.get("/orders")
def list_my_orders(
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_authenticated),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    orders = store.list_orders(cid, user_id=user.uid)
    return {"cafeId": cid, "orders": orders}


@router.get("/orders/{order_id}")
def get_order_detail(
    order_id: str,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_authenticated),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    order = store.get_order(cid, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if user.role == "customer" and order["userId"] != user.uid:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only view your own orders.")
    events = store.list_order_events(cid, order_id=order_id)
    return {"order": order, "events": events}


@router.post("/orders/{order_id}/cancel")
def cancel_my_order(
    order_id: str,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_authenticated),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    order = store.get_order(cid, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if user.role == "customer" and order["userId"] != user.uid:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only cancel your own orders.")
    if order["status"] != "confirmed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Orders can only be cancelled by customers before preparation begins.",
        )
    try:
        updated = store.transition_order_tx(cid, order_id, "cancelled", user.uid, user.role, "Cancelled by customer")
    except DomainConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message) from exc

    event_bus.publish(cid, "order_updated", {"orderId": order_id, "status": "cancelled"})
    event_bus.publish(cid, "inventory_updated", {"reason": f"Order {order_id} cancelled"})
    if updated.get("tableId"):
        event_bus.publish(cid, "table_updated", {"tableId": updated["tableId"], "status": "free"})
    return {"order": updated}


@router.post("/tables/reserve")
def reserve_table(
    body: ReserveTableRequest,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_authenticated),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    try:
        table, reservation = store.reserve_table_tx(cid, body.tableId, user.uid, body.durationMinutes)
    except DomainNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.message) from exc
    except DomainConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message) from exc
    event_bus.publish(cid, "table_updated", {"tableId": table["id"], "status": table["status"]})
    return {"table": table, "reservation": reservation}


@router.post("/tables/{table_id}/release")
def release_table(
    table_id: str,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_authenticated),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    try:
        table = store.release_table_tx(cid, table_id, user.uid, is_staff=user.role in ("barista", "manager"))
    except DomainNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.message) from exc
    except DomainConflictError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=exc.message) from exc
    event_bus.publish(cid, "table_updated", {"tableId": table["id"], "status": "free"})
    return {"table": table}


@router.get("/preferences")
def get_my_preferences(
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_authenticated),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    return {"preferences": get_store(settings).get_preferences(cid, user.uid)}


@router.put("/preferences")
def update_my_preferences(
    body: UpdatePreferencesRequest,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_authenticated),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    updated = get_store(settings).update_preferences(cid, user.uid, body.model_dump())
    return {"preferences": updated}


# --- Opt-in Community / Connect (Privacy-first: no exact table or PII exposed) ---

def _sanitize_session_for_user(sess: dict[str, Any], user: UserContext) -> dict[str, Any]:
    is_host = sess["hostId"] == user.uid
    is_approved = user.uid in sess.get("approvedMemberIds", [])
    is_pending = any(r["userId"] == user.uid for r in sess.get("pendingRequests", []))
    return {
        "id": sess["id"],
        "title": sess["title"],
        "description": sess["description"],
        "tags": sess["tags"],
        "hostDisplayName": sess["hostDisplayName"],
        "zoneHint": sess["zoneHint"],
        "startTimeLabel": sess["startTimeLabel"],
        "joinPolicy": sess["joinPolicy"],
        "maxMembers": sess["maxMembers"],
        "memberCount": len(sess.get("approvedMemberIds", [])),
        "isHost": is_host,
        "isApprovedMember": is_approved,
        "isPending": is_pending,
        # Meeting details revealed ONLY after host approval!
        "meetingNote": sess.get("meetingNoteForApproved", "") if (is_host or is_approved) else None,
        # Pending requests visible ONLY to host!
        "pendingRequests": sess.get("pendingRequests", []) if is_host else [],
        "createdAt": sess["createdAt"],
    }


@router.get("/sessions")
def list_community_sessions(
    cafeId: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    user: UserContext = Depends(require_authenticated),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    sessions = [s for s in store.list_sessions(cid) if s.get("visibility") == "public" or s["hostId"] == user.uid]
    if tag:
        t = tag.lower().strip()
        sessions = [s for s in sessions if any(t == x.lower() for x in s.get("tags", []))]
    prefs = store.get_preferences(cid, user.uid)
    return {
        "cafeId": cid,
        "discoverableInConnect": prefs.get("discoverableInConnect", False),
        "sessions": [_sanitize_session_for_user(s, user) for s in sessions],
    }


@router.post("/sessions")
def create_community_session(
    body: CreateSessionRequest,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_authenticated),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    prefs = store.get_preferences(cid, user.uid)
    if not prefs.get("discoverableInConnect"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please opt in to Connect in your privacy settings before hosting a public session.",
        )
    sess = store.create_session(
        cid,
        {
            "title": body.title,
            "description": body.description,
            "tags": [t.strip() for t in body.tags if t.strip()],
            "hostId": user.uid,
            "hostDisplayName": user.display_name,
            "zoneHint": body.zoneHint,
            "meetingNoteForApproved": body.meetingNoteForApproved,
            "startTimeLabel": body.startTimeLabel,
            "joinPolicy": body.joinPolicy,
            "visibility": "public",
            "maxMembers": body.maxMembers,
            "approvedMemberIds": [user.uid],
            "pendingRequests": [],
        },
    )
    return {"session": _sanitize_session_for_user(sess, user)}


@router.post("/sessions/{session_id}/join")
def join_community_session(
    session_id: str,
    body: JoinSessionRequest,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_authenticated),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    try:
        sess = store.request_join_session(cid, session_id, user.uid, user.display_name, body.note)
    except DomainNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.message) from exc
    except DomainConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message) from exc
    return {"session": _sanitize_session_for_user(sess, user)}


@router.post("/sessions/{session_id}/decide")
def decide_join_request(
    session_id: str,
    body: DecideJoinRequest,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_authenticated),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    store = get_store(settings)
    try:
        sess = store.decide_join_session(cid, session_id, user.uid, body.targetUserId, body.approve)
    except DomainNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.message) from exc
    except DomainConflictError as exc:
        code = status.HTTP_403_FORBIDDEN if exc.code == "forbidden" else status.HTTP_409_CONFLICT
        raise HTTPException(status_code=code, detail=exc.message) from exc
    return {"session": _sanitize_session_for_user(sess, user)}


@router.post("/sessions/{session_id}/leave")
def leave_community_session(
    session_id: str,
    cafeId: str | None = Query(default=None),
    user: UserContext = Depends(require_authenticated),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cid = assert_cafe_scope(cafeId, user, settings)
    try:
        sess = get_store(settings).leave_session(cid, session_id, user.uid)
    except DomainNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.message) from exc
    return {"session": _sanitize_session_for_user(sess, user)}
