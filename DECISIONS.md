# AURA — Architectural & Engineering Decisions (`DECISIONS.md`)

## 1. Google Cloud Account & Billing Preflight
- **Verified Identity:** `namansharma2664@gmail.com` (`gcloud auth list` and `firebase login:list`).
- **Event Credit Billing Account:** `01D3D1-37E942-4640E0` (`GDP Event Credit: coffee popup Delhi`, `OPEN: True`).
- **Project Discovery:** Zero projects are currently linked to `01D3D1-37E942-4640E0`, and no existing project has display name `gcp event credit coffee popup delhi`. Active default gcloud project is `carbonexo`, which is strictly off-limits. No cloud project will be created or linked until explicit user approval at Milestone H.
- **Preferred Region:** `asia-south1` (Mumbai) for Cloud Run and Firestore, with verified Gemini Flash endpoint (`asia-south1` or `global` per Vertex AI availability check).

## 2. Official Google Skills Installed
Installed selectively from `https://github.com/google/skills` via `npx skills add google/skills --skill ...`:
1. `cloud-run-basics` — Cloud Run scale-to-zero, `$PORT` binding (`0.0.0.0:8080`), revision management.
2. `firebase-basics` — Firebase CLI login, project selection, web SDK config, hosting setup.
3. `gemini-api` — Unified `google-genai` SDK patterns (avoiding deprecated SDKs/models), model IDs (`gemini-3.8-flash` / `gemini-3.5-flash-lite` / `gemini-4-hydrogen`).
4. `google-cloud-solution-build-deploy-agents` — Google ADK agent architecture & Cloud Run deployment patterns.
5. `google-cloud-waf-cost-optimization` — FinOps controls, zero idle compute, budget alerts & quotas.
6. `iam-helper-for-policy-management` — Least-privilege IAM roles for service accounts.
7. `cloud-logging-configuration-basics` — Minimal-volume structured logging.
8. `agent-platform-eval-flywheel` — Structured agent evaluation harness metrics.
9. `gcloud` — Verified gcloud CLI invocation syntax.

## 3. Frontend Hosting Strategy: Static Export on Firebase Hosting
- **Decision:** Use Next.js App Router with `output: 'export'` deployed to **Firebase Hosting** rather than an SSR Cloud Run container for `web/`.
- **Why:** Eliminates a second Cloud Run service and cold starts for page loads, keeps frontend hosting within Firebase Hosting's free tier (\$0.00/mo), and supports deep links (`/app/orders/:id`) via Firebase Hosting rewrites to `/app/orders/index.html`.
- **Trade-off:** All dynamic café state loads client-side via authenticated API calls + real-time listeners/SSE; the hero landing page renders a fast static espresso poster + instant CTAs immediately before lazy-loading the R3F/Three.js canvas.

## 4. Backend & Data Architecture: FastAPI + Google ADK + Dual-Mode Transactional Store
- **Decision:** Single Python FastAPI service (`api/`) hosting deterministic domain engines (inventory, recipes, orders, rooms, ETA, opt-in people connect) alongside Google ADK agents (`CustomerExperienceAgent` and `InventoryOperationsAgent`).
- **Storage Parity:** Abstracted `CafeStore` interface with:
  - `FirestoreCafeStore` (production): Native Google Cloud Firestore transactions (`@firestore.transactional`) under `/cafes/{cafeId}/...`.
  - `MemoryCafeStore` (local dev & pytest): Thread-safe, lock-protected transactional store implementing identical atomic invariants (idempotency, reservation, exactly-once consumption, optimistic version checks, lazy seat expiration).
- **Why Deterministic Math + LLM Reasoning:** Gemini Flash interprets natural-language intent, selects tool calls, and explains grounded options; deterministic Python + Firestore transactions enforce 100% accurate integer paise pricing, integer base units (`ml`, `g`, `each`), stock reservations, and work-unit ETA calculations. AI can never mutate stock or override prices.

## 5. Gemini Model Selection & Graceful Degradation
- **Target Model:** `gemini-3.8-flash` (configured via `GEMINI_MODEL` env var) using unified `google-genai` / `google-adk` on Google Cloud (`GOOGLE_GENAI_USE_VERTEXAI=true`).
- **Fallback Policy:** If `gemini-3.8-flash` is unavailable on the verified project/region during smoke testing, switch `GEMINI_MODEL` to `gemini-3.5-flash-lite` or `gemini-4-hydrogen` and document the exact substitution.
- **Resilience:** If Vertex AI / Gemini is unreachable, unconfigured, or rate-limited, AURA returns a clear `source: "deterministic"` or `source: "error"` badge (never mislabeled as `"gemini"`) while keeping full menu, cart, checkout, seating, and manager inventory operations 100% functional.

## 6. Physics-Engine Homepage Performance Strategy
- **Decision:** React Three Fiber + Three.js with custom GLSL-inspired fluid ripple shaders, spring-damped pointer physics, instanced particles, and scroll-linked 5-chapter camera choreography—without adding Rapier rigid-body bloat (unnecessary for fluid/particle/camera storytelling).
- **Fallbacks:** DPR capped at `1.5`, dynamic `lazy()` loading after first paint, `prefers-reduced-motion` static composition, explicit `Skip to Café` / `Enter the Café` buttons always accessible, and automatic WebGL-unavailable SVG/CSS canvas fallback.

## 7. Security & Privacy Boundaries
- Firebase ID tokens verified server-side; staff/manager privileges come strictly from trusted custom claims or server-managed demo role tokens (never client-asserted role headers in production).
- Firestore Security Rules block all direct client writes to `ingredients`, `orders`, `orderEvents`, `tables`, `reservations`, and `operationalRecommendations`.
- Connect (`/app/people`) is strictly opt-in; exact table numbers and member PII are never exposed publicly.
