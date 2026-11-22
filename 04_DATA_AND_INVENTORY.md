# AURA — DATA_AND_INVENTORY.md
## Firestore model (schema examples)
Paths use `/cafes/{cafeId}/...`; use a single `demo-cafe` seeded tenant initially. All references are server validated.

| Collection | Key fields |
|---|---|
| `menuItems/{id}` | `name`, `description`, `pricePaise`, `category`, `allergens[]`, `dietaryTags[]`, `recipe[]`, `active`, `prepWorkUnits` |
| `ingredients/{id}` | `name`, `unit`, `onHand`, `reserved`, `lowThreshold`, `updatedAt`, `version` |
| `orders/{id}` | `userId`, `items[{menuItemId,qty,selectedModifiers}]`, `totalPaise`, `status`, `estimatedReadyAt`, `idempotencyKey`, `createdAt` |
| `orderEvents/{id}` | `orderId`, `from`, `to`, `actorId`, `at`, `reason` |
| `tables/{id}` | `zone`, `seats`, `hasOutlet`, `status`, `reservationId`, `updatedAt` |
| `reservations/{id}` | `tableId`, `userId`, `expiresAt`, `state`, `createdAt` |
| `sessions/{id}` | `title`, `tags[]`, `hostId`, `joinPolicy`, `visibility`, `approvedMemberIds[]` |
| `operationalRecommendations/{id}` | `type`, `evidence`, `status`, `createdAt`, `decidedBy` |
| `demoScenarios/{id}` | `name`, `occupancyProfile`, `sampleOrders`, `noiseSource: "simulated"` |

### Price and units
Store integer **paise**, display rupees. Store inventory in explicit integer base units: milk in ml, coffee beans in g, syrup in ml, cups in each. Avoid floating-point subtraction. Recipe mapping, e.g. `oat-latte = {espressoBeansG:18, oatMilkMl:180, cupEach:1}`. Recipe ingredient identifiers are stable and versioned/snapshotted on order confirmation.

### Availability formula
`available = onHand - reserved` (never below zero). For each recipe ingredient `i`, servings available = `floor(available_i / perServing_i)`; effective max servings is minimum across ingredients. Modifiers change recipe requirements. Inactive/allergen-incompatible products are excluded according to customer filters.

### Exactly-once inventory strategy
At **confirmation**, Firestore transaction validates user, price snapshot, stock, idempotency key; creates order and increments `reserved` for required ingredient quantities. At **preparing/ready** a controlled transition converts stock reserve into consumption once: decrement `reserved` and `onHand` in the same transaction, with `consumedAt` / inventory event marker. Cancellation before consumption releases reservation. If cancel after consumed, follow explicit refund/waste policy, not a silent rollback. All stock changes use server-side atomic transactions and append an audit event. Never allow quantities to go negative.

### Manager inventory action
Explicit audited adjustment endpoint with reason, quantity, manager authorization and optimistic version / transaction; never a model-initiated mutation. AI may suggest safe actions using threshold and historical consumption; stock projections must identify input window and uncertainty.

### Seat reservation invariant
A table can have at most one active reservation. Reservation claims and table status update in one transaction; active reserved/occupied rows cannot be rebooked. Timeouts need explicit expiry handling. For hackathon demo, a server-triggered lazy expiration on availability queries can avoid Cloud Scheduler; handle stale UI gracefully.

### Deterministic wait estimator
Use work units, not hallucinated minute claims. Example: `etaMinutes = baseHandoff + ceil((queuedWorkUnits + currentOrderWorkUnits) / max(1, activeBaristas * workUnitsPerMinute))`; clamp/sanitize inputs, add uncertainty band based on volatility. Seed `workUnitsPerMinute` from conservative demo calibration. Report as **estimate**, not guarantee. Recalculate on order transition and scenario change.

### Demo seed requirements
20 menu items, 15 ingredients, 12 tables in four zones, 3 event scenarios, 12 historical orders, 4 community sessions. Fixture IDs deterministic. Demo data should be isolated in a separate `demo-cafe` namespace or project-controlled test tenant. Scripts must be idempotent.

## Required tests
Concurrent order race on final ingredient; duplicate idempotency key; cancel-before-consume; ready transition twice; improper staff actions; recipe modifiers; out-of-stock alternative; expired reservation; cross-café data access; negative inventory rejection; seed rerun.
