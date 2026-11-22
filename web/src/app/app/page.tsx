"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Armchair,
  CheckCircle2,
  Clock,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { apiRequest, ApiError, formatRupees, subscribeCafeEvents } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useCart } from "@/lib/cart-context";
import { getDrinkPhoto } from "@/lib/coffee-media";
import { CafeOverview, MenuItem, Order, VisitPlanResponse } from "@/lib/types";

const INTENTS = [
  {
    id: "focus",
    label: "Focus",
    sub: "Quiet desk & outlet",
    prompt: "I have a meeting; need a quiet corner with an outlet and an oat-milk coffee under ₹250 ready within 10 min.",
  },
  {
    id: "grab_and_go",
    label: "Grab & Go",
    sub: "Fastest pickup",
    prompt: "I want something cold, not too sweet, under ₹250, and I have 15 minutes.",
  },
  {
    id: "catch_up",
    label: "Catch Up",
    sub: "Social table",
    prompt: "Meeting friends to catch up, need a social table and cold brew under ₹220.",
  },
  {
    id: "explore",
    label: "Explore",
    sub: "Single-origin craft",
    prompt: "Recommend a dairy-free signature drink under ₹240.",
  },
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
    const activeToken = token;
    if (!activeToken) {
      try {
        await loginDemoPersona("customer-1");
        setError(
          "Signed in as Ananya (Demo Customer). Click 'Ask AURA' once more to generate your verified confirmation token."
        );
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
          approvalToken: previewToken(plan),
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
    <div className="min-h-screen overflow-x-hidden bg-cream text-espresso">
      <Navbar variant="app" />

      <main className="mx-auto max-w-[1440px] space-y-10 overflow-x-hidden px-4 py-8 sm:px-6 lg:px-8">
        {/* Manager Approved Stock-Aware Highlight */}
        {overview?.promoBanner && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-caramel/35 bg-espresso px-5 py-3 text-sm text-cream">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-caramel-light" />
              <span>
                <strong className="text-milk">Roaster’s Feature (In Stock):</strong> {overview.promoBanner}
              </span>
            </div>
            <Link href="/app/menu" className="text-xs font-semibold text-caramel-light underline underline-offset-4">
              Browse Menu
            </Link>
          </div>
        )}

        {/* Editorial Greeting & Live Café Status */}
        <section className="grid items-end gap-6 border-b border-espresso/10 pb-8 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-roast/75">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sage/20 px-3 py-1 text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> Live Stock-Backed Café
              </span>
              {overview && overview.scenario !== "calm" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-coral/15 px-3 py-1 text-coral">
                  Simulation: {overview.scenario.replace("_", " ").toUpperCase()}
                </span>
              )}
            </div>
            <h1 className="font-display mt-3 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
              {user ? `Good to see you, ${user.displayName.split(" ")[0]}.` : "Welcome to AURA."}{" "}
              <span className="block italic font-normal text-roast">What brings you in today?</span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-roast/80">
              Every drink suggestion and table hold is verified in real time against café ingredients, barista capacity, and open seats.
            </p>
          </div>

          {/* Crisp Hairline Live Pulse */}
          <div className="ceramic-card grid grid-cols-3 divide-x divide-espresso/10 rounded-2xl p-4 lg:col-span-4">
            <div className="px-3 text-center">
              <p className="text-[11px] uppercase tracking-wider text-roast/65">Est. Wait</p>
              <p className="font-mono-num mt-1 text-2xl font-bold text-espresso">
                {overview ? `${overview.etaEstimate.minMinutes}–${overview.etaEstimate.maxMinutes}m` : "—"}
              </p>
              <p className="text-[10px] text-roast/60">Barista Queue</p>
            </div>
            <div className="px-3 text-center">
              <p className="text-[11px] uppercase tracking-wider text-roast/65">Open Seats</p>
              <p className="font-mono-num mt-1 text-2xl font-bold text-success">
                {overview ? `${overview.freeSeatsCount}/${overview.totalTablesCount}` : "—"}
              </p>
              <p className="text-[10px] text-roast/60">Available Now</p>
            </div>
            <div className="px-3 text-center">
              <p className="text-[11px] uppercase tracking-wider text-roast/65">In Stock</p>
              <p className="font-mono-num mt-1 text-2xl font-bold text-roast">
                {overview ? `${overview.availableMenuCount}/${overview.totalMenuCount}` : "—"}
              </p>
              <p className="text-[10px] text-roast/60">Recipes Ready</p>
            </div>
          </div>
        </section>

        {/* AURA Visit Concierge */}
        <section className="ceramic-card rounded-3xl p-6 sm:p-8" aria-labelledby="concierge-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="concierge-heading" className="font-display flex items-center gap-2 text-2xl font-semibold sm:text-3xl">
                <Sparkles className="h-5 w-5 text-caramel" /> AURA Visit Concierge
              </h2>
              <p className="mt-0.5 text-xs text-roast/70">
                Share your flavor mood, budget (₹), dietary needs, time window, or quiet seating preference.
              </p>
            </div>
            {!user && (
              <button
                type="button"
                onClick={() => loginDemoPersona("customer-1")}
                className="rounded-full border border-caramel/60 bg-milk/40 px-4 py-1.5 text-xs font-semibold text-espresso transition hover:bg-milk"
              >
                Quick Sign-In as Ananya (Customer)
              </button>
            )}
          </div>

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
                    ? "border-espresso bg-espresso text-cream"
                    : "border-espresso/10 bg-cream/70 text-espresso hover:border-caramel"
                }`}
              >
                <p className="font-semibold">{it.label}</p>
                <p className={`text-xs ${selectedIntent === it.id ? "text-milk/80" : "text-roast/65"}`}>{it.sub}</p>
              </button>
            ))}
          </div>

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
              className="flex-1 rounded-2xl border border-espresso/15 bg-white px-4 py-3.5 text-sm text-espresso placeholder:text-roast/45 focus:border-caramel focus:outline-none"
            />
            <button
              type="submit"
              disabled={asking}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-espresso px-6 py-3.5 text-sm font-semibold text-cream transition hover:bg-roast disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              {asking ? "Checking Stock..." : "Ask AURA"}
            </button>
          </form>

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-coral/35 bg-coral/10 p-3.5 text-sm text-coral" role="alert">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {confirmedOrder && (
            <div className="mt-5 rounded-2xl border border-sage/45 bg-sage/15 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-6 w-6 text-success" />
                  <div>
                    <p className="font-semibold text-espresso">
                      Order Confirmed! <span className="font-mono-num text-sm text-roast">#{confirmedOrder.id}</span>
                    </p>
                    <p className="text-xs text-roast/80">
                      Ingredients atomically reserved · Estimated pickup {confirmedOrder.etaMinMinutes}–{confirmedOrder.etaMaxMinutes} min
                      {confirmedOrder.tableId ? ` · Seat ${confirmedOrder.tableId} reserved` : ""}
                    </p>
                  </div>
                </div>
                <Link
                  href={`/app/orders?id=${encodeURIComponent(confirmedOrder.id)}`}
                  className="rounded-full bg-espresso px-5 py-2 text-xs font-semibold text-cream hover:bg-roast"
                >
                  Track Live Order
                </Link>
              </div>
            </div>
          )}

          {plan && !confirmedOrder && (
            <div className="mt-6 space-y-5 rounded-2xl border border-espresso/10 bg-cream/75 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-espresso px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-milk">
                    {plan.source === "gemini" ? `AI Suggestion · ${plan.modelId}` : "Deterministic Verified Engine"}
                  </span>
                  <span className="rounded-full border border-espresso/10 bg-porcelain px-3 py-1 text-[11px] font-medium text-roast">
                    Intent: {plan.intent.replace("_", " ")}
                  </span>
                  {plan.eta && typeof plan.eta.minMinutes === "number" && (
                    <span className="font-mono-num inline-flex items-center gap-1 rounded-full border border-espresso/10 bg-porcelain px-3 py-1 text-[11px] font-semibold text-espresso">
                      <Clock className="h-3 w-3 text-caramel" /> Est. {plan.eta.minMinutes}–{plan.eta.maxMinutes} min
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-roast/65">Grounded via {plan.toolEvidence.length} live checks</span>
              </div>

              <p className="text-sm leading-relaxed text-espresso">{plan.summary}</p>

              {plan.warnings.length > 0 && (
                <div className="space-y-1">
                  {plan.warnings.map((w, idx) => (
                    <p key={idx} className="text-xs font-medium text-coral">
                      ⚠ {w}
                    </p>
                  ))}
                </div>
              )}

              {(plan.recommendations.length > 0 || plan.alternativeSuggestions.length > 0) && (
                <div className="grid gap-4 md:grid-cols-3">
                  {(plan.recommendations.length > 0 ? plan.recommendations : plan.alternativeSuggestions).map((rec) => {
                    const photo = getDrinkPhoto({ id: rec.menuItemId, category: rec.category, name: rec.name });
                    return (
                      <div key={rec.menuItemId} className="ceramic-card flex flex-col justify-between overflow-hidden rounded-2xl">
                        <div>
                          <div className="aspect-[4/3] overflow-hidden bg-espresso">
                            <img src={photo.src} alt={photo.alt} className="h-full w-full object-cover" />
                          </div>
                          <div className="p-4">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="font-display text-xl font-semibold text-espresso">{rec.name}</h3>
                              <span className="font-mono-num text-sm font-bold text-roast">
                                {formatRupees(rec.pricePaise)}
                              </span>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-roast/75">{rec.why}</p>
                            <div className="mt-2.5 flex flex-wrap gap-1">
                              {rec.dietaryTags.slice(0, 3).map((t) => (
                                <span key={t} className="rounded-full bg-sage/20 px-2 py-0.5 text-[10px] font-medium text-espresso">
                                  {t}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="px-4 pb-4">
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
                            className="w-full rounded-full border border-espresso py-2 text-xs font-semibold text-espresso transition hover:bg-espresso hover:text-cream"
                          >
                            Add to Tray
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {(plan.seat || plan.approvalPreview || plan.proposedCart.length > 0) && (
                <div className="flex flex-col justify-between gap-4 rounded-2xl border border-caramel/35 bg-porcelain p-4 sm:flex-row sm:items-center">
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-1.5 font-semibold text-espresso">
                      <ShieldCheck className="h-4 w-4 text-success" />
                      Explicit Confirmation Required (No Auto-Ordering)
                    </div>
                    {plan.approvalPreview && (
                      <p className="text-xs text-roast/80">
                        {plan.approvalPreview.items.map((i) => `${i.qty}× ${i.name}`).join(", ")} · Verified Total{" "}
                        <strong className="font-mono-num">{formatRupees(plan.approvalPreview.totalPaise)}</strong>
                      </p>
                    )}
                    {plan.seat && (
                      <p className="text-xs text-success">
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
                        className="rounded-full bg-caramel px-5 py-2.5 text-xs font-bold text-espresso transition hover:bg-caramel-light disabled:opacity-50"
                      >
                        {confirming ? "Reserving Stock..." : "Confirm Order & Reserve Stock"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => loginDemoPersona("customer-1")}
                        className="rounded-full bg-espresso px-5 py-2.5 text-xs font-semibold text-cream hover:bg-roast"
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

        {/* Featured Craft Drinks + Café Space */}
        <section className="grid gap-8 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-8">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-3xl font-semibold text-espresso">Freshly Grounded in Live Stock</h2>
              <Link href="/app/menu" className="text-sm font-semibold text-roast underline-offset-4 hover:text-caramel hover:underline">
                Explore Full Menu →
              </Link>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {featuredMenu.map((item) => {
                const photo = getDrinkPhoto(item);
                return (
                  <article key={item.id} className="ceramic-card group flex flex-col justify-between overflow-hidden rounded-2xl">
                    <div>
                      <div className="aspect-[4/3] overflow-hidden bg-espresso">
                        <img
                          src={photo.src}
                          alt={photo.alt}
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                        />
                      </div>
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-display text-xl font-semibold leading-snug text-espresso">{item.name}</h3>
                          <span className="font-mono-num text-sm font-bold text-roast">{formatRupees(item.pricePaise)}</span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-roast/75">{item.description}</p>
                        <div className="mt-3 flex items-center justify-between text-[11px]">
                          <span
                            className={`rounded-full px-2.5 py-0.5 font-semibold ${
                              !item.isAvailable
                                ? "bg-coral/15 text-coral"
                                : item.availableServings <= 8
                                ? "bg-caramel/20 text-roast"
                                : "bg-sage/20 text-success"
                            }`}
                          >
                            {item.isAvailable ? `${item.availableServings} servings left` : "Sold out"}
                          </span>
                          <span className="capitalize text-roast/60">{item.temperature}</span>
                        </div>
                      </div>
                    </div>
                    <div className="px-4 pb-4">
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
                        className="w-full rounded-full bg-espresso py-2 text-xs font-semibold text-cream transition hover:bg-roast disabled:cursor-not-allowed disabled:bg-espresso/20 disabled:text-roast/50"
                      >
                        {item.isAvailable ? "Add to Tray" : "Unavailable"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="space-y-4 lg:col-span-4">
            <h2 className="font-display text-3xl font-semibold text-espresso">Your Living Space</h2>
            <Link
              href="/app/room"
              className="ceramic-card group block overflow-hidden rounded-2xl transition hover:border-caramel/60"
            >
              <div className="aspect-[16/9] overflow-hidden bg-espresso">
                <img
                  src="/images/cafe-interior.webp"
                  alt="Sunlit AURA café room with dark walnut tables and bentwood chairs"
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                />
              </div>
              <div className="flex items-center gap-3 p-5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sage/20 text-espresso">
                  <Armchair className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-semibold text-espresso">Interactive Floorplan</h3>
                  <p className="text-xs text-roast/70">
                    {overview ? `${overview.freeSeatsCount} of ${overview.totalTablesCount} tables open` : "12 seats across 4 zones"} · Quiet & outlets
                  </p>
                </div>
              </div>
            </Link>

            <Link
              href="/app/people"
              className="ceramic-card block rounded-2xl p-5 transition hover:border-caramel/60"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-milk text-espresso">
                  <Users className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-semibold text-espresso">Opt-In Connect</h3>
                  <p className="text-xs text-roast/70">
                    Join tasting flights, reading hours & creative sprints. Host-approved privacy.
                  </p>
                </div>
              </div>
            </Link>

            <div className="rounded-2xl border border-espresso/15 bg-espresso p-5 text-cream">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-caramel-light">Dual-Perspective Café</p>
              <p className="mt-2 text-xs leading-relaxed text-milk/80">
                Place an order here and open the Manager Command Center to observe atomic ingredient reservations and consumption live.
              </p>
              <Link
                href="/staff"
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-cream underline decoration-caramel underline-offset-4"
              >
                Open Staff Command Center →
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function previewToken(plan: VisitPlanResponse): string {
  return plan.approvalPreview?.approvalToken ?? "";
}
