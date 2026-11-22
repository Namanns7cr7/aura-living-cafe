# AURA — ANTIGRAVITY_HANDOFF.md
## Paste this as your first Antigravity message

> You are the engineering lead for **AURA — The Living Café**, a Google Cloud hackathon web app. Read **all nine Markdown files** in this folder *before* proposing a rewrite or coding. Treat `01_DESIGN.md` as the design authority, `04_DATA_AND_INVENTORY.md` as data invariants, and `07_ENGINEERING_PLAN.md` as the ordered build plan. The product connects **people's café intentions** with **real menu, inventory and staff capacity**; it is not a generic chatbot. Its first page is a Carbonexo-inspired **physics-driven cinematic experience** built with Next.js, React Three Fiber/Three.js, scroll chapters, pointer-influenced spring motion and a robust accessible fallback. The visual metaphor is a living espresso drop transforming into a café, whose order and ingredient flows reflect real app data. Build a real customer app and manager dashboard with inventory-aware ordering, agentic Gemini tool use, an interactive seating map, and optional opt-in community discovery. All hosted AI/cloud infrastructure must be Google Cloud/Firebase; open-source JS/Python libraries are acceptable. Use official **Google skills** from `https://github.com/google/skills`, inspecting the live README and choosing the actual relevant skill paths (also consult `https://github.com/google-gemini/gemini-skills`). Verify installation syntax; don't invent skills.
>
> **CRITICAL ACCOUNT PRE-FLIGHT:** `gcloud auth list` must identify the complete Google account associated with `namansharma2664`. Find the Google Cloud project with display name exactly `gcp event credit coffee popup delhi`, discover its real project ID, and verify it is linked to the intended event-credit billing configuration. Do not guess email, project ID, remaining credits or model access. Use project explicit in every deployment command. Prefer `asia-south1`; verify actual Gemini Flash model and endpoint using official docs and authenticated smoke test. Keep initial costs near a $5 USD safety target; budgets alert, not cap. Do not create billable resources or change billing if preflight fails.
>
> Start with **Phase 0 preflight + Phase 1 architecture**, then implement sequential milestones M1–M6 from `07_ENGINEERING_PLAN.md`. Deliver code, tested flows, deployed URL and a reproducible 3-minute demo. Do not stop at mockups; do not fake AI responses, stock figures, model calls, deployment results or tests. Prioritize correctness of customer→order→inventory→staff; next, a polished physics homepage; next, room/community extras. Human approval for every order or outward action. At each phase give exact files changed, tests executed, bugs, costs and next work. Ask for my approval before modifying billing or committing substantial cloud spend.

## Artifact order (nine documents)
1. `01_DESIGN.md` — visual principles, physics-story scenes, UI specifications.
2. `02_PRODUCT.md` — product thesis, user value, scope and KPIs.
3. `03_ARCHITECTURE.md` — Google-only deployment boundaries, identity, failure modes.
4. `04_DATA_AND_INVENTORY.md` — Firestore schema, atomic recipe stock ledger, ETA formula.
5. `05_AGENTS_AND_GOOGLE_SKILLS.md` — ADK tools, prompt safeguards, skill installation and evals.
6. `06_USER_JOURNEYS.md` — customer/staff and people community journeys.
7. `07_ENGINEERING_PLAN.md` — repo structure and implementation checkpoints.
8. `08_TEST_AND_DEMO.md` — QA release gates and 3-minute judge script.
9. `09_ANTIGRAVITY_HANDOFF.md` — this launcher prompt and working rules.

## A special warning about Carbonexo inspiration
Reference its feel—spring/inertia, responsive particles, scroll camera, cinematic story, parallax and tactile motion—not its Earth-specific content, code, user data, visual IP or cloud project. Do not connect Carbonexo repositories or production services unless explicitly provided and authorized. No accidental deployment into a prior hackathon project.

## Definition of done
Browser opens hero with functioning `Enter` CTA; customer selects real recipe-backed coffee and confirms; Firestore transaction reserves inventory; staff sees order; finishing order consumes inventory once; 3D room/flow communicates live or labeled simulated state; AI does grounded tools and fails visibly if unavailable; protected routes work; deployed app and tests are actually verified; Google account/project and credit eligibility documented.
