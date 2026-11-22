from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class DomainConflictError(Exception):
    def __init__(self, message: str, code: str = "conflict", details: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}


class DomainValidationError(Exception):
    def __init__(self, message: str, code: str = "validation_error", details: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}


class DomainNotFoundError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class CafeStore(ABC):
    @abstractmethod
    def seed_cafe(self, cafe_id: str, reset: bool = False) -> dict[str, int]:
        ...

    @abstractmethod
    def list_menu_items(self, cafe_id: str) -> list[dict[str, Any]]:
        ...

    @abstractmethod
    def get_menu_item(self, cafe_id: str, item_id: str) -> dict[str, Any] | None:
        ...

    @abstractmethod
    def set_menu_item_active(self, cafe_id: str, item_id: str, active: bool) -> dict[str, Any]:
        ...

    @abstractmethod
    def list_ingredients(self, cafe_id: str) -> list[dict[str, Any]]:
        ...

    @abstractmethod
    def get_ingredient(self, cafe_id: str, ingredient_id: str) -> dict[str, Any] | None:
        ...

    @abstractmethod
    def adjust_ingredient_tx(
        self,
        cafe_id: str,
        ingredient_id: str,
        delta_on_hand: int,
        actor_id: str,
        reason: str,
        expected_version: int | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        ...

    @abstractmethod
    def confirm_order_tx(
        self,
        cafe_id: str,
        user_id: str,
        customer_name: str,
        cart_items: list[dict[str, Any]],
        idempotency_key: str,
        table_id: str | None = None,
        notes: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        """Returns (order_dict, was_idempotent_replay)."""
        ...

    @abstractmethod
    def transition_order_tx(
        self,
        cafe_id: str,
        order_id: str,
        target_status: str,
        actor_id: str,
        actor_role: str,
        reason: str,
    ) -> dict[str, Any]:
        ...

    @abstractmethod
    def get_order(self, cafe_id: str, order_id: str) -> dict[str, Any] | None:
        ...

    @abstractmethod
    def list_orders(self, cafe_id: str, user_id: str | None = None) -> list[dict[str, Any]]:
        ...

    @abstractmethod
    def list_order_events(self, cafe_id: str, order_id: str | None = None) -> list[dict[str, Any]]:
        ...

    @abstractmethod
    def list_inventory_events(self, cafe_id: str, limit: int = 50) -> list[dict[str, Any]]:
        ...

    @abstractmethod
    def list_tables(self, cafe_id: str) -> list[dict[str, Any]]:
        ...

    @abstractmethod
    def reserve_table_tx(
        self,
        cafe_id: str,
        table_id: str,
        user_id: str,
        duration_minutes: int = 45,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        ...

    @abstractmethod
    def release_table_tx(self, cafe_id: str, table_id: str, user_id: str, is_staff: bool = False) -> dict[str, Any]:
        ...

    @abstractmethod
    def list_sessions(self, cafe_id: str) -> list[dict[str, Any]]:
        ...

    @abstractmethod
    def create_session(self, cafe_id: str, session_data: dict[str, Any]) -> dict[str, Any]:
        ...

    @abstractmethod
    def request_join_session(
        self, cafe_id: str, session_id: str, user_id: str, display_name: str, note: str
    ) -> dict[str, Any]:
        ...

    @abstractmethod
    def decide_join_session(
        self, cafe_id: str, session_id: str, host_id: str, target_user_id: str, approve: bool
    ) -> dict[str, Any]:
        ...

    @abstractmethod
    def leave_session(self, cafe_id: str, session_id: str, user_id: str) -> dict[str, Any]:
        ...

    @abstractmethod
    def get_preferences(self, cafe_id: str, user_id: str) -> dict[str, Any]:
        ...

    @abstractmethod
    def update_preferences(self, cafe_id: str, user_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        ...

    @abstractmethod
    def list_recommendations(self, cafe_id: str) -> list[dict[str, Any]]:
        ...

    @abstractmethod
    def save_recommendation(self, cafe_id: str, rec: dict[str, Any]) -> dict[str, Any]:
        ...

    @abstractmethod
    def decide_recommendation(
        self, cafe_id: str, rec_id: str, decision: str, actor_id: str, note: str
    ) -> dict[str, Any]:
        ...

    @abstractmethod
    def get_demo_state(self, cafe_id: str) -> dict[str, Any]:
        ...

    @abstractmethod
    def set_demo_scenario(self, cafe_id: str, scenario: str, actor_id: str) -> dict[str, Any]:
        ...
