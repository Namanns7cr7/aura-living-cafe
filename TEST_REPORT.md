# AURA — Verification & Test Report (`TEST_REPORT.md`)

**Date:** 2026-11-22  
**Environment:** Local Python `3.13.3` + Firebase Firestore Emulator (`v1.19.8`) + Live Production (`https://aura-living-cafe-492817.web.app` & `https://aura-api-214091459755.asia-south1.run.app`)

---

## 1. Backend Unit, Security & RBAC Suite (`pytest`)
- **Command:** `api\.venv\Scripts\python.exe -m pytest api\tests -v`
- **Result:** **20 passed, 0 failed** (7 emulator-only tests skipped when `FIRESTORE_EMULATOR_HOST` is unset; executed separately below).
- **Verified Invariants:**
  - Idempotent deterministic seed (22 drinks, 26 ingredients, 12 tables, 12 historical orders, 4 community sessions).
  - Menu filtering, paise/rupee pricing parity, recipe modifier deltas (`mod_oat_milk`, `mod_extra_shot`).
  - Order lifecycle: confirm reserves stock → `preparing` keeps reserved (`consumedAt == None`) → `ready` consumes `onHand` & `reserved` **strictly once** → duplicate `ready` returns **409 Conflict** with zero double-deduction → `collected` causes zero extra deduction.
  - Concurrent race on final oat-milk serving (5 simultaneous threads): **1 success, 4 conflicts (409)** with real in-stock substitutes, zero negative stock.
  - Duplicate idempotency key replay returns existing order with `idempotentReplay: true` and zero double reservation.
  - Cancel-before-consume releases reserved stock and paired seat reservation.
  - Optimistic locking version conflict (409), negative stock rejection (400), and `low_stock` scenario clamping (`onHand >= reserved`).
  - Security: `ALLOW_DEMO_AUTH=false` default, non-local placeholder secret startup refusal, `/demo-login` customer-only public access vs `DEMO_STAFF_PASSCODE`-gated barista/manager login, 401/403 RBAC isolation, cross-user order isolation, cross-café ID swap rejection, tampered approval token rejection, no order-mutation tool on AI agent, per-user & per-IP daily AI rate caps.

---

## 2. Real Google Cloud Firestore Emulator Concurrency Suite
- **Command:** `npx -y firebase-tools@13.35.1 emulators:exec --only firestore --project aura-emulator-test "api\.venv\Scripts\python.exe -m pytest api\tests\test_firestore_emulator.py -v"`
- **Result:** **7 passed, 0 failed** (`8.41s`).
- **Verified Against Real `@firestore.transactional` Semantics:**
  1. `test_firestore_emulator_idempotent_seed`
  2. `test_firestore_emulator_concurrent_last_stock_race` (5 concurrent threads racing for final 180ml oat milk → strictly 1 wins)
  3. `test_firestore_emulator_idempotency_and_consume_on_ready_only`
  4. `test_firestore_emulator_concurrent_table_race` (4 concurrent threads racing for table `Q1` → strictly 1 wins)
  5. `test_firestore_emulator_session_private_subcollection_split` (public `sessions/{id}` contains zero member UIDs or private notes; private data isolated in `sessions/{id}/private/members`)
  6. `test_firestore_emulator_low_stock_clamped_above_reserved`
  7. `test_firestore_emulator_readonly_list_tables_and_transactional_release` (`list_tables` performs zero writes; `release_table_tx` atomically marks reservation `cancelled`; lazy expiry transitions old reservation to `expired` on next transaction)

---

## 3. AI Evaluation Harness (`api/evals/eval_scenarios.py`)
| Metric | Measured Value |
|---|---|
| Eval Harness Version | `1.0.0` |
| Source Mode / Model | `deterministic` (`ENABLE_LIVE_GEMINI=false` per zero-AI-cost deploy directive) |
| Total Cases Executed | **32** |
| Passed / Failed | **32 / 0** (**100.0%**) |
| Schema Valid | **32 / 32** |
| Grounded Price & Stock Accuracy | **32 / 32** (100%) |
| Tool Accuracy | **32 / 32** (100%) |
| Authorization & Approval Safety | **32 / 32** (100%) |
| Median / p95 Latency | **4.39 ms / 6.89 ms** |

Includes critical regressions: `"I'm allergic to almonds"` (never returns `Iced Almond Cloud Latte`), `"cashew allergy"` (`tree_nuts`), `"no milk"` (`dairy`), `"no more than 200 rupees within 15 minutes"` (budget vs time separation), prompt injections, price overrides, confidential inventory dump attempts, cross-user order snooping, and ungrounded summary validator unit tests.

---

## 4. Live Production API & Playwright Browser E2E Verification
- **Targets:** `https://aura-living-cafe-492817.web.app` & `https://aura-api-214091459755.asia-south1.run.app`
- **Live HTTP/API Lifecycle (`scripts/verify_live.py`):** **ALL PASSED**
  - `GET /`: `200` (`608.9 ms`), `GET /app/`: `200` (`399.4 ms`), `GET /staff/`: `200` (`422.8 ms`)
  - `GET /health` + CORS: `200` (`284.1 ms`, `storeMode: "firestore"`, `Access-Control-Allow-Origin: https://aura-living-cafe-492817.web.app`)
  - Demo login: `customer-1` → `200`, `manager-1` without passcode → `403`, `manager-1` with Secret Manager passcode → `200`
  - Live almond allergy check: `200`, `topPick: "Iced Long Black"` (zero tree-nut drinks)
  - Live order lifecycle (`ord_73feb264ee`): `plan` → `confirm` → staff sees order → `preparing` (`consumedAt: null`) → `ready` (`consumedOnce: true`) → second `ready` **blocked (`409`)** → customer sees `ready` → clean `/demo/reset`
- **Live Chromium Playwright Suite (`npx playwright test` against production URL):** **4/4 PASSED (`28.7s`)**
  - Homepage load performance (real Chromium measurement): `domContentLoaded: 943 ms`, `loadEventEnd: 2112 ms`, First Load JS `199 kB`, `pageErrors: []`
  - WebGL-disabled + `prefers-reduced-motion: reduce` SVG fallback verified (`1.3s`)
  - Full dual-context Customer ↔ Manager E2E workflow verified (`17.5s`)
  - Responsive layout verified with `<= 4px` horizontal overflow across `390px`, `768px`, `1280px`, `1440px` (`2.7s`)
