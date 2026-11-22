# AURA — USER_JOURNEYS.md
## Narrative: people × inventory, not disconnected features
### Journey A — The focus visitor
1. Open cinematic homepage; can enter app immediately.
2. Select `Focus` or ask `I have a meeting; need a quiet outlet and oat coffee under ₹250`.
3. AI reads real seats, stock/recipes, menu and queue. Displays options with item price, seat facts and ETA *estimates*.
4. User clicks Confirm. Backend rechecks prices, ingredient stock, active seat booking; records receipt/transaction.
5. Customer sees live order; staff sees same order. Room map shows reservation; ledger `reserved` increases. Hero/order flow visual can react to successful app data.
6. Staff marks Preparing then Ready; consumption journal reconciles once. Customer sees Ready.

### Journey B — The stock pinch
1. Manager opens dashboard and sees oat milk available servings, sales velocity and risk threshold.
2. Demo controls trigger a *clearly simulated* rush/low-stock event in isolated café dataset.
3. Menu availability changes; AI avoids recommending unavailable combinations.
4. Operations assistant suggests `Promote almond latte or cold brew` **only if ingredients are available and menu configured**. Include evidence, stock units and confidence; don't auto-promote or adjust prices.
5. Manager approves an internal banner action; customer app updates. No supplier orders or unapproved customer messages.

### Journey C — Come for connection
1. Customer explicitly opts into Connect and chooses tags `AI`, `study`, `design`.
2. Public sessions are discoverable without exposing exact member locations.
3. Customer requests to join; host approves; only then show meeting details provided by host.
4. The user can revoke discoverability or leave group; no background tracking.

### Journey D — Invalid operation
Two customers simultaneously attempt last oat latte. Firestore transaction lets at most one stock reservation commit; other receives a friendly, factual `Just sold out` alternative. AI never overrides constraints.

## Routes
`/` hero; `/app` customer home; `/app/menu`, `/app/room`, `/app/people`, `/app/orders`, `/app/orders/[id]`; `/staff`, `/staff/orders`, `/staff/inventory`, `/staff/insights`; `/login`; `/demo` optional admin-only controls.

## Experience contract
Every action has clear pending/success/error states and precise source labels: **Live**, **Estimated**, **Demo simulation**, **AI suggestion**. Customers may enter through direct URL; hero route must never trap app access. Role denial shows proper 403 view with sign-in path. Preserve user state across page navigation and refresh via Auth/Firestore, not in-memory-only state.

## Demo scripted interaction
Manager opens `/staff` in one browser, customer opens `/app` in second. Select demo café; manager sets Calm; customer generates visit plan, confirms order; manager observes receipt/inventory delta; manager sets Rush Hour; wait projection changes; ops agent proposes inventory-saving option; barista marks Ready; customer receives live state. Show negative test: attempting unavailable item is blocked with explanation. Don't manually overwrite DB to fake states during showcase.
