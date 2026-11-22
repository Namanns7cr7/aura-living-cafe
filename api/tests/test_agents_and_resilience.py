from __future__ import annotations

import asyncio

from app.config import Settings, get_settings
from app.services.rate_limit import ai_rate_limiter
from evals.eval_scenarios import run_evaluations


def test_28_ai_evaluation_scenarios_pass():
    report = asyncio.run(run_evaluations(use_live_gemini=False))
    assert report["n_cases"] >= 25
    assert report["failed_n"] == 0, f"Eval failures: {report['failures']}"
    assert report["grounded_n"] == report["n_cases"]
    assert report["authorization_safe_n"] == report["n_cases"]


def test_agent_endpoint_rate_limit_and_daily_budget(client, auth_headers, test_settings):
    # Override with tight budget (2 requests/day) to verify guardrail
    tight = Settings(
        _env_file=None,
        aura_env="local",
        aura_store_mode="memory",
        demo_cafe_id="demo-cafe",
        allow_demo_auth=True,
        enable_live_gemini=False,
        approval_token_secret=test_settings.approval_token_secret,
        daily_ai_budget_requests=2,
        per_user_ai_rpm=10,
    )
    client.app.dependency_overrides[get_settings] = lambda: tight
    ai_rate_limiter.reset()

    cust_h = auth_headers("customer-1")
    r1 = client.post("/api/v1/agent/plan", headers=cust_h, json={"message": "Cold coffee under ₹250"})
    r2 = client.post("/api/v1/agent/plan", headers=cust_h, json={"message": "Hot espresso under ₹200"})
    r3 = client.post("/api/v1/agent/plan", headers=cust_h, json={"message": "Another request"})

    assert r1.status_code == 200
    assert r1.json()["source"] == "deterministic"  # Never falsely labeled "gemini"
    assert r2.status_code == 200
    assert r3.status_code == 429

    # Even when AI budget is exhausted, normal deterministic menu & ordering still works!
    menu = client.get("/api/v1/public/menu")
    assert menu.status_code == 200
    assert len(menu.json()["items"]) >= 20
