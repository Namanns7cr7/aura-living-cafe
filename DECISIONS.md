# AURA — Architectural & Engineering Decisions (`DECISIONS.md`)

## 1. Google Cloud Account & Billing Preflight
- **Verified Identity:** `namansharma2664@gmail.com` (`gcloud auth list` and `firebase login:list`).
- **Event Credit Billing Account:** `01D3D1-37E942-4640E0` (`GDP Event Credit: coffee popup Delhi`, `OPEN: True`).
- **Project Discovery:** Zero projects are currently linked to `01D3D1-37E942-4640E0`, and no existing project has display name `gcp event credit coffee popup delhi`. Active default gcloud project is `carbonexo`, which is strictly off-limits. No cloud project will be created or linked until explicit user approval at Milestone H.
- **Preferred Region:** `asia-south1` (Mumbai) for Cloud Run and Firestore, with verified Gemini Flash endpoint (`asia-south1` or `global` per authenticated smoke test).

## 2. Official Google Skills Installed
Installed selectively from `https://github.com/google/skills` via `npx skills add google/skills --skill ...`:
1. `cloud-run-basics` — Cloud Run scale-to-zero, `$PORT` binding (`0.0.0.0:8080`), revision management.
2. `firebase-basics` — Firebase CLI login, project selection, web SDK config, hosting setup.
3. `gemini-api` — Unified `google-genai` SDK patterns (avoiding deprecated SDKs/models), current model IDs.
4. `google-cloud-solution-build-deploy-agents` — Google ADK agent architecture & Cloud Run deployment patterns.
5. `google-cloud-waf-cost-optimization` — FinOps controls, zero idle compute, budget alerts & quotas.
6. `iam-helper-for-policy-management` — Least-privilege IAM roles for service accounts.
7. `cloud-logging-configuration-basics` — Minimal-volume structured logging.
8. `agent-platform-eval-flywheel` — Structured agent evaluation harness metrics.
9. `gcloud` — Verified gcloud CLI invocation syntax.

## 3. Frontend Hosting Strategy: Static Export on Firebase Hosting
- **Decision:** Next.js `15.5.9` App Router with `output: 'export'` deployed to **Firebase Hosting** rather than an SSR Cloud Run container for `web/`.
- **Why:** Eliminates a second Cloud Run service and cold starts for page loads, keeps frontend hosting within Firebase Hosting's free tier (\$0.00/mo), and supports `/app/orders/:id` via Firebase Hosting rewrites to `/app/orders/index.html`.
- **Live Sync:** Uses client-side **Firestore `onSnapshot` listeners** on `tables`, `demoState/current`, and scoped `orders` when Firebase web config is present, plus auto-reconnecting SSE and a 10s polling fallback for local/multi-instance resilience.

## 4. Backend & Data Architecture: FastAPI + Google ADK + Transactional Firestore Engine
- **Decision:** Single Python FastAPI service (`api/`) hosting deterministic domain engines alongside Google ADK agents (`CustomerExperienceAgent` and `InventoryOperationsAgent`).
- **Exactly-Once Inventory Lifecycle:** Order confirmation atomically reserves ingredient quantities (`reserved += qty`). Transition to `preparing` keeps stock reserved. Transition to **`ready` ONLY** consumes stock once (`onHand -= qty`, `reserved -= qty`, guarded by `consumedAt is None`) and appends an audit event. Duplicate `ready` transitions return `409`.
- **Firestore Efficiency & Read-Only Safety:** `list_orders`, `list_order_events`, and `list_inventory_events` use indexed `where(FieldFilter(...))` + `order_by()` + `.limit()` queries (zero full-collection scans). `list_tables` is strictly read-only (computes lazy expiry in memory); `reserve_table_tx` and `release_table_tx` are `@firestore.transactional` and update linked `reservations/{id}` docs to `expired` or `cancelled`.
- **Verification:** Verified with **20 local tests + 7 real Firebase Firestore Emulator concurrency/idempotency/transaction tests + 32 AI evaluation scenarios**.

## 5. Agent Grounding, Safety & Strict No-Write Separation
- **Single Canonical Model ID:** `gemini-3.8-flash` (configured via `GEMINI_MODEL`, verified via authenticated smoke test before production cutover; `COST_REPORT.md` matches).
- **No Order-Creation Tool on Agent:** `create_order_after_confirmation` is intentionally excluded from the agent toolset. The agent only reads grounded data and drafts a plan with a server-issued cryptographic `approvalToken`; the UI Confirm button calls `POST /api/v1/customer/orders/confirm` directly.
- **Allergy & Negation Safety:** Negation/allergy context (`allergic to X`, `no X`, `X-free`, `can't have X`) is parsed BEFORE positive keywords, mapping almond/cashew/hazelnut/walnut/pistachio to `tree_nuts` and `no milk` to `dairy`, and banning negated terms from keyword boosts.
- **Structured Intent Extraction + Grounding Validator:** Uses Gemini structured output (Pydantic `StructuredIntentOutput`) with deterministic clamping when live credentials are active, and validates every `₹` amount and catalog drink name in Gemini prose before returning it—falling back to deterministic prose on any mismatch.

## 6. Security & Privacy Boundaries
- **Demo Auth Hardening:** `ALLOW_DEMO_AUTH` defaults to `false`, is restricted exclusively to `demo-cafe`, and `/api/v1/public/demo-login` publicly issues customer personas only; `barista-1` and `manager-1` require `DEMO_STAFF_PASSCODE` (injected from Secret Manager in production) or real Firebase accounts with café-scoped claims.
- **Fail-Closed Startup:** Server refuses to start outside `local`/`test` environments if `APPROVAL_TOKEN_SECRET` is a placeholder or shorter than 24 characters.
- **Café-Scoped Firestore Rules & Private Session Subcollection:** Staff rules enforce `request.auth.token.cafeId == cafeId`. Community session member lists, pending join requests, and host meeting notes live in `/cafes/{cafeId}/sessions/{sessionId}/private/members`, readable only by host, approved members, or café managers.
- **Per-User & Per-IP AI Rate Limiting:** Enforces per-minute RPM, per-user daily cap (`30`), per-guest-IP daily cap (`10`), and global daily budget (`200`) so no single visitor can exhaust shared AI quota.

## 7. Physics-Engine Homepage Performance Strategy
- React Three Fiber + Three.js with custom concentric liquid ripples, spring-damped pointer orbital physics, flowing aroma/order particles, and live table/ingredient nodes—DPR capped at `1.5`, lazy-loaded after first paint, `prefers-reduced-motion` static mode, and automatic WebGL-disabled SVG fallback.
