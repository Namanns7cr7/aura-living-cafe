"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Armchair,
  CheckCircle2,
  Clock,
  Coffee,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { apiRequest, ApiError, formatRupees, subscribeCafeEvents } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useCart } from "@/lib/cart-context";
import { CafeOverview, MenuItem, Order, VisitPlanResponse } from "@/lib/types";

const INTENTS = [
  { id: "focus", label: "Focus", sub: "Quiet desk & outlet", prompt: "I have a meeting; need a quiet corner with an outlet and an oat-milk coffee under ₹250 ready within 10 min." },
  { id: "grab_and_go", label: "Grab & Go", sub: "Fastest pickup", prompt: "I want something cold, not too sweet, under ₹250, and I have 15 minutes." },
  { id: "catch_up", label: "Catch Up", sub: "Social table", prompt: "Meeting friends to catch up, need a social table and cold brew under ₹220." },
  { id: "explore", label: "Explore", sub: "Single-origin craft", prompt: "Recommend a dairy-free signature drink under ₹240." },
];

export default function CustomerHomePage() {
  const router = useRouter();
  const { user, token, loginDemoPersona } = useAuth();
  const { addItem, setDrawerOpen } = useCart();

  const [overview, setOverview] = useState<CafeOverview | null>(null);
  const [featuredMenu, setFeaturedMenu] = useState<MenuItem[]>([]);
  const [selectedIntent, setSelectedIntent] = useState<string>("focus");
  const [prompt, setPrompt] = useState(INTENTS[1].prompt);
  const [plan, setPlan] = useState<VisitPlanResponse | null>(null);
  const [asking, setAsking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<Order | null>(null);

  const loadLiveState = useCallback(async () => {
    try {
      const [ov, menuRes] = await Promise.all([
        apiRequest<CafeOverview>("/api/v1/public/overview"),
        apiRequest<{ items: MenuItem[] }>("/api/v1/public/menu"),
      ]);
      setOverview(ov);
      setFeaturedMenu(menuRes.items.slice(0, 6));
    } catch {
      // keep previous state on transient failure
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const urlIntent = sp.get("intent");
      const matched = INTENTS.find((it) => it.id === urlIntent);
      if (matched) {
        setSelectedIntent(matched.id);
        setPrompt(matched.prompt);
      }
    }
    loadLiveState();
    const unsub = subscribeCafeEvents(() => {
      loadLiveState();
    });
    return unsub;
  }, [loadLiveState]);

  const askConcierge = async (overrideMessage?: string, overrideIntent?: string) => {
    const msg = (overrideMessage ?? prompt).trim();
    if (!msg) return;
    setAsking(true);
    setError(null);
    setConfirmedOrder(null);
    try {
      const res = await apiRequest<VisitPlanResponse>("/api/v1/agent/plan", {
        method: "POST",
        token,
        body: {
          message: msg,
          intent: overrideIntent ?? selectedIntent,
        },
      });
      setPlan(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Concierge request failed.");
    } finally {
      setAsking(false);
    }
  };

  const handleConfirmPlan = async () => {
    if (!plan) return;
    let activeToken = token;
    if (!activeToken) {
      // Smooth one-click guest->demo customer sign-in then refresh approval token
      try {
        await loginDemoPersona("customer-1");
        setError("Signed in as Ananya (Demo Customer). Click 'Ask AURA' once more to generate your verified confirmation token.");
        return;
      } catch {
        router.push("/login?next=/app");
        return;
      }
    }
    if (!plan.approvalPreview || plan.proposedCart.length === 0) return;

    setConfirming(true);
    setError(null);
    try {
      const idemKey = `concierge-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const res = await apiRequest<{ order: Order; idempotentReplay: boolean }>("/api/v1/customer/orders/confirm", {
        method: "POST",
        token: activeToken,
        body: {
          items: plan.proposedCart,
          tableId: plan.approvalPreview.tableId ?? null,
          idempotencyKey: idemKey,
          approvalToken: plan.approvalPreview.approvalToken,
        },
      });
      setConfirmedOrder(res.order);
      await loadLiveState();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Order confirmation failed. Stock may have just changed.");
      }
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-oat text-ink">
      <Navbar variant="app" />

      <main className="mx-auto max-w-[1440px] space-y-8 overflow-x-hidden px-4 py-8 sm:px-6 lg:px-8">
        {/* Promo banner if Manager approved an inventory-aware substitute banner */}
        {overview?.promoBanner && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-caramel/40 bg-espresso px-5 py-3 text-sm text-porcelain">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-caramel" />
              <span>
                <strong className="text-caramel-light">Manager Pick (Live Stock):</strong> {overview.promoBanner}
              </span>
            </div>
            <Link href="/app/menu" className="text-xs font-semibold text-caramel-light underline">
              Browse Menu
            </Link>
          </div>
        )}

        {/* Greeting + Live Café Pulse */}
        <section className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-widest text-roast/75">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-success">
                <span className="h-2 w-2 rounded-full bg-success" /> Live Stock-Backed Café
              </span>
              {overview && overview.scenario !== "calm" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-coral/15 px-3 py-1 text-coral">
                  Demo simulation: {overview.scenario.replace("_", " ").toUpperCase()}
                </span>
              )}
            </div>
            <h1 className="font-display mt-3 text-4xl font-semibold leading-tight sm:text-5xl">
              {user ? `Welcome back, ${user.displayName.split(" ")[0]}.` : "Welcome to AURA."} What brings you in today?
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-ink/75">
              Every recommendation is verified in real time against café ingredients, barista queue capacity, and open seats—never guessed.
            </p>
          </div>

          {/* Live Metrics Card */}
          <div className="ceramic-card grid grid-cols-3 divide-x divide-ink/10 rounded-2xl p-4 lg:col-span-4">
            <div className="px-3 text-center">
              <p className="text-[11px] uppercase tracking-wider text-ink/60">Est. Wait</p>
              <p className="font-mono-num mt-1 text-2xl font-bold text-espresso">
                {overview ? `${overview.etaEstimate.minMinutes}–${overview.etaEstimate.maxMinutes}m` : "—"}
              </p>
              <p className="text-[10px] text-ink/55">Estimated</p>
            </div>
            <div className="px-3 text-center">
              <p className="text-[11px] uppercase tracking-wider text-ink/60">Open Seats</p>
              <p className="font-mono-num mt-1 text-2xl font-bold text-success">
                {overview ? `${overview.freeSeatsCount}/${overview.totalTablesCount}` : "—"}
              </p>
              <p className="text-[10px] text-ink/55">Live</p>
            </div>
            <div className="px-3 text-center">
              <p className="text-[11px] uppercase tracking-wider text-ink/60">In Stock</p>
              <p className="font-mono-num mt-1 text-2xl font-bold text-roast">
                {overview ? `${overview.availableMenuCount}/${overview.totalMenuCount}` : "—"}
              </p>
              <p className="text-[10px] text-ink/55">Recipes</p>
            </div>
          </div>
        </section>

        {/* Intent Pills + AURA Concierge */}
        <section className="ceramic-card rounded-3xl p-6 sm:p-8" aria-labelledby="concierge-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="concierge-heading" className="font-display flex items-center gap-2 text-2xl font-semibold sm:text-3xl">
                <Sparkles className="h-5 w-5 text-caramel" /> AURA Visit Concierge
              </h2>
              <p className="text-xs text-ink/65">Tell us your mood, budget (₹), dietary needs, time window, or seating needs.</p>
            </div>
            {!user && (
              <button
                type="button"
                onClick={() => loginDemoPersona("customer-1")}
                className="rounded-full border border-caramel bg-caramel/15 px-4 py-1.5 text-xs font-semibold text-roast hover:bg-caramel/25"
              >
                Quick Sign-In as Ananya (Customer)
              </button>
            )}
          </div>

          {/* 4 Intent Buttons */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {INTENTS.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => {
                  setSelectedIntent(it.id);
                  setPrompt(it.prompt);
                }}
                className={`rounded-2xl border p-3.5 text-left transition ${
                  selectedIntent === it.id
                    ? "border-espresso bg-espresso text-porcelain shadow-sm"
                    : "border-ink/10 bg-oat/60 text-ink hover:border-caramel"
                }`}
              >
                <p className="font-semibold">{it.label}</p>
                <p className={`text-xs ${selectedIntent === it.id ? "text-caramel-light" : "text-ink/60"}`}>{it.sub}</p>
              </button>
            ))}
          </div>

          {/* Compose Form */}
          <form
            className="mt-5 flex flex-col gap-3 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              askConcierge();
            }}
          >
            <label htmlFor="concierge-input" className="sr-only">
              Describe your ideal café visit
            </label>
            <input
              id="concierge-input"
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., I want something cold, not too sweet, under ₹250, and I have 15 minutes..."
              className="flex-1 rounded-2xl border border-ink/15 bg-white px-4 py-3.5 text-sm text-ink placeholder:text-ink/40 focus:border-caramel focus:outline-none"
            />
            <button
              type="submit"
              disabled={asking}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-caramel px-6 py-3.5 text-sm font-bold text-espresso shadow-sm transition hover:bg-caramel-light disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              {asking ? "Checking Stock..." : "Ask AURA"}
            </button>
          </form>

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-coral/40 bg-coral/10 p-3.5 text-sm text-coral" role="alert">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {confirmedOrder && (
            <div className="mt-5 rounded-2xl border border-success/40 bg-success/10 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-6 w-6 text-success" />
                  <div>
                    <p className="font-semibold text-ink">
                      Order Confirmed! <span className="font-mono-num text-sm text-roast">#{confirmedOrder.id}</span>
                    </p>
                    <p className="text-xs text-ink/75">
                      Ingredients atomically reserved · Estimated pickup {confirmedOrder.etaMinMinutes}–{confirmedOrder.etaMaxMinutes} min
                      {confirmedOrder.tableId ? ` · Seat ${confirmedOrder.tableId} reserved` : ""}
                    </p>
                  </div>
                </div>
                <Link
                  href={`/app/orders?id=${encodeURIComponent(confirmedOrder.id)}`}
                  className="rounded-full bg-espresso px-5 py-2 text-xs font-semibold text-porcelain hover:bg-roast"
                >
                  Track Live Order
                </Link>
              </div>
            </div>
          )}

          {/* Grounded Plan Output */}
          {plan && !confirmedOrder && (
            <div className="mt-6 space-y-5 rounded-2xl border border-ink/10 bg-oat/55 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-espresso px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-caramel-light">
                    {plan.source === "gemini" ? `AI Suggestion · ${plan.modelId}` : "Deterministic Verified Engine"}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-ink/75">
                    Intent: {plan.intent.replace("_", " ")}
                  </span>
                  {plan.eta && typeof plan.eta.minMinutes === "number" && (
                    <span className="font-mono-num inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-roast">
                      <Clock className="h-3 w-3" /> Est. {plan.eta.minMinutes}–{plan.eta.maxMinutes} min
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-ink/55">
                  Grounded via {plan.toolEvidence.length} live backend checks
                </span>
              </div>

              <p className="text-sm leading-relaxed text-ink">{plan.summary}</p>

              {plan.warnings.length > 0 && (
                <div className="space-y-1">
                  {plan.warnings.map((w, idx) => (
                    <p key={idx} className="text-xs font-medium text-coral">
                      ⚠ {w}
                    </p>
                  ))}
                </div>
              )}

              {/* Recommended Drinks Grid */}
              {(plan.recommendations.length > 0 || plan.alternativeSuggestions.length > 0) && (
                <div className="grid gap-3 md:grid-cols-3">
                  {(plan.recommendations.length > 0 ? plan.recommendations : plan.alternativeSuggestions).map((rec) => (
                    <div key={rec.menuItemId} className="ceramic-card flex flex-col justify-between rounded-xl p-4">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold text-ink">{rec.name}</h3>
                          <span className="font-mono-num font-bold text-roast">{formatRupees(rec.pricePaise)}</span>
                        </div>
                        <p className="mt-1 text-xs text-ink/70">{rec.why}</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {rec.dietaryTags.slice(0, 3).map((t) => (
                            <span key={t} className="rounded-full bg-sage/20 px-2 py-0.5 text-[10px] font-medium text-ink">
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          addItem({
                            menuItemId: rec.menuItemId,
                            name: rec.name,
                            qty: 1,
                            unitPricePaise: rec.pricePaise,
                            selectedModifierIds: [],
                            modifierNames: [],
                          });
                          setDrawerOpen(true);
                        }}
                        className="mt-3 w-full rounded-full border border-espresso py-1.5 text-xs font-semibold text-espresso hover:bg-espresso hover:text-porcelain"
                      >
                        Add to Tray
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Paired Seat + Explicit Human Confirmation Card */}
              {(plan.seat || plan.approvalPreview || plan.proposedCart.length > 0) && (
                <div className="flex flex-col justify-between gap-4 rounded-2xl border border-caramel/40 bg-porcelain p-4 sm:flex-row sm:items-center">
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-1.5 font-semibold text-espresso">
                      <ShieldCheck className="h-4 w-4 text-success" />
                      Explicit Confirmation Required (No Auto-Ordering)
                    </div>
                    {plan.approvalPreview && (
                      <p className="text-xs text-ink/75">
                        {plan.approvalPreview.items.map((i) => `${i.qty}× ${i.name}`).join(", ")} · Verified Total{" "}
                        <strong className="font-mono-num">{formatRupees(plan.approvalPreview.totalPaise)}</strong>
                      </p>
                    )}
                    {plan.seat && (
                      <p className="text-xs text-sage">
                        <Armchair className="mr-1 inline h-3.5 w-3.5" />
                        Suggested Seat: <strong>{plan.seat.label}</strong> ({plan.seat.why})
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {plan.approvalPreview ? (
                      <button
                        type="button"
                        disabled={confirming}
                        onClick={handleConfirmPlan}
                        className="rounded-full bg-caramel px-5 py-2.5 text-xs font-bold text-espresso shadow-sm transition hover:bg-caramel-light disabled:opacity-50"
                      >
                        {confirming ? "Reserving Stock..." : "Confirm Order & Reserve Stock"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => loginDemoPersona("customer-1")}
                        className="rounded-full bg-espresso px-5 py-2.5 text-xs font-semibold text-porcelain hover:bg-roast"
                      >
                        Sign in as Customer to Confirm
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Featured In-Stock Menu + Quick Shortcuts */}
        <section className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-8">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold">Freshly Grounded in Live Stock</h2>
              <Link href="/app/menu" className="text-sm font-semibold text-roast hover:text-caramel">
                Explore Full Menu →
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {featuredMenu.map((item) => (
                <div key={item.id} className="ceramic-card flex flex-col justify-between rounded-2xl p-4">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-ink">{item.name}</h3>
                      <span className="font-mono-num text-sm font-bold text-roast">{formatRupees(item.pricePaise)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-ink/70">{item.description}</p>
                    <div className="mt-2.5 flex items-center justify-between text-[11px]">
                      <span
                        className={`rounded-full px-2 py-0.5 font-semibold ${
                          !item.isAvailable
                            ? "bg-coral/15 text-coral"
                            : item.availableServings <= 3
                            ? "bg-caramel/20 text-roast"
                            : "bg-success/15 text-success"
                        }`}
                      >
                        {item.isAvailable ? `${item.availableServings} servings left` : "Sold out"}
                      </span>
                      <span className="capitalize text-ink/55">{item.temperature}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!item.isAvailable}
                    onClick={() => {
                      addItem({
                        menuItemId: item.id,
                        name: item.name,
                        qty: 1,
                        unitPricePaise: item.pricePaise,
                        selectedModifierIds: [],
                        modifierNames: [],
                      });
                      setDrawerOpen(true);
                    }}
                    className="mt-3 w-full rounded-full bg-espresso py-2 text-xs font-semibold text-porcelain transition hover:bg-roast disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/50"
                  >
                    {item.isAvailable ? "Add to Tray" : "Unavailable"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4 lg:col-span-4">
            <h2 className="font-display text-2xl font-semibold">Your Living Space</h2>
            <Link href="/app/room" className="ceramic-card block rounded-2xl p-5 transition hover:border-caramel">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sage/20 text-espresso">
                  <Armchair className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-semibold">Interactive Floorplan</h3>
                  <p className="text-xs text-ink/65">
                    {overview ? `${overview.freeSeatsCount} of ${overview.totalTablesCount} tables open` : "12 seats across 4 zones"} · Quiet & outlets
                  </p>
                </div>
              </div>
            </Link>

            <Link href="/app/people" className="ceramic-card block rounded-2xl p-5 transition hover:border-caramel">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-caramel/20 text-espresso">
                  <Users className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-semibold">Opt-In Connect</h3>
                  <p className="text-xs text-ink/65">Join AI sprints, reading hours & tastings. Zero tracking, host-approved privacy.</p>
                </div>
              </div>
            </Link>

            <div className="rounded-2xl border border-caramel/30 bg-espresso p-5 text-porcelain">
              <div className="flex items-center gap-2 text-caramel-light">
                <Zap className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Dual-Perspective Demo</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-oat/80">
                Place an order here and open the Manager Command Center in a second tab to watch ingredient stock reserve and consume live.
              </p>
              <Link href="/staff" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-caramel-light underline">
                Open Staff Command Center →
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
