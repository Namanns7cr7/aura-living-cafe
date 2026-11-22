from __future__ import annotations

import uuid
import pytest

from app.agents.tools import build_customer_tools
from app.config import Settings


def test_default_settings_disable_demo_auth_and_reject_weak_prod_secret():
    default_cfg = Settings(_env_file=None)
    assert default_cfg.allow_demo_auth is False

    bad_prod = Settings(
        _env_file=None,
        aura_env="production",
        approval_token_secret="local-dev-ephemeral-secret-change-in-prod",
    )
    with pytest.raises(RuntimeError, match="Refusing to start"):
        bad_prod.validate_security_posture()

    good_prod = Settings(
        _env_file=None,
        aura_env="production",
        approval_token_secret="a-strong-randomly-generated-prod-secret-99887766",
    )
    good_prod.validate_security_posture()  # Must not raise


def test_customer_agent_has_no_order_mutation_tool(mem_store):
    tools = build_customer_tools(mem_store, "demo-cafe", None)
    assert "create_order_after_confirmation" not in tools
    assert "confirm_order" not in tools
    assert set(tools.keys()) == {
        "get_menu",
        "find_available_drinks",
        "check_ingredients",
        "get_available_seats",
        "estimate_wait",
        "get_order_status",
    }


def test_rbac_blocks_customers_and_baristas_from_privileged_routes(client, auth_headers):
    cust_h = auth_headers("customer-1")
    barista_h = auth_headers("barista-1")

    # Unauthenticated blocked
    assert client.get("/api/v1/staff/dashboard").status_code == 401
    assert client.get("/api/v1/customer/orders").status_code == 401

    # Customer blocked from staff & manager routes
    assert client.get("/api/v1/staff/dashboard", headers=cust_h).status_code == 403
    assert client.get("/api/v1/staff/inventory", headers=cust_h).status_code == 403
    assert client.post("/api/v1/agent/ops-insights", headers=cust_h, json={"question": "Stock?"}).status_code == 403
    assert client.post("/api/v1/demo/scenario", headers=cust_h, json={"scenario": "rush"}).status_code == 403

    # Barista can view staff dashboard, CANNOT restock or change demo scenarios (manager-only)
    assert client.get("/api/v1/staff/dashboard", headers=barista_h).status_code == 200
    assert (
        client.post(
            "/api/v1/staff/inventory/adjust",
            headers=barista_h,
            json={"ingredientId": "oat_milk_ml", "deltaOnHand": 500, "reason": "Unauthorized"},
        ).status_code
        == 403
    )
    assert client.post("/api/v1/demo/scenario", headers=barista_h, json={"scenario": "rush"}).status_code == 403


def test_cross_user_order_isolation_and_cross_cafe_rejection(client, auth_headers):
    c1 = auth_headers("customer-1")
    c2 = auth_headers("customer-2")

    # Customer 1 places an order
    prev = client.post("/api/v1/customer/orders/preview", headers=c1, json={"items": [{"menuItemId": "classic-cold-brew", "qty": 1}]})
    tok = prev.json()["approvalToken"]
    conf = client.post(
        "/api/v1/customer/orders/confirm",
        headers=c1,
        json={"items": [{"menuItemId": "classic-cold-brew", "qty": 1}], "idempotencyKey": f"iso-{uuid.uuid4().hex}", "approvalToken": tok},
    )
    oid = conf.json()["order"]["id"]

    # Customer 2 cannot read or cancel Customer 1's order
    assert client.get(f"/api/v1/customer/orders/{oid}", headers=c2).status_code == 403
    assert client.post(f"/api/v1/customer/orders/{oid}/cancel", headers=c2).status_code == 403

    # Cross-café ID swap rejected
    assert client.get("/api/v1/public/menu?cafeId=other-cafe", headers=c1).status_code == 403
    assert client.get("/api/v1/customer/orders?cafeId=other-cafe", headers=c1).status_code == 403


def test_tampered_cart_or_approval_token_rejected(client, auth_headers):
    c1 = auth_headers("customer-1")
    prev = client.post("/api/v1/customer/orders/preview", headers=c1, json={"items": [{"menuItemId": "classic-cold-brew", "qty": 1}]})
    tok = prev.json()["approvalToken"]

    # Attempt to change item quantity after approval preview -> 409 conflict
    tampered = client.post(
        "/api/v1/customer/orders/confirm",
        headers=c1,
        json={"items": [{"menuItemId": "classic-cold-brew", "qty": 2}], "idempotencyKey": f"tamp-{uuid.uuid4().hex}", "approvalToken": tok},
    )
    assert tampered.status_code == 409

    # Forged token -> 400/403
    forged = client.post(
        "/api/v1/customer/orders/confirm",
        headers=c1,
        json={"items": [{"menuItemId": "classic-cold-brew", "qty": 1}], "idempotencyKey": f"forg-{uuid.uuid4().hex}", "approvalToken": "apr.fakehash.9999999999.badsig"},
    )
    assert forged.status_code in (400, 403)
