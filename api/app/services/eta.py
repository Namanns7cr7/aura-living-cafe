from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any


def estimate_pickup_eta(
    order_work_units: int,
    active_orders: list[dict[str, Any]],
    menu_by_id: dict[str, dict[str, Any]],
    demo_state: dict[str, Any],
) -> dict[str, Any]:
    """
    Deterministic work-unit queue ETA estimator (never hallucinated).
    Formula:
      eta_base = baseHandoff + ceil((queuedWorkUnits + currentOrderWorkUnits) / max(1, activeBaristas * workUnitsPerMinute))
    """
    base_handoff = 2
    active_baristas = max(1, int(demo_state.get("activeBaristas", 2)))
    units_per_min = max(0.5, float(demo_state.get("workUnitsPerMinute", 2.0)))
    simulated_queue = max(0, int(demo_state.get("simulatedQueueWorkUnits", 0)))

    queued_work_units = simulated_queue
    queued_order_count = 0
    for order in active_orders:
        if order.get("status") in ("confirmed", "preparing"):
            queued_order_count += 1
            for it in order.get("items", []):
                m = menu_by_id.get(it["menuItemId"])
                wu = int(m.get("prepWorkUnits", 3)) if m else 3
                queued_work_units += wu * int(it.get("qty", 1))

    capacity_per_min = max(1.0, active_baristas * units_per_min)
    total_work = max(1, queued_work_units + max(1, order_work_units))
    raw_minutes = base_handoff + math.ceil(total_work / capacity_per_min)

    # Volatility band widens under rush load
    volatility = 2 if queued_work_units < 12 else (3 if queued_work_units < 25 else 5)
    min_minutes = max(3, raw_minutes)
    max_minutes = min_minutes + volatility

    estimated_ready_at = (datetime.now(timezone.utc) + timedelta(minutes=max_minutes)).isoformat()
    is_simulated_load = simulated_queue > 0 or demo_state.get("scenario") != "calm"

    return {
        "minMinutes": min_minutes,
        "maxMinutes": max_minutes,
        "estimatedReadyAt": estimated_ready_at,
        "queuedOrders": queued_order_count,
        "queuedWorkUnits": queued_work_units,
        "currentOrderWorkUnits": order_work_units,
        "activeBaristas": active_baristas,
        "source": "queue_estimator",
        "scenario": demo_state.get("scenario", "calm"),
        "isSimulatedLoad": is_simulated_load,
        "disclaimer": "Estimate based on active barista queue (not a guarantee).",
    }
