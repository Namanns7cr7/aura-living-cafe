# AURA — PRODUCT.md
## Scope and winning proposition
**Positioning:** AURA is the AI-powered bridge between *the person entering a café* and *the ingredients and staff capacity that make their visit possible*. Two user viewpoints share one state: personalized customer discovery, and inventory-aware staff decisions. **Not** an AI chatbot stapled to a CRUD app.

### The three promises
1. **People-first experiences:** Interpret purpose and constraints (focus, socialize, quick visit, dietary choice) with explicit permission and no invasive inference.
2. **Truthful recommendations:** Never recommend an item unavailable from live ingredients, or promise a wait unsupported by queue capacity.
3. **Actionable operations:** Show how an order affects ingredients; flag shortages and suggest reasonable substitutions or waste-reduction actions for staff approval.

## Personas / jobs
- Customer on a deadline: `I have 15 minutes; what is feasible?` Wants accurate estimated readiness.
- Customer wanting a space: `Quiet, sockets, two hours.` Wants a suitable available seat.
- Customer wanting connection: `Any coding / reading meetups?` Wants opt-in gatherings, not tracking.
- Barista: `What should I prepare next?` Wants correct, concise ticket and stock info.
- Manager: `What ingredients will run out this afternoon?` Wants explainable, not fabricated predictions.

## MVP: P0
- Public cinematic hero with instant `Enter café`.
- Guest demo access plus authenticated account option; customer/staff role isolation.
- Real menu with allergens, recipe requirements, prices and stock-aware availability.
- Fast intent-driven visit plans via Gemini + tool-calling, bounded to grounded data.
- Cart, order confirmation, status lifecycle, wait estimator; no payment processing.
- Firestore inventory ledger and reserved-stock deduction with conflict-safe transaction.
- Staff board: queue, mark preparing/ready, approve adjustments, inventory low-stock alerts.
- Small 12-table room view with direct reservation if feasible (after P0 stock/order works).

## P1
- Inventory visual flow connected to hero and dashboard, Rush Hour demo mode, ingredient dependency impact, AI inventory suggestions, personalized substitute explanations.
- Public community sessions with opt-in creation/request/accept; anonymous aggregate crowd hints only.

## Explicit non-goals
Payments, point-of-sale integration, supplier purchasing, employee scheduling automation, facial analysis, mood inference from images/microphones, unmoderated stranger messaging, hardware sensors, multi-café marketplace, arbitrary stock decrement based on model output.

## North-star demo (3 minutes)
00:00–00:30 hero droplet transforms into living café with live/seeded stock nodes.
00:30–01:00 customer says `Quiet corner, oat-milk coffee under ₹250, ready within 10 min.`
01:00–01:30 agent calls stock/menu/seating/ETA tools; user approves feasible cart and table.
01:30–02:00 manager sees ticket and inventory reserved; projected oat milk servings decrease.
02:00–02:30 simulate rush or low oat milk; agent recommends an in-stock substitute and manager approves suggested promotion, no silent mutation.
02:30–03:00 barista marks ready; customer receives live update; optional opt-in meetup discovery.

## Success metrics — collect observed data only
- 100% price and stock checks for confirmed orders (assertions/tests).
- Zero successful double-bookings or oversells in concurrency tests.
- User intent→valid visit plan successful in ≥16/20 curated eval cases; ≥95% correct authorization decisions.
- End-to-end order state reflected on customer and staff screens after Firestore event propagation (log latency, avoid guaranteeing fixed ms).
- Realistic functional fallback if AI unavailable; 3-minute demo repeatable without manual DB repair.

## Tradeoff
If time limited, keep **customer-to-inventory loop** rock solid, then invest in polished hero. Remove people-match extras rather than compromising order/inventory correctness.
