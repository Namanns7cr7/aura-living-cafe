from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import uuid


def _preview_and_confirm(client, headers, items, idem_key, table_id=None):
    prev = client.post(
        "/api/v1/customer/orders/preview",
        headers=headers,
        json={"items": items, "tableId": table_id},
    )
    if prev.status_code != 200:
        return prev
    token = prev.json()["approvalToken"]
    return client.post(
        "/api/v1/customer/orders/confirm",
        headers=headers,
        json={
            "items": items,
            "tableId": table_id,
            "idempotencyKey": idem_key,
            "approvalToken": token,
        },
    )


def test_seed_is_idempotent(mem_store):
    c1 = mem_store.seed_cafe("demo-cafe", reset=False)
    c2 = mem_store.seed_cafe("demo-cafe", reset=False)
    assert c1 == c2
    assert c1["menuItems"] >= 20
    assert c1["ingredients"] >= 25
    assert c1["tables"] == 12
    assert c1["orders"] == 12
    assert c1["sessions"] == 4


def test_menu_filtering_and_recipe_modifiers(client, auth_headers):
    res = client.get("/api/v1/public/menu?category=cold_coffee&dietary=dairy-free&excludeAllergen=tree_nuts")
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) >= 3
    for item in items:
        assert item["category"] == "cold_coffee"
        assert "dairy-free" in item["dietaryTags"]
        assert "tree_nuts" not in item["allergens"]
        assert item["pricePaise"] == int(round(item["priceRupees"] * 100))

    # Modifier adds price delta & swaps milk recipe cleanly
    headers = auth_headers("customer-1")
    prev = client.post(
        "/api/v1/customer/orders/preview",
        headers=headers,
        json={"items": [{"menuItemId": "classic-cappuccino", "qty": 1, "selectedModifierIds": ["mod_oat_milk", "mod_extra_shot"]}]},
    )
    assert prev.status_code == 200
    data = prev.json()
    # Base 19000 + oat 3000 + extra shot 4500 = 26500 paise
    assert data["totalPaise"] == 26500
    impact_ids = {i["ingredientId"]: i["required"] for i in data["ingredientImpact"]}
    assert "whole_milk_ml" not in impact_ids
    assert impact_ids["oat_milk_ml"] == 180
    assert impact_ids["espresso_beans_g"] == 27  # 18 + 9


def test_order_lifecycle_consumes_strictly_once_on_ready(client, auth_headers, mem_store):
    cust_h = auth_headers("customer-1")
    barista_h = auth_headers("barista-1")

    oat_before = mem_store.get_ingredient("demo-cafe", "oat_milk_ml")
    assert oat_before is not None
    start_on_hand = oat_before["onHand"]
    start_reserved = oat_before["reserved"]

    # 1. Confirm order -> reserves 180ml oat milk (onHand unchanged!)
    conf = _preview_and_confirm(
        client,
        cust_h,
        [{"menuItemId": "iced-oat-latte", "qty": 1}],
        idem_key=f"idem-{uuid.uuid4().hex}",
        table_id="Q2",
    )
    assert conf.status_code == 200
    order = conf.json()["order"]
    order_id = order["id"]
    assert order["status"] == "confirmed"
    assert order["consumedAt"] is None

    oat_after_confirm = mem_store.get_ingredient("demo-cafe", "oat_milk_ml")
    assert oat_after_confirm["onHand"] == start_on_hand
    assert oat_after_confirm["reserved"] == start_reserved + 180

    # 2. Transition to 'preparing' -> stock stays RESERVED (consume on 'ready' ONLY!)
    prep = client.patch(
        f"/api/v1/staff/orders/{order_id}/status",
        headers=barista_h,
        json={"status": "preparing", "reason": "Barista started pulling shot"},
    )
    assert prep.status_code == 200
    assert prep.json()["order"]["consumedAt"] is None
    oat_after_prep = mem_store.get_ingredient("demo-cafe", "oat_milk_ml")
    assert oat_after_prep["onHand"] == start_on_hand
    assert oat_after_prep["reserved"] == start_reserved + 180

    # 3. Transition to 'ready' -> CONSUMES once! (onHand -= 180, reserved -= 180, consumedAt set)
    ready = client.patch(
        f"/api/v1/staff/orders/{order_id}/status",
        headers=barista_h,
        json={"status": "ready", "reason": "Ready at counter"},
    )
    assert ready.status_code == 200
    assert ready.json()["order"]["consumedAt"] is not None
    oat_after_ready = mem_store.get_ingredient("demo-cafe", "oat_milk_ml")
    assert oat_after_ready["onHand"] == start_on_hand - 180
    assert oat_after_ready["reserved"] == start_reserved

    # 4. Duplicate 'ready' transition MUST fail with 409 and NOT deduct twice!
    ready_again = client.patch(
        f"/api/v1/staff/orders/{order_id}/status",
        headers=barista_h,
        json={"status": "ready", "reason": "Accidental double click"},
    )
    assert ready_again.status_code == 409
    oat_after_dup = mem_store.get_ingredient("demo-cafe", "oat_milk_ml")
    assert oat_after_dup["onHand"] == start_on_hand - 180
    assert oat_after_dup["reserved"] == start_reserved

    # 5. Collect -> no extra deduction
    col = client.patch(
        f"/api/v1/staff/orders/{order_id}/status",
        headers=barista_h,
        json={"status": "collected", "reason": "Picked up by guest"},
    )
    assert col.status_code == 200
    oat_after_col = mem_store.get_ingredient("demo-cafe", "oat_milk_ml")
    assert oat_after_col["onHand"] == start_on_hand - 180
    assert oat_after_col["reserved"] == start_reserved

    # Verify exactly 1 consume audit event for this order's oat_milk_ml
    consume_events = [
        e
        for e in mem_store.list_inventory_events("demo-cafe", limit=100)
        if e["orderId"] == order_id and e["ingredientId"] == "oat_milk_ml" and e["eventType"] == "consume"
    ]
    assert len(consume_events) == 1


def test_duplicate_idempotency_key_does_not_double_reserve(client, auth_headers, mem_store):
    cust_h = auth_headers("customer-1")
    oat_start = mem_store.get_ingredient("demo-cafe", "oat_milk_ml")["reserved"]
    idem = f"idem-replay-{uuid.uuid4().hex}"
    items = [{"menuItemId": "iced-oat-latte", "qty": 1}]

    prev = client.post("/api/v1/customer/orders/preview", headers=cust_h, json={"items": items})
    token = prev.json()["approvalToken"]

    r1 = client.post(
        "/api/v1/customer/orders/confirm",
        headers=cust_h,
        json={"items": items, "idempotencyKey": idem, "approvalToken": token},
    )
    r2 = client.post(
        "/api/v1/customer/orders/confirm",
        headers=cust_h,
        json={"items": items, "idempotencyKey": idem, "approvalToken": token},
    )
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["order"]["id"] == r2.json()["order"]["id"]
    assert r1.json()["idempotentReplay"] is False
    assert r2.json()["idempotentReplay"] is True
    assert mem_store.get_ingredient("demo-cafe", "oat_milk_ml")["reserved"] == oat_start + 180


def test_cancel_before_consume_releases_stock_and_seat(client, auth_headers, mem_store):
    cust_h = auth_headers("customer-1")
    oat_start_res = mem_store.get_ingredient("demo-cafe", "oat_milk_ml")["reserved"]

    conf = _preview_and_confirm(
        client,
        cust_h,
        [{"menuItemId": "iced-oat-latte", "qty": 1}],
        idem_key=f"idem-cancel-{uuid.uuid4().hex}",
        table_id="Q1",
    )
    assert conf.status_code == 200
    order_id = conf.json()["order"]["id"]
    assert mem_store.get_ingredient("demo-cafe", "oat_milk_ml")["reserved"] == oat_start_res + 180

    canc = client.post(f"/api/v1/customer/orders/{order_id}/cancel", headers=cust_h)
    assert canc.status_code == 200
    assert canc.json()["order"]["status"] == "cancelled"
    assert mem_store.get_ingredient("demo-cafe", "oat_milk_ml")["reserved"] == oat_start_res

    tables = {t["id"]: t for t in mem_store.list_tables("demo-cafe")}
    assert tables["Q1"]["status"] == "free"


def test_concurrent_race_on_last_oat_milk_serving(client, auth_headers, mem_store):
    # Reduce oat milk to EXACTLY 1 serving (180ml)
    mgr_h = auth_headers("manager-1")
    oat = mem_store.get_ingredient("demo-cafe", "oat_milk_ml")
    delta = 180 - oat["onHand"]
    adj = client.post(
        "/api/v1/staff/inventory/adjust",
        headers=mgr_h,
        json={"ingredientId": "oat_milk_ml", "deltaOnHand": delta, "reason": "Test exact 1 serving left"},
    )
    assert adj.status_code == 200

    # Pre-mint approval tokens for two customers racing for the final oat latte
    items = [{"menuItemId": "iced-oat-latte", "qty": 1}]
    tokens = []
    for i in range(5):
        h = auth_headers("customer-1" if i % 2 == 0 else "customer-2")
        p = client.post("/api/v1/customer/orders/preview", headers=h, json={"items": items})
        assert p.status_code == 200
        tokens.append((h, p.json()["approvalToken"], f"race-{i}-{uuid.uuid4().hex}"))

    def attempt(entry):
        h, tok, idem = entry
        return client.post(
            "/api/v1/customer/orders/confirm",
            headers=h,
            json={"items": items, "idempotencyKey": idem, "approvalToken": tok},
        )

    with ThreadPoolExecutor(max_workers=5) as ex:
        responses = list(ex.map(attempt, tokens))

    successes = [r for r in responses if r.status_code == 200]
    conflicts = [r for r in responses if r.status_code == 409]
    assert len(successes) == 1
    assert len(conflicts) == 4
    # Conflicts must include real in-stock substitutes!
    assert len(conflicts[0].json()["detail"]["substitutes"]) >= 1

    # Stock invariant: onHand >= reserved >= 0 and available == 0
    oat_final = mem_store.get_ingredient("demo-cafe", "oat_milk_ml")
    assert oat_final["onHand"] == 180
    assert oat_final["reserved"] == 180


def test_restock_negative_and_version_conflict(client, auth_headers, mem_store):
    mgr_h = auth_headers("manager-1")
    oat = mem_store.get_ingredient("demo-cafe", "oat_milk_ml")

    # Negative stock rejected
    neg = client.post(
        "/api/v1/staff/inventory/adjust",
        headers=mgr_h,
        json={"ingredientId": "oat_milk_ml", "deltaOnHand": -(oat["onHand"] + 50), "reason": "Invalid negative"},
    )
    assert neg.status_code == 400

    # Stale version rejected with 409
    stale = client.post(
        "/api/v1/staff/inventory/adjust",
        headers=mgr_h,
        json={"ingredientId": "oat_milk_ml", "deltaOnHand": 500, "reason": "Restock", "expectedVersion": 999},
    )
    assert stale.status_code == 409

    # Valid restock succeeds
    ok = client.post(
        "/api/v1/staff/inventory/adjust",
        headers=mgr_h,
        json={"ingredientId": "oat_milk_ml", "deltaOnHand": 1000, "reason": "Morning delivery", "expectedVersion": oat["version"]},
    )
    assert ok.status_code == 200
    assert ok.json()["ingredient"]["onHand"] == oat["onHand"] + 1000


def test_demo_low_stock_clamped_and_reset_and_rush_eta(client, auth_headers, mem_store):
    cust_h = auth_headers("customer-1")
    mgr_h = auth_headers("manager-1")

    # Reserve 2 oat lattes (360ml reserved)
    conf = _preview_and_confirm(
        client,
        cust_h,
        [{"menuItemId": "iced-oat-latte", "qty": 2}],
        idem_key=f"idem-clamp-{uuid.uuid4().hex}",
    )
    assert conf.status_code == 200

    # Trigger low_stock scenario -> MUST clamp onHand >= reserved!
    ls = client.post("/api/v1/demo/scenario", headers=mgr_h, json={"scenario": "low_stock"})
    assert ls.status_code == 200
    oat = mem_store.get_ingredient("demo-cafe", "oat_milk_ml")
    assert oat["reserved"] == 360
    assert oat["onHand"] >= oat["reserved"]

    # Rush hour increases deterministic ETA
    calm_eta = client.get("/api/v1/public/overview").json()["etaEstimate"]["minMinutes"]
    rush = client.post("/api/v1/demo/scenario", headers=mgr_h, json={"scenario": "rush"})
    assert rush.status_code == 200
    rush_eta = client.get("/api/v1/public/overview").json()["etaEstimate"]["minMinutes"]
    assert rush_eta > calm_eta

    # /demo/reset restores clean seed baseline
    rst = client.post("/api/v1/demo/reset", headers=mgr_h)
    assert rst.status_code == 200
    assert mem_store.get_ingredient("demo-cafe", "oat_milk_ml")["reserved"] == 0
    assert mem_store.get_demo_state("demo-cafe")["scenario"] == "calm"
