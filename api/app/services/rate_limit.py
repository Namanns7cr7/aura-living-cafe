from __future__ import annotations

import threading
import time
from collections import deque
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.config import Settings


class AIRateLimiter:
    """
    Server-side per-user/IP RPM, per-identity daily cap, and global daily demo budget guardrail.
    Prevents any single user or guest IP from exhausting the shared daily Gemini allowance.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._user_windows: dict[str, deque[float]] = {}
        self._user_daily: dict[str, int] = {}
        self._daily_date: str = self._today()
        self._daily_count: int = 0

    @staticmethod
    def _today() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def check_and_consume(self, user_key: str, settings: Settings, is_guest: bool = False) -> dict[str, int]:
        now = time.time()
        with self._lock:
            today = self._today()
            if today != self._daily_date:
                self._daily_date = today
                self._daily_count = 0
                self._user_daily.clear()

            if self._daily_count >= settings.daily_ai_budget_requests:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Daily AI demo budget reached. Deterministic menu, inventory, and ordering remain fully available.",
                )

            per_identity_cap = (
                settings.per_guest_ip_daily_limit if is_guest else settings.per_user_daily_ai_limit
            )
            used_today = self._user_daily.get(user_key, 0)
            if used_today >= per_identity_cap:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=(
                        "Guest AI request limit reached for this IP. Sign in for higher allowance or browse the live menu directly."
                        if is_guest
                        else "Your personal daily AI allowance has been reached. Menu, seating, and ordering remain fully available."
                    ),
                )

            win = self._user_windows.setdefault(user_key, deque())
            while win and (now - win[0]) > 60.0:
                win.popleft()

            if len(win) >= settings.per_user_ai_rpm:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Rate limit reached for AI concierge. Please wait a moment and try again.",
                )

            win.append(now)
            self._user_daily[user_key] = used_today + 1
            self._daily_count += 1
            return {
                "dailyUsed": self._daily_count,
                "dailyBudget": settings.daily_ai_budget_requests,
                "identityDailyUsed": self._user_daily[user_key],
                "identityDailyLimit": per_identity_cap,
                "userMinuteUsed": len(win),
                "userMinuteLimit": settings.per_user_ai_rpm,
            }

    def stats(self, settings: Settings) -> dict[str, int]:
        with self._lock:
            today = self._today()
            if today != self._daily_date:
                self._daily_date = today
                self._daily_count = 0
                self._user_daily.clear()
            return {
                "dailyUsed": self._daily_count,
                "dailyBudget": settings.daily_ai_budget_requests,
            }

    def reset(self) -> None:
        with self._lock:
            self._user_windows.clear()
            self._user_daily.clear()
            self._daily_count = 0


ai_rate_limiter = AIRateLimiter()
