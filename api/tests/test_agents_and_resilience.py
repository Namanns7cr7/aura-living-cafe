from __future__ import annotations

import asyncio

from app.agents.customer_agent import validate_grounded_summary
from app.config import Settings, get_settings
from app.services.rate_limit import ai_rate_limiter
from evals.eval_scenarios import run_evaluations


def test_32_ai_evaluation_scenarios_pass():
    report = asyncio.run(run_evaluations(use_live_gemini=False))
    assert report["n_cases"] >= 32
    assert report["failed_n"] == 0, f"Eval failures: {report['failures']}"
    assert report["grounded_n"] == report["n_cases"]
    assert report["authorization_safe_n"] == report["n_cases"]


def test_grounded_summary_validator_rejects_hallucinated_price_and_drink(mem_store):
    all_menu = mem_store.list_menu_items("demo-cafe")
    candidates = [
        {"name": "18-Hour Slow Cold Brew", "priceRupees": 180.0, "pricePaise": 18000},
    ]

    # Valid grounded summary passes
    ok, reason = validate_grounded_summary(
        "Try our 18-Hour Slow Cold Brew at ₹180 (fits your ₹200 budget).",
        candidates,
        [],
        all_menu,
        max_price_rupees=200,
    )
    assert ok is True and reason is None

    # Hallucinated ₹ price rejected
    ok_price, reason_price = validate_grounded_summary(
        "Try our 18-Hour Slow Cold Brew for just ₹99!",
        candidates,
        [],
        all_menu,
        max_price_rupees=200,
    )
    assert ok_price is False and "₹99" in (reason_price or "")

    # Mentioning an excluded / non-candidate catalog drink rejected
    ok_drink, reason_drink = validate_grounded_summary(
        "Try our Iced Almond Cloud Latte at ₹180!",
        candidates,
        [],
        all_menu,
        max_price_rupees=200,
    )
    assert ok_drink is False and "Iced Almond Cloud Latte" in (reason_drink or "")


def test_per_user_and_per_ip_rate_limit_protects_shared_budget(client, auth_headers, test_settings):
    tight = Settings(
        _env_file=None,
        aura_env="local",
        aura_store_mode="memory",
        demo_cafe_id="demo-cafe",
        allow_demo_auth=True,
        demo_staff_passcode="test-staff-pass-2026",
        enable_live_gemini=False,
        approval_token_secret=test_settings.approval_token_secret,
        daily_ai_budget_requests=10,
        per_user_daily_ai_limit=2,
        per_guest_ip_daily_limit=1,
        per_user_ai_rpm=10,
    )
    client.app.dependency_overrides[get_settings] = lambda: tight
    ai_rate_limiter.reset()

    # Guest IP A hits per_guest_ip_daily_limit=1, while Guest IP B still works!
    g_a1 = client.post("/api/v1/agent/plan", headers={"X-Forwarded-For": "10.0.0.1"}, json={"message": "Cold brew"})
    g_a2 = client.post("/api/v1/agent/plan", headers={"X-Forwarded-For": "10.0.0.1"}, json={"message": "Cold brew"})
    g_b1 = client.post("/api/v1/agent/plan", headers={"X-Forwarded-For": "10.0.0.2"}, json={"message": "Cold brew"})
    assert g_a1.status_code == 200
    assert g_a2.status_code == 429
    assert g_b1.status_code == 200

    # Authenticated customer-1 hits per_user_daily_ai_limit=2 without starving customer-2!
    c1 = auth_headers("customer-1")
    c2 = auth_headers("customer-2")
    assert client.post("/api/v1/agent/plan", headers=c1, json={"message": "Cold coffee under ₹250"}).status_code == 200
    assert client.post("/api/v1/agent/plan", headers=c1, json={"message": "Hot espresso under ₹200"}).status_code == 200
    assert client.post("/api/v1/agent/plan", headers=c1, json={"message": "Third call blocked"}).status_code == 429
    assert client.post("/api/v1/agent/plan", headers=c2, json={"message": "Customer 2 still works!"}).status_code == 200

    # Even when AI limit is reached, normal deterministic menu & ordering still works!
    menu = client.get("/api/v1/public/menu")
    assert menu.status_code == 200
    assert len(menu.json()["items"]) >= 20
