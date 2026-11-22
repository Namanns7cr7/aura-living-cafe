"""Real Google Cloud Firestore Emulator concurrency, idempotency, and security-split tests."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import os
import uuid

import pytest

from app.store.base import DomainConflictError
from app.store.firestore_store import FirestoreCafeStore

pytestmark = pytest.mark.skipif(
    not os.environ.get("FIRESTORE_EMULATOR_HOST"),
    reason="Requires FIRESTORE_EMULATOR_HOST (run via firebase emulators:exec)",
)


@pytest.fixture
def fs_store() -> FirestoreCafeStore:
    store = FirestoreCafeStore(project_id="aura-emulator-test")
    store.seed_cafe("demo-cafe", reset=True)
    return store


def test_firestore_emulator_idempotent_seed(fs_store: FirestoreCafeStore):
    c1 = fs_store.seed_cafe("demo-cafe", reset=False)
    c2 = fs_store.seed_cafe("demo-cafe", reset=False)
    assert c1 == c2
    assert c1["menuItems"] == 22
    assert c1["ingredients"] == 26
    assert c1["tables"] == 12


def test_firestore_emulator_concurrent_last_stock_race(fs_store: FirestoreCafeStore):
    # Set oat milk to exactly 1 serving (180ml)
    oat = fs_store.get_ingredient("demo-cafe", "oat_milk_ml")
    assert oat is not None
    fs_store.adjust_ingredient_tx("demo-cafe", "oat_milk_ml", 180 - oat["onHand"], "mgr-test", "Set 1 serving")

    def worker(idx: int):
        try:
            order, replay = fs_store.confirm_order_tx(
                cafe_id="demo-cafe",
                user_id=f"user-{idx}",
                customer_name=f"Guest {idx}",
                cart_items=[{"menuItemId": "iced-oat-latte", "qty": 1, "selectedModifierIds": []}],
                idempotency_key=f"fs-race-{idx}-{uuid.uuid4().hex}",
            )
            return ("ok", order["id"], replay)
        except DomainConflictError as exc:
            return ("conflict", exc.code, False)

    with ThreadPoolExecutor(max_workers=5) as ex:
        results = list(ex.map(worker, range(5)))

    wins = [r for r in results if r[0] == "ok"]
    conflicts = [r for r in results if r[0] == "conflict"]
    assert len(wins) == 1
    assert len(conflicts) == 4

    oat_after = fs_store.get_ingredient("demo-cafe", "oat_milk_ml")
    assert oat_after["onHand"] == 180
    assert oat_after["reserved"] == 180


def test_firestore_emulator_idempotency_and_consume_on_ready_only(fs_store: FirestoreCafeStore):
    oat_before = fs_store.get_ingredient("demo-cafe", "oat_milk_ml")
    idem = f"fs-idem-{uuid.uuid4().hex}"
    cart = [{"menuItemId": "iced-oat-latte", "qty": 1, "selectedModifierIds": []}]

    o1, rep1 = fs_store.confirm_order_tx("demo-cafe", "user-a", "Ananya", cart, idem)
    o2, rep2 = fs_store.confirm_order_tx("demo-cafe", "user-a", "Ananya", cart, idem)
    assert o1["id"] == o2["id"]
    assert rep1 is False and rep2 is True

    oat_res = fs_store.get_ingredient("demo-cafe", "oat_milk_ml")
    assert oat_res["reserved"] == oat_before["reserved"] + 180
    assert oat_res["onHand"] == oat_before["onHand"]

    # Preparing does NOT consume
    prep = fs_store.transition_order_tx("demo-cafe", o1["id"], "preparing", "barista-1", "barista", "Start")
    assert prep["consumedAt"] is None
    assert fs_store.get_ingredient("demo-cafe", "oat_milk_ml")["onHand"] == oat_before["onHand"]

    # Ready consumes ONCE
    ready = fs_store.transition_order_tx("demo-cafe", o1["id"], "ready", "barista-1", "barista", "Done")
    assert ready["consumedAt"] is not None
    oat_done = fs_store.get_ingredient("demo-cafe", "oat_milk_ml")
    assert oat_done["onHand"] == oat_before["onHand"] - 180
    assert oat_done["reserved"] == oat_before["reserved"]

    # Second Ready rejected -> no double deduction
    with pytest.raises(DomainConflictError):
        fs_store.transition_order_tx("demo-cafe", o1["id"], "ready", "barista-1", "barista", "Duplicate")
    assert fs_store.get_ingredient("demo-cafe", "oat_milk_ml")["onHand"] == oat_before["onHand"] - 180


def test_firestore_emulator_concurrent_table_race(fs_store: FirestoreCafeStore):
    def try_book(idx: int):
        try:
            tbl, res = fs_store.reserve_table_tx("demo-cafe", "Q1", f"guest-{idx}", 45)
            return ("ok", res["id"])
        except DomainConflictError as exc:
            return ("conflict", exc.code)

    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(try_book, range(4)))

    assert sum(1 for r in results if r[0] == "ok") == 1
    assert sum(1 for r in results if r[0] == "conflict") == 3


def test_firestore_emulator_session_private_subcollection_split(fs_store: FirestoreCafeStore):
    # Verify raw Firestore public session doc NEVER leaks member lists or private meeting notes
    pub_snap = fs_store._col("demo-cafe", "sessions").document("sess-ai-builders").get()
    assert pub_snap.exists
    pub_data = pub_snap.to_dict()
    assert "approvedMemberIds" not in pub_data
    assert "pendingRequests" not in pub_data
    assert "meetingNoteForApproved" not in pub_data
    assert pub_data["memberCount"] == 1

    priv_snap = pub_snap.reference.collection("private").document("members").get()
    assert priv_snap.exists
    priv_data = priv_snap.to_dict()
    assert "demo-customer-rohan" in priv_data["approvedMemberIds"]
    assert "brass lamp" in priv_data["meetingNoteForApproved"]


def test_firestore_emulator_low_stock_clamped_above_reserved(fs_store: FirestoreCafeStore):
    cart = [{"menuItemId": "iced-oat-latte", "qty": 2, "selectedModifierIds": []}]
    fs_store.confirm_order_tx("demo-cafe", "user-clamp", "Guest", cart, f"idem-clamp-{uuid.uuid4().hex}")
    fs_store.set_demo_scenario("demo-cafe", "low_stock", "mgr-1")
    oat = fs_store.get_ingredient("demo-cafe", "oat_milk_ml")
    assert oat["reserved"] == 360
    assert oat["onHand"] >= oat["reserved"]
