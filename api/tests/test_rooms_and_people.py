from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone


def test_concurrent_seat_reservation_allows_only_one(client, auth_headers):
    def try_reserve(i: int):
        h = auth_headers("customer-1" if i % 2 == 0 else "customer-2")
        return client.post("/api/v1/customer/tables/reserve", headers=h, json={"tableId": "Q1", "durationMinutes": 45})

    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(try_reserve, range(4)))

    assert sum(1 for r in results if r.status_code == 200) == 1
    assert sum(1 for r in results if r.status_code == 409) == 3


def test_expired_reservation_lazily_releases_table(client, auth_headers, mem_store):
    h1 = auth_headers("customer-1")
    r = client.post("/api/v1/customer/tables/reserve", headers=h1, json={"tableId": "W1", "durationMinutes": 30})
    assert r.status_code == 200

    # Force expiry into the past in the store
    past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    mem_store._cafes["demo-cafe"]["tables"]["W1"]["reservationExpiresAt"] = past

    # Listing tables lazily expires W1 -> now free and bookable by customer-2
    tbls = {t["id"]: t for t in client.get("/api/v1/public/tables").json()["tables"]}
    assert tbls["W1"]["status"] == "free"

    h2 = auth_headers("customer-2")
    r2 = client.post("/api/v1/customer/tables/reserve", headers=h2, json={"tableId": "W1", "durationMinutes": 30})
    assert r2.status_code == 200


def test_connect_sessions_opt_in_and_host_approval_privacy(client, auth_headers):
    c1 = auth_headers("customer-1")  # Ananya
    c2 = auth_headers("customer-2")  # Rohan (host of sess-ai-builders)

    # Cannot host session before opting in
    denied = client.post(
        "/api/v1/customer/sessions",
        headers=c1,
        json={"title": "Unopted Meetup", "description": "Should be blocked", "tags": ["AI"]},
    )
    assert denied.status_code == 403

    # Before approval, Ananya MUST NOT see private meetingNote of approval-gated session
    before_list = client.get("/api/v1/customer/sessions", headers=c1).json()["sessions"]
    ai_sess = next(s for s in before_list if s["id"] == "sess-ai-builders")
    assert ai_sess["meetingNote"] is None
    assert ai_sess["pendingRequests"] == []

    # Ananya requests to join -> pending, still no meetingNote
    req = client.post(
        "/api/v1/customer/sessions/sess-ai-builders/join",
        headers=c1,
        json={"note": "Building with ADK!"},
    )
    assert req.status_code == 200
    assert req.json()["session"]["isPending"] is True
    assert req.json()["session"]["meetingNote"] is None

    # Non-host cannot approve
    bad_approve = client.post(
        "/api/v1/customer/sessions/sess-ai-builders/decide",
        headers=c1,
        json={"targetUserId": "demo-customer-ananya", "approve": True},
    )
    assert bad_approve.status_code == 403

    # Host (Rohan) approves -> now Ananya sees meetingNote
    ok_approve = client.post(
        "/api/v1/customer/sessions/sess-ai-builders/decide",
        headers=c2,
        json={"targetUserId": "demo-customer-ananya", "approve": True},
    )
    assert ok_approve.status_code == 200

    after_list = client.get("/api/v1/customer/sessions", headers=c1).json()["sessions"]
    ai_after = next(s for s in after_list if s["id"] == "sess-ai-builders")
    assert ai_after["isApprovedMember"] is True
    assert ai_after["meetingNote"] is not None

    # Leaving revokes membership & meetingNote
    left = client.post("/api/v1/customer/sessions/sess-ai-builders/leave", headers=c1)
    assert left.status_code == 200
    assert left.json()["session"]["isApprovedMember"] is False
    assert left.json()["session"]["meetingNote"] is None
