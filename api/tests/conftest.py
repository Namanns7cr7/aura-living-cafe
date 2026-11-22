from __future__ import annotations

import os
import sys

import pytest
from fastapi.testclient import TestClient

# Ensure api/ is importable
API_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)

from app.auth import issue_demo_token
from app.config import Settings, get_settings
from app.main import create_app
from app.services.rate_limit import ai_rate_limiter
from app.store.factory import set_store_for_tests
from app.store.memory_store import MemoryCafeStore


@pytest.fixture
def test_settings() -> Settings:
    return Settings(
        _env_file=None,
        aura_env="local",
        aura_store_mode="memory",
        demo_cafe_id="demo-cafe",
        allow_demo_auth=True,
        demo_staff_passcode="test-staff-pass-2026",
        enable_live_gemini=False,
        approval_token_secret="test-secret-for-unit-tests-only-1234567890",
        daily_ai_budget_requests=200,
        per_user_daily_ai_limit=100,
        per_guest_ip_daily_limit=10,
        per_user_ai_rpm=100,
    )


@pytest.fixture
def mem_store() -> MemoryCafeStore:
    store = MemoryCafeStore()
    store.seed_cafe("demo-cafe", reset=True)
    return store


@pytest.fixture
def client(test_settings: Settings, mem_store: MemoryCafeStore):
    ai_rate_limiter.reset()
    set_store_for_tests(mem_store)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: test_settings
    with TestClient(app) as tc:
        yield tc
    set_store_for_tests(None)


@pytest.fixture
def auth_headers(test_settings: Settings):
    def _make(persona: str) -> dict[str, str]:
        token, _ = issue_demo_token(persona, test_settings)
        return {"Authorization": f"Bearer {token}"}

    return _make
