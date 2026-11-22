# AURA — TEST_AND_DEMO.md
## Release gates
No deployment success announcement without live URL verification, actual Gemini tool call and end-to-end customer/staff sync.

### Test matrix
| Layer | Must verify |
|---|---|
| UI | Public hero CTA, skip animation, routes after refresh, auth/logout, responsive widths 390/768/1280/1440, keyboard/reduced-motion, WebGL disabled |
| Catalog | Price paise, allergen labels, recipe availability, unavailable items blocked, modifiers reconciled |
| Transactions | Concurrent last-stock race, duplicate idempotency, stock never negative, cancel before consumed, ready twice, audit log exactly once |
| Room | Seat race, expiry, unavailable table, duplicate booking, simulator isolation |
| Auth | Customer cannot call staff endpoint; user A cannot view user B order; cross-café data isolation; no direct client writes to stock |
| AI | ≥20 evals from AGENTS doc; valid tool calls; no invented ETAs/prices; prompt injection; no hidden canned fallback |
| Operational | Queue increases ETA (under fixed capacity), completing tickets reduces workload, recommendations cite live ingredients/thresholds |
| Resilience | Gemini 404/quota/timeout, Firestore temporary unavailability, cold starts, 3D crash, hard refresh |

### E2E test sequence
1. Seed demo namespace twice — counts unchanged (idempotent).
2. Log in customer + staff separately; observe distinct roles.
3. Customer asks focus+oat under ₹250; verify recommendations fit menu, recipe and ETA.
4. Confirm order exactly once; compare customer/staff order ID, totals and `reserved` delta.
5. Staff marks Preparing then Ready; verify count/ledger consumes once and customer updates.
6. Switch demo mode to Rush; verify explicit simulation label and increased queue ETA.
7. Create out-of-stock condition; verify AI and UI refuse unsupported drink, offer eligible alternative.
8. Open page on mobile width, refresh deep links, test login and logout.
9. Disable WebGL and AI; functional app still usable.
10. Inspect deployed logs, health endpoint, correct project and model attribution.

### Evaluation report template
`model_id`, `region`, `date`, `commit`, `dataset_version`, `n_cases`, `schema_valid_n`, `grounded_n`, `tool_correct_n`, `authorization_safe_n`, `median_latency_ms`, `p95_latency_ms`, `failures[]`. Never report unexecuted cases as passed. Record response source as `gemini`, `deterministic`, or `error`; do not label deterministic fallback as AI.

### 3-minute judge script
**0:00** show living espresso hero and interactive ripple; `This café isn't only smart at ordering, it understands the customer and the stockroom together.`
**0:25** enter café and ask `Quiet table with charging and dairy-free coffee under ₹250 within 10 minutes.`
**0:55** show tool-grounded plan; approve action; customer order created.
**1:25** switch to staff window, same order appears, ingredient ledger updates.
**1:50** trigger labeled Rush Hour simulation, visual flow intensifies, wait estimate moves.
**2:15** show AI inventory-risk insight based on actual units and approval-only response.
**2:40** mark Ready; live status updates; show negative out-of-stock test.
**2:55** final message: `One café. Two perspectives. One intelligence grounded in reality.`

### Judge FAQ proof
- Why agentic? Bounded multi-step tool reasoning handles customer constraints with stock/seat/queue, approval-based action.
- Why Google Cloud? Firebase real-time + Firestore transactions, Cloud Run scale-to-zero, ADK/Gemini inference.
- Why physics? Visualizes dynamic operation; not merely a video.
- Privacy? Opt-in communities, no tracking or emotion inference.
- Business value? Fewer failed orders and more actionable stock/wait visibility; quantify only measured prototype metrics.
