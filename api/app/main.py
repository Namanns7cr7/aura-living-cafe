from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routes import agent, customer, demo, public, staff
from app.services.rate_limit import ai_rate_limiter
from app.store.factory import get_store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("aura.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = get_settings()
    cfg.validate_security_posture()
    store = get_store(cfg)
    if cfg.aura_store_mode.lower() == "memory":
        counts = store.seed_cafe(cfg.demo_cafe_id, reset=False)
        logger.info("AURA memory store seeded: %s", counts)
    logger.info(
        "AURA API ready | env=%s | store=%s | demo_auth=%s | project=%s | region=%s | model=%s | gemini_creds=%s",
        cfg.aura_env,
        cfg.aura_store_mode,
        cfg.allow_demo_auth,
        cfg.google_cloud_project or "(local)",
        cfg.google_cloud_location,
        cfg.gemini_model,
        cfg.has_gemini_credentials,
    )
    yield


def create_app() -> FastAPI:
    cfg = get_settings()
    app = FastAPI(
        title="AURA — The Living Café API",
        version="1.0.0",
        description="People Intelligence × Inventory Intelligence backend powered by FastAPI, Firestore, and Google ADK.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Idempotency-Key"],
    )

    app.include_router(public.router)
    app.include_router(customer.router)
    app.include_router(staff.router)
    app.include_router(agent.router)
    app.include_router(demo.router)

    @app.get("/health")
    def health() -> dict[str, Any]:
        c = get_settings()
        return {
            "status": "ok",
            "service": "aura-api",
            "storeMode": c.aura_store_mode,
            "cafeId": c.demo_cafe_id,
            "region": c.google_cloud_location,
            "geminiModel": c.gemini_model,
            "geminiConfigured": c.has_gemini_credentials,
            "aiBudget": ai_rate_limiter.stats(c),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    return app


app = create_app()
