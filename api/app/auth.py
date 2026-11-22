from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import Depends, Header, HTTPException, Query, status

from app.config import Settings, get_settings

RoleType = Literal["guest", "customer", "barista", "manager"]


@dataclass(frozen=True)
class UserContext:
    uid: str
    email: str
    display_name: str
    role: RoleType
    cafe_id: str
    is_demo: bool = True


# Controlled, isolated demo personas (used ONLY when ALLOW_DEMO_AUTH=true)
DEMO_PERSONAS: dict[str, dict[str, str]] = {
    "customer-1": {
        "uid": "demo-customer-ananya",
        "email": "ananya.demo@aura.cafe",
        "display_name": "Ananya (Customer)",
        "role": "customer",
    },
    "customer-2": {
        "uid": "demo-customer-rohan",
        "email": "rohan.demo@aura.cafe",
        "display_name": "Rohan (Customer)",
        "role": "customer",
    },
    "barista-1": {
        "uid": "demo-barista-kabir",
        "email": "kabir.demo@aura.cafe",
        "display_name": "Kabir (Barista)",
        "role": "barista",
    },
    "manager-1": {
        "uid": "demo-manager-meera",
        "email": "meera.demo@aura.cafe",
        "display_name": "Meera (Manager)",
        "role": "manager",
    },
}


def issue_demo_token(
    persona_key: str,
    settings: Settings | None = None,
    staff_passcode: str | None = None,
    require_staff_passcode: bool = False,
) -> tuple[str, UserContext]:
    cfg = settings or get_settings()
    if not cfg.allow_demo_auth:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Demo auth is disabled")
    if cfg.demo_cafe_id != "demo-cafe":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Demo auth is strictly restricted to the isolated 'demo-cafe' namespace.",
        )
    if persona_key not in DEMO_PERSONAS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown demo persona")
    p = DEMO_PERSONAS[persona_key]
    if require_staff_passcode and p["role"] in ("barista", "manager"):
        expected = (cfg.demo_staff_passcode or "").strip()
        provided = (staff_passcode or "").strip()
        if not expected:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Staff demo login is disabled. Sign in with a Firebase staff account or configure DEMO_STAFF_PASSCODE.",
            )
        if not provided or not hmac.compare_digest(provided, expected):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid staff passcode for barista/manager demo persona.",
            )
    exp = int(time.time()) + 86400
    payload = f"{persona_key}:{exp}:demo-cafe"
    sig = hmac.new(cfg.approval_token_secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()[:24]
    token = f"demo.{persona_key}.{exp}.{sig}"
    ctx = UserContext(
        uid=p["uid"],
        email=p["email"],
        display_name=p["display_name"],
        role=p["role"],  # type: ignore[arg-type]
        cafe_id="demo-cafe",
        is_demo=True,
    )
    return token, ctx


def _verify_demo_token(token: str, cfg: Settings) -> UserContext | None:
    if not cfg.allow_demo_auth or cfg.demo_cafe_id != "demo-cafe":
        return None
    if not token.startswith("demo."):
        return None
    parts = token.split(".")
    if len(parts) != 4:
        return None
    _, persona_key, exp_str, sig = parts
    if persona_key not in DEMO_PERSONAS:
        return None
    try:
        exp = int(exp_str)
    except ValueError:
        return None
    if exp < int(time.time()):
        return None
    expected_payload = f"{persona_key}:{exp}:demo-cafe"
    expected_sig = hmac.new(
        cfg.approval_token_secret.encode("utf-8"),
        expected_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:24]
    if not hmac.compare_digest(sig, expected_sig):
        return None
    p = DEMO_PERSONAS[persona_key]
    return UserContext(
        uid=p["uid"],
        email=p["email"],
        display_name=p["display_name"],
        role=p["role"],  # type: ignore[arg-type]
        cafe_id="demo-cafe",
        is_demo=True,
    )


def _verify_firebase_token(token: str, cfg: Settings) -> UserContext | None:
    try:
        import firebase_admin
        from firebase_admin import auth as fb_auth

        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        decoded = fb_auth.verify_id_token(token)
        role_claim = decoded.get("role", "customer")
        if role_claim not in ("customer", "barista", "manager"):
            role_claim = "customer"
        cafe_id = decoded.get("cafeId", cfg.demo_cafe_id)
        return UserContext(
            uid=decoded["uid"],
            email=decoded.get("email", ""),
            display_name=decoded.get("name") or decoded.get("email", "AURA Guest"),
            role=role_claim,  # type: ignore[arg-type]
            cafe_id=cafe_id,
            is_demo=False,
        )
    except Exception:
        return None


def resolve_user_from_token(authorization: str | None, cfg: Settings) -> UserContext | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    raw = token.strip()
    if raw.startswith("demo."):
        return _verify_demo_token(raw, cfg)
    return _verify_firebase_token(raw, cfg)


def get_optional_user(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> UserContext | None:
    return resolve_user_from_token(authorization, settings)


def require_authenticated(
    user: UserContext | None = Depends(get_optional_user),
) -> UserContext:
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Sign in with Firebase or select a demo account.",
        )
    return user


def require_staff(user: UserContext = Depends(require_authenticated)) -> UserContext:
    if user.role not in ("barista", "manager"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Staff role (barista or manager) required for this operation.",
        )
    return user


def require_manager(user: UserContext = Depends(require_authenticated)) -> UserContext:
    if user.role != "manager":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager authorization is strictly required for this action.",
        )
    return user


def assert_cafe_scope(cafe_id: str | None, user: UserContext | None, cfg: Settings) -> str:
    target = (cafe_id or cfg.demo_cafe_id).strip()
    if user is not None and target != user.cafe_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Cross-café access denied: account is scoped to '{user.cafe_id}', not '{target}'.",
        )
    if target != cfg.demo_cafe_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Unknown or unauthorized café namespace '{target}'.",
        )
    return target


# --- Cryptographic Human-Approval Token for State-Changing Actions ---

def _canonical_approval_hash(user_id: str, cafe_id: str, payload: dict[str, Any]) -> str:
    normalized = json.dumps(
        {"userId": user_id, "cafeId": cafe_id, "payload": payload},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:32]


def create_approval_token(
    user_id: str,
    cafe_id: str,
    payload: dict[str, Any],
    settings: Settings | None = None,
) -> tuple[str, int]:
    cfg = settings or get_settings()
    exp = int(time.time()) + cfg.approval_token_ttl_seconds
    digest = _canonical_approval_hash(user_id, cafe_id, payload)
    body = f"apr.{digest}.{exp}"
    sig = hmac.new(
        cfg.approval_token_secret.encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:28]
    return f"{body}.{sig}", exp


def verify_approval_token(
    token: str,
    user_id: str,
    cafe_id: str,
    payload: dict[str, Any],
    settings: Settings | None = None,
) -> None:
    cfg = settings or get_settings()
    parts = token.split(".")
    if len(parts) != 4 or parts[0] != "apr":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid approval token. Explicit user confirmation preview is required before committing.",
        )
    _, digest, exp_str, sig = parts
    try:
        exp = int(exp_str)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed approval token expiry.")
    if exp < int(time.time()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Approval token expired. Please review updated prices and stock before confirming.",
        )
    body = f"apr.{digest}.{exp}"
    expected_sig = hmac.new(
        cfg.approval_token_secret.encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:28]
    if not hmac.compare_digest(sig, expected_sig):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Approval token signature invalid.")
    expected_digest = _canonical_approval_hash(user_id, cafe_id, payload)
    if not hmac.compare_digest(digest, expected_digest):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Order cart or table changed after approval preview. Please re-confirm the updated summary.",
        )
