# AURA — ENGINEERING_PLAN.md
## Execution principle
Build the smallest true **customer intent → ingredients → order → staff** loop, and layer Carbonexo-inspired physics storytelling around a working system. No UI-only fake success. No premature multi-agent architecture or refactor of unrelated apps.

### Suggested repo structure
```
aura/
  docs/ (these 9 specs)
  web/  (Next.js App Router, TypeScript, Tailwind, R3F, Motion)
    app/(public)/page.tsx
    app/app/{page.tsx,menu,room,people,orders}
    app/staff/{page.tsx,orders,inventory,insights}
    components/hero/, components/room/, components/customer/, components/staff/
    lib/api/, lib/auth/, lib/types/, lib/featureFlags/
  api/
    app/main.py, app/auth.py, app/routes/, app/services/, app/agents/, app/models/
    tests/, evals/
  firebase/firestore.rules
  scripts/seed_demo.py
  infra/setup.sh, infra/deploy.sh, infra/teardown.sh
  README.md, DECISIONS.md, .env.example
```

### Milestones (each must run and be verified)
**M0 — Preflight & skills:** Inspect current repo, official Google skills, gcloud identity and exact project display name `gcp event credit coffee popup delhi`, account identity starts `namansharma2664`. Determine full email, true project ID, project number and linked event-credit billing; if ambiguous stop before billable change. Check model/region and costs. Never assume display name is PROJECT_ID.

**M1 — Working foundation:** Next.js routes compile, app shell, auth roles, Firestore rules, seed scripts, staff/customer navigation, demo tenant. Verify logout and all routes.

**M2 — Truthful transaction engine:** Ingredients, recipes, atomic order reservation and consumption, idempotency, staff queue, live UI. Automated concurrency tests before AI integration.

**M3 — One ADK experience agent:** tool contracts, user text → plan schema, explicit action approvals, fallback for model unavailable, ≥20 eval prompts.

**M4 — Physics hero:** performant cinematic coffee scene with pointer spring and scroll journey; accessible fallback. Customer CTA must remain instant. Never make pages unreachable for design work.

**M5 — Connected room + staff insights:** 12-seat map, crowd demo states, queue estimator, low-stock suggestions, linked particle paths; optional Connect MVP.

**M6 — Deploy + smoke tests:** verified project, Cloud Run web+api, Firebase, billing safeguards; execute full demo two sessions, refresh/log out, monitor logs, tag build.

## Runtime safeguards
Pin dependency versions; supply clean scripts for Windows/WSL/Linux where possible; typecheck/lint/unit tests at milestones. Explicit env var names: `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GEMINI_MODEL`, `FIREBASE_PROJECT_ID`, `DEMO_CAFE_ID`. Keep secrets out of version control. No destructive scripts run without dry-run or user approval.

## Implementation constraints
- No last-minute migration of functioning framework.
- Mobile first and no huge first-page WebGL bundle.
- Agent tools must be pure-read vs authenticated/write separated.
- App data truth persists in Firestore; never rely on frontend-generated quantities.
- Code/asset attribution and license tracking.
- Retain robust no-AI browsing and ordering fallback.

## Handoff checkpoint format
After each milestone write: changed files, paths, executed commands, exact test outcomes, screenshot/browser checks, current Google project and cost implications, known defects, next concrete task. Continue implementation within agreed safety boundaries; request approval before billable infrastructure or external actions.
