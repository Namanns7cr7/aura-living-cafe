# AURA — DESIGN.md
**Version:** 1.0 · **Product:** AURA — The Living Café · **Status:** Implementation design authority

## 1. Creative north star
**An ordinary café becomes a living organism.** The opening page should have the *spatial, kinetic, physically responsive* quality of the Carbonexo physics-engine landing experience—scroll camera journeys, spring momentum, particles affected by the pointer, layered parallax, and coherent motion—without copying its Earth/globe or climate metaphors. Here, the hero object is a **living espresso universe**: a realistic cup and a luminous fluid ribbon linking customers, cups, tables, orders and ingredients.

The aesthetic is **cinematic specialty coffeehouse × precise operational intelligence**. Not a generic SaaS dashboard, fake sci-fi holograms, endless floating cards, or autoplay video masquerading as interactivity. Physics must be driven by interaction and ideally represent actual café state.

### Five-scene first-page journey
1. **The first drop (0–20% scroll):** Dark espresso field; floating coffee droplet in slow rotation. Pointer causes subtle orbital disturbance. Headline: *A café that feels your rhythm.* CTA: `Enter the café`; secondary CTA: `See it in action`. Reduced-motion version uses a still composition with accessible buttons.
2. **The ripple (20–40%):** Drop lands in a coffee surface. Physically damped waves reveal customer intents—Focus, Catch up, Explore, Grab & Go. Each is selectable, never dependent on hovering.
3. **The living room (40–65%):** Camera eases forward through the ripple into an isometric 3D/pseudo-3D café of tables and occupied chairs. Seat availability maps to real Firestore/demo state. Click a table to inspect quietness, outlets, and availability. No fictional live occupancy presented as actual.
4. **From cup to kitchen (65–85%):** Order flows as particles/light routes from a customer seat to barista prep and ingredient stock. Inventory nodes swell or dim based on available quantity, a concrete visual metaphor for operational data. A rush scenario increases queue flow; wait estimates update from the deterministic estimator.
5. **One café, two perspectives (85–100%):** Split customer and manager interfaces merge into a simple shared-state canvas. CTA `Open customer experience` and `Open café command center` (manager requires auth). Navigation remains available without completing scroll story.

**Hero interaction contract:** WebGL failure must never hide navigation or CTA. Load a fast static poster immediately, lazy-load the heavy scene after first paint, avoid layout shift, and let any user skip animations. No unbounded smooth-scroll hijacking. Physics engine is a UX layer, not a source of business logic.

## 2. Visual direction
- **Colors:** Espresso #17120F, deep roast #261A15, caramel #C88B50, oat cream #F5EFE4, warm porcelain #FFF9F1, muted sage #8B9B7E, coral status #D86F51, success #4D9276, ink #281D18. Contrast must meet WCAG AA for body text.
- **Type:** Google Fonts `DM Sans` for body, `Cormorant Garamond` for display, and `Space Grotesk` for numbers/technical UI. Provide system fallback and avoid flash of invisible text.
- **Layout:** 12-column desktop grid, 8px rhythm, max content width ~1440px, comfortable whitespace, tactile edges, very restrained blur.
- **Materials:** Coffee crema gradients, subtle anisotropic highlights, glass only for overlays over dark backgrounds, matte ceramic cards for app views; use real SVG and generated/owned assets.
- **Motion:** Springs rather than linear easing, 180–320ms for microinteraction, 450–750ms for scene transitions, subtle velocity-aware parallax; turn off parallax for touch/reduced motion. All meaningful state changes have non-animated text labels.
- **Sound:** Muted by default, no ambient autoplay.

## 3. UI screens and fidelity
### Public `/`
Hero scroll journey, top-left wordmark AURA, nav Experience / How it works / For cafés, `Enter the café` CTA, privacy/AI transparency summary. Allow direct entry immediately.
### Customer `/app`
Top contextual greeting; `What brings you in today?` intent selector; AI visit-plan compose bar; featured drinks grounded in stock; room preview; order progress; community/people opt-in tab; one persistent cart.
### Menu `/app/menu`
Category tiles, search, allergens/dietary filters, actual prices and stock badges; modifiers only if configured; disabled out-of-stock purchase actions.
### Room `/app/room`
Clickable floorplan with free/reserved/occupied badges; table zone, sockets, estimated ambient noise (simulated or sensor source labeled), reservation expiry. Accessible list alternative.
### Connect `/app/people`
Interest tags, opt-in only, public events and sessions, join request with moderator/user acceptance; never display exact seat or identifiable users by default.
### Order `/app/orders/:id`
State timeline, realistic ETA range, explanation of updates, cancellation rules, timestamps.
### Staff `/staff`
KPIs, order queue with action controls, inventory at-risk strip, waste-prevention opportunities, activity feed. Dedicated manager-only simulation toggles and approval-only recommendations.
### Inventory `/staff/inventory`
Ingredient ledger with available, reserved and reorder threshold; recipe impact: `Only 4 oat lattes possible`; transaction log; stock movement from verified order workflow.

## 4. Signature customer ↔ inventory interaction
Customer: `I need a quiet seat and a dairy-free coffee under ₹250, ready in 10 min.`
Agent reads menu, ingredient availability, table states and wait estimator; offers feasible options and asks for approval. User confirms; Firestore transaction reserves seat (optional) and creates order with ingredients reserved. Staff sees an order; predicted stock shifts. Manager receives an explanation grounded in quantities. Mark Ready/Collected; reconcile ingredient consumption exactly once, according to state machine. If inventory changes between recommendation and confirmation, revalidate and show a replacement.

## 5. Visual language for physical data
- Free table = soft sage pulse; occupied = matte clay; reserved = warm amber ring. No color-only status.
- Inventory abundance = thicker / brighter flow, depletion = slender flow; labels show actual units. Never use animations to conceal low stock.
- Order queue = flowing beads along barista route; count and ETA visible text.
- AI advice = small spark icon, grounded tool evidence and approval button; never make recommendations look like confirmed actions.

## 6. Implementation rules
Preferred **Next.js + TypeScript + Tailwind + React Three Fiber/Three.js + Motion** frontend on Cloud Run (or Firebase App Hosting when justified), FastAPI + Google ADK on Cloud Run, Firebase Auth and Firestore. Libraries are open-source build dependencies; all hosted cloud infrastructure and AI must remain Google-only. Use Three.js/R3F, Drei, optional Rapier only where real collision improves interaction; GSAP/ScrollTrigger optional for narrative sequencing. Choose *one* motion orchestration source for each element to avoid conflicts. Never mount heavyweight 3D in staff dashboard.

### Performance budgets and checks
- First meaningful content and CTA visible even before 3D JS; LCP target <2.5s on a reasonable test device/network (measure; not guaranteed).
- Desktop target 50–60fps for hero on reference hardware, degrade gracefully to 30fps; throttle offscreen rendering, DPR cap ~1.5, compressed textures and limited draw calls.
- Mobile: use simplified geometry/static fallback, touch-friendly interaction, no mandatory drag.
- Respect `prefers-reduced-motion`, keyboard focus and visible focus rings, high-contrast text, semantic controls; screen-reader text equivalents to all spatial data.
- Component transitions should preserve page routing/state; no broken pages, logout or hidden app routes.

## 7. Acceptance criteria for design
[ ] Real WebGL interactions change with pointer/scroll and remain usable via keyboard/touch.
[ ] User can skip directly to functional app; no hero boot dependency.
[ ] Real (or explicitly simulated) table/inventory state changes affect visual map.
[ ] Responsive screens at 390, 768, 1280 and 1440 px; no overlapping fixed panels.
[ ] Low-motion and WebGL-disabled paths remain beautiful and fully operable.
[ ] Staff sees readable business data, not ornamental 3D.
[ ] Contrast, tab order, focus management, loading/error states verified.
