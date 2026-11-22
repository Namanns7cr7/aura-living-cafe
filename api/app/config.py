from __future__ import annotations

import os
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

PLACEHOLDER_SECRETS = {
    "",
    "local-dev-ephemeral-secret-change-in-prod",
    "aura-local-approval-secret-2026",
    "changeme",
    "secret",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Environment ("local" or "production")
    aura_env: str = "local"

    # Google Cloud & Gemini (single canonical model ID; smoke-tested before production use)
    google_cloud_project: str = ""
    google_cloud_location: str = "asia-south1"
    google_genai_use_vertexai: bool = True
    gemini_model: str = "gemini-3.8-flash"
    google_api_key: str = ""

    # Runtime
    port: int = 8080
    aura_store_mode: str = "memory"  # "memory" or "firestore"
    demo_cafe_id: str = "demo-cafe"
    allow_demo_auth: bool = False    # Secure default: OFF unless explicitly enabled for demo-cafe
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Cost & Security Safeguards
    daily_ai_budget_requests: int = 200
    per_user_ai_rpm: int = 10
    approval_token_secret: str = "local-dev-ephemeral-secret-change-in-prod"
    approval_token_ttl_seconds: int = 600
    enable_live_gemini: bool = True

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def has_gemini_credentials(self) -> bool:
        if not self.enable_live_gemini:
            return False
        if self.google_api_key:
            return True
        if self.google_cloud_project:
            return True
        return bool(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"))

    def validate_security_posture(self) -> None:
        """Refuse to start outside local environment with a weak or placeholder signing secret."""
        is_local = self.aura_env.lower() in ("local", "test", "development")
        if not is_local:
            secret = (self.approval_token_secret or "").strip()
            if secret in PLACEHOLDER_SECRETS or len(secret) < 24:
                raise RuntimeError(
                    "FATAL: Refusing to start outside local environment with a placeholder or short "
                    "APPROVAL_TOKEN_SECRET (must be >= 24 random chars)."
                )


@lru_cache
def get_settings() -> Settings:
    return Settings()
