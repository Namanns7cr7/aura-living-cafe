# AURA — The Living Café

> *"A café that understands why you came, not just what you ordered."*

AURA connects **People Intelligence** (intent-aware drink, seat, and opt-in community discovery) with **Inventory Intelligence** (deterministic recipe consumption, atomic stock reservation, and manager operations)—powered exclusively by Google Cloud, Firebase, FastAPI, Google ADK, and Gemini.

---

## Architecture Overview

- **Frontend (`web/`)**: Next.js 15 (`output: 'export'`), TypeScript, Tailwind CSS, React Three Fiber + Three.js (5-scene Living Espresso physics homepage), Framer Motion, Firebase Firestore `onSnapshot` live sync (+ SSE & polling fallback). Hosted on **Firebase Hosting** (\$0.00 free tier).
- **Backend (`api/`)**: Python FastAPI + **Google ADK** (`LlmAgent` + `Runner` via `google-genai`) + transactional Cloud Firestore store (with thread-safe local store parity). Hosted on **Cloud Run** (`asia-south1`, scale-to-zero, `min-instances=0`, `max-instances=2`).
- **AI Model**: Single canonical model `GEMINI_MODEL=gemini-3.8-flash` (smoke-tested before production cutover; structured intent extraction + post-generation grounding validator + explicit deterministic fallback).
- **Database & Security**: Cloud Firestore under `/cafes/{cafeId}/...` with café-scoped role claims in `firebase/firestore.rules`, server-only mutations, private session member subcollections (`sessions/{id}/private/members`), and fail-closed production secret checks.

---

## Core Technical Guarantees

1. **Zero Hallucinated Inventory or Prices**: Every recommendation is filtered against live ingredient stock (`available = onHand - reserved`, integer base units `ml`/`g`/`each`) and integer paise prices.
2. **No Autonomous AI Writes**: The Customer Experience Agent has **read-only tools only**—no order-creation tool exists on the agent. It drafts a plan with a server-issued cryptographic `approvalToken`; the human user clicks Confirm to call `POST /api/v1/customer/orders/confirm`.
3. **Exactly-Once Stock Consumption**: Confirming an order atomically increments `reserved`. Moving to `preparing` keeps stock reserved. Marking **`ready`** atomically decrements `onHand` & `reserved` once (guarded by `consumedAt`), preventing double-deduction on duplicate transitions.
4. **Allergy-First Safety**: Negation/allergy spans (`allergic to almonds`, `cashew allergy`, `no milk`, `nut-free`) are extracted before positive keywords, mapping nut varieties to `tree_nuts` and banning negated keywords from boosts.

---

## Local Development & Verification

### 1. Backend API
```powershell
cd api
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8080
```
*(Set `ALLOW_DEMO_AUTH=true` and `DEMO_STAFF_PASSCODE=aura-local-staff-2026` in `api/.env` for local demo persona testing.)*

### 2. Frontend Web
```powershell
cd web
npm run dev
```
Open `http://localhost:3000`.

### 3. Run All Tests
```powershell
# Backend unit, security, RBAC & 32-scenario AI evals
api\.venv\Scripts\python.exe -m pytest api\tests -v
api\.venv\Scripts\python.exe api\evals\eval_scenarios.py

# Real Google Cloud Firestore Emulator concurrency & idempotency tests
npx -y firebase-tools@13.35.1 emulators:exec --only firestore --project aura-emulator-test "api\.venv\Scripts\python.exe -m pytest api\tests\test_firestore_emulator.py -v"

# Frontend static build & Playwright E2E
npm --prefix web run typecheck
npm --prefix web run build
npx --prefix web playwright test
```

---

## Documentation Index

- Design & Product Specs: `01_DESIGN.md` – `09_ANTIGRAVITY_HANDOFF.md`
- Architecture & Decisions: [DECISIONS.md](./DECISIONS.md)
- Cloud Preflight & Cost Control: [COST_REPORT.md](./COST_REPORT.md)
- Real Test & Eval Results: [TEST_REPORT.md](./TEST_REPORT.md)
- 3-Minute Judging Demo: [DEMO_SCRIPT.md](./DEMO_SCRIPT.md)
- Production Verification: [DEPLOYMENT_REPORT.md](./DEPLOYMENT_REPORT.md) *(created after approved deploy)*
