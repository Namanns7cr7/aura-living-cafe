"""Live production verification script for AURA deployed on Firebase Hosting + Cloud Run + Firestore."""
from __future__ import annotations

import json
import os
import sys
import time
import uuid

import httpx


def main() -> None:
    web_url = os.environ["LIVE_WEB_URL"].rstrip("/")
    api_url = os.environ["LIVE_API_URL"].rstrip("/")
    passcode = os.environ["DEMO_STAFF_PASSCODE"]

    results: dict[str, object] = {
        "web_url": web_url,
        "api_url": api_url,
        "checks": {},
    }

    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        # 1. Static Frontend Routes (/, /app/, /staff/)
        for route in ["/", "/app/", "/staff/"]:
            t0 = time.perf_counter()
            r = client.get(f"{web_url}{route}")
            ms = round((time.perf_counter() - t0) * 1000, 1)
            assert r.status_code == 200, f"Route {route} returned {r.status_code}"
            assert "AURA" in r.text, f"Route {route} missing AURA title"
            results["checks"][f"GET {route}"] = {"status": r.status_code, "latency_ms": ms}

        # 2. Backend /health + CORS check
        t0 = time.perf_counter()
        h = client.get(f"{api_url}/health", headers={"Origin": web_url})
        ms = round((time.perf_counter() - t0) * 1000, 1)
        assert h.status_code == 200, f"/health returned {h.status_code}"
        hdata = h.json()
        assert hdata["storeMode"] == "firestore", f"Expected firestore storeMode, got {hdata}"
        assert hdata["geminiConfigured"] is False, "Expected ENABLE_LIVE_GEMINI=false"
        cors_hdr = h.headers.get("access-control-allow-origin")
        assert cors_hdr == web_url, f"Expected CORS origin {web_url}, got {cors_hdr}"
        results["checks"]["GET /health + CORS"] = {"status": 200, "latency_ms": ms, "storeMode": hdata["storeMode"], "cors": cors_hdr}

        # 3. Demo Login (Customer public, Manager without passcode -> 403, Manager with passcode -> 200)
        c_login = client.post(f"{api_url}/api/v1/public/demo-login", json={"persona": "customer-1"})
        assert c_login.status_code == 200, f"Customer login failed: {c_login.text}"
        c_token = c_login.json()["token"]
        c_hdr = {"Authorization": f"Bearer {c_token}"}

        m_denied = client.post(f"{api_url}/api/v1/public/demo-login", json={"persona": "manager-1"})
        assert m_denied.status_code == 403, f"Expected 403 for manager without passcode, got {m_denied.status_code}"

        m_login = client.post(
            f"{api_url}/api/v1/public/demo-login",
            json={"persona": "manager-1", "staffPasscode": passcode},
        )
        assert m_login.status_code == 200, f"Manager login failed: {m_login.text}"
        m_token = m_login.json()["token"]
        m_hdr = {"Authorization": f"Bearer {m_token}"}
        results["checks"]["demo_login"] = {"customer": 200, "manager_no_passcode": 403, "manager_with_passcode": 200}

        # 4. Allergy safety check on live API
        alg = client.post(
            f"{api_url}/api/v1/agent/plan",
            headers=c_hdr,
            json={"message": "I'm allergic to almonds, what cold coffee do you recommend?"},
        )
        assert alg.status_code == 200
        alg_recs = alg.json()["recommendations"]
        assert all("tree_nuts" not in r["allergens"] and r["menuItemId"] != "iced-almond-americano" for r in alg_recs)
        results["checks"]["allergy_almond_safe"] = {"status": 200, "topPick": alg_recs[0]["name"]}

        # 5. Plan -> Confirm -> Staff Sees -> Preparing -> Ready -> Second Ready 409 -> Customer Sees Ready
        plan_res = client.post(
            f"{api_url}/api/v1/agent/plan",
            headers=c_hdr,
            json={"message": "I want something cold, not too sweet, dairy-free under ₹250, and I have 15 minutes."},
        )
        assert plan_res.status_code == 200, plan_res.text
        plan = plan_res.json()
        assert plan["approvalPreview"] and plan["approvalPreview"]["approvalToken"]
        top_drink = plan["recommendations"][0]["name"]

        idem = f"live-verify-{uuid.uuid4().hex[:10]}"
        conf_res = client.post(
            f"{api_url}/api/v1/customer/orders/confirm",
            headers=c_hdr,
            json={
                "items": plan["proposedCart"],
                "tableId": plan["approvalPreview"].get("tableId"),
                "idempotencyKey": idem,
                "approvalToken": plan["approvalPreview"]["approvalToken"],
            },
        )
        assert conf_res.status_code == 200, conf_res.text
        order_id = conf_res.json()["order"]["id"]

        # Staff sees order
        staff_orders = client.get(f"{api_url}/api/v1/staff/orders", headers=m_hdr)
        assert staff_orders.status_code == 200
        assert any(o["id"] == order_id for o in staff_orders.json()["orders"]), "Order missing on staff view!"

        # Preparing (stock stays reserved, consumedAt is None)
        prep = client.patch(
            f"{api_url}/api/v1/staff/orders/{order_id}/status",
            headers=m_hdr,
            json={"status": "preparing", "reason": "Live verify preparing"},
        )
        assert prep.status_code == 200 and prep.json()["order"]["consumedAt"] is None

        # Ready (consumes stock ONCE, consumedAt set)
        ready1 = client.patch(
            f"{api_url}/api/v1/staff/orders/{order_id}/status",
            headers=m_hdr,
            json={"status": "ready", "reason": "Live verify ready"},
        )
        assert ready1.status_code == 200 and ready1.json()["order"]["consumedAt"] is not None

        # Second Ready MUST be blocked with 409!
        ready2 = client.patch(
            f"{api_url}/api/v1/staff/orders/{order_id}/status",
            headers=m_hdr,
            json={"status": "ready", "reason": "Duplicate ready must fail"},
        )
        assert ready2.status_code == 409, f"Expected 409 on duplicate ready, got {ready2.status_code}"

        # Customer sees Ready
        cust_ord = client.get(f"{api_url}/api/v1/customer/orders/{order_id}", headers=c_hdr)
        assert cust_ord.status_code == 200 and cust_ord.json()["order"]["status"] == "ready"

        results["checks"]["order_e2e_lifecycle"] = {
            "orderId": order_id,
            "recommendedDrink": top_drink,
            "confirmed": True,
            "staffSawOrder": True,
            "preparingConsumedAt": None,
            "readyConsumedOnce": True,
            "secondReadyStatus": ready2.status_code,
            "customerSawReady": True,
        }

        # Clean reset so demo-cafe starts fresh for judges
        rst = client.post(f"{api_url}/api/v1/demo/reset", headers=m_hdr)
        assert rst.status_code == 200
        results["checks"]["demo_reset_clean"] = rst.json()["counts"]

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
