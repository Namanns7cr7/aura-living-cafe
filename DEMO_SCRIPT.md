# AURA — 3-Minute Judging Demo Script

**Setup (before clock starts):**
- Window 1 (Customer): Open `/` (AURA Physics Homepage).
- Window 2 (Manager): Open `/login`, enter staff passcode, sign in as **Meera (Manager)** → lands on `/staff` (Café Command Center). Click **Reset Demo** once so baseline stock & Calm scenario are clean.

---

### 0:00 – 0:30 · The Living Espresso Physics Hero (`/`)
1. Show the slow-rotating dark espresso droplet suspended above concentric coffee ripples. Move pointer to show spring-damped orbital disturbance.
2. Scroll smoothly through **Scene 2 (From Bean to Experience)**, **Scene 3 (The Living Room — 12 live tables)**, and **Scene 4 (The Intelligence Flow — live ingredient stock bars)**.
3. **Narration:** *"AURA isn't a chatbot bolted onto a café website. Every table and ingredient orb you see here is driven by real Firestore state—connecting why a guest walks in with what the stockroom can actually serve."*
4. Click **Enter the Café** → instant navigation to `/app`.

### 0:30 – 1:15 · Grounded Customer Concierge + Explicit Confirmation (`/app`)
1. Sign in as **Ananya (Customer)** via one-click public demo login.
2. Enter the signature prompt:
   > `I have a meeting; need a quiet corner with an outlet and an oat-milk coffee under ₹250 ready within 10 min.`
3. Click **Ask AURA**. Point out:
   - Live tool evidence count, ₹220 price, exact servings left, quiet outlet table `Q2`, deterministic ETA range (`6–8 min`), and explicit **No Auto-Ordering** badge.
   - *(Bonus safety proof: mention `"I'm allergic to almonds"` excludes all `tree_nuts` drinks including Iced Almond Cloud Latte!)*
4. Click **Confirm Order & Reserve Stock** → atomic transaction reserves 180ml oat milk + 18g espresso beans + 1 cold cup + table `Q2`.
5. Click **Track Live Order** (`/app/orders`).

### 1:15 – 1:50 · Live Manager Command Center & Single-Consumption (`/staff`)
1. Switch to Window 2 (Meera — Manager). Point out Ananya's order appearing live in the **Order Queue** and `oat_milk_ml` `Reserved +180ml` in **Live Stock Movement**.
2. Click **Mark Preparing** (stock stays reserved, NOT consumed yet).
3. Click **Mark Ready (Consume Stock)** → watch `On-Hand −180ml`, `Reserved −180ml` fire **exactly once** (guarded by `consumedAt`).
4. Glance back at Window 1 (Customer): status updates live to **Ready**!

### 1:50 – 2:35 · Rush Hour, Low Stock & Approval-Only AI Ops (`/staff/insights`)
1. In Window 2, click **Demo Simulation: Low Stock** (notice `oat_milk_ml` clamps safely above reserved, leaving just 1 serving) and **Rush** (watch queue ETA estimate jump cleanly with explicit `Demo simulation` label).
2. Open **AI Ops (`/staff/insights`)** and click **Analyze Operations**.
3. Show the tool-grounded brief citing real ingredient units and proposing an approval-only **Feature in-stock substitute** action.
4. Click **Approve Action** → returns to `/app` showing the approved substitute banner live for customers without any silent AI mutation.

### 2:35 – 3:00 · Out-of-Stock Honesty & Closing
1. Attempt to order a paused/sold-out item on `/app/menu` (disabled button) or via Concierge → AURA truthfully reports the shortage and suggests an in-stock alternative.
2. **Closing line:** *"One café. Two perspectives. One Google Cloud intelligence grounded in live reality."*
