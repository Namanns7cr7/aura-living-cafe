"use client";

import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, Armchair, CheckCircle2, Coffee, Cpu, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { EspressoFallbackVisual } from "@/components/hero/EspressoFallbackVisual";
import { apiRequest, subscribeCafeEvents } from "@/lib/api";
import { CafeOverview, TableItem } from "@/lib/types";

// Lazy-load R3F/Three.js scene strictly after first paint so CTAs and text never block!
const LivingEspressoScene = lazy(() =>
  import("@/components/hero/LivingEspressoScene").then((m) => ({ default: m.LivingEspressoScene }))
);

const INTENT_CARDS = [
  { id: "focus", title: "Focus", desc: "Quiet corners, power outlets, sustained calm pours." },
  { id: "catch_up", title: "Catch Up", desc: "Social tables & shared craft coffee flights." },
  { id: "explore", title: "Explore", desc: "Single-origin Indian pour-overs & seasonal infusions." },
  { id: "grab_and_go", title: "Grab & Go", desc: "Fast-prep cold brews & honest queue ETAs." },
];

export default function HomePage() {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [mount3D, setMount3D] = useState(false);
  const [overview, setOverview] = useState<CafeOverview | null>(null);
  const [tables, setTables] = useState<TableItem[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string>("Q2");

  const loadLiveCafe = useCallback(async () => {
    try {
      const [ov, tblRes] = await Promise.all([
        apiRequest<CafeOverview>("/api/v1/public/overview"),
        apiRequest<{ tables: TableItem[] }>("/api/v1/public/tables"),
      ]);
      setOverview(ov);
      setTables(tblRes.tables);
    } catch {
      // Static fallback data renders gracefully even if backend is waking up
    }
  }, []);

  useEffect(() => {
    loadLiveCafe();
    const unsub = subscribeCafeEvents(() => loadLiveCafe());

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onMq = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onMq);

    // Defer 3D canvas mount by one animation frame so static hero text paints first (fast LCP!)
    const raf = requestAnimationFrame(() => setMount3D(true));

    const onScroll = () => {
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      setScrollProgress(Math.min(1, Math.max(0, window.scrollY / maxScroll)));
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      unsub();
      mq.removeEventListener("change", onMq);
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [loadLiveCafe]);

  const inspectedTable = tables.find((t) => t.id === selectedTableId) || tables[0] || null;

  return (
    <div className="relative min-h-screen bg-espresso text-porcelain">
      {/* Skip link for instant non-blocking access */}
      <a
        href="#scene-perspectives"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-caramel focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-espresso"
      >
        Skip visual journey to café entry
      </a>

      <Navbar variant="public" />

      {/* Sticky Full-Viewport 3D Living Espresso Canvas */}
      <div className="pointer-events-none fixed inset-0 top-16 z-0" aria-hidden="true">
        {mount3D ? (
          <Suspense fallback={<EspressoFallbackVisual scrollProgress={scrollProgress} overview={overview} tables={tables} />}>
            <LivingEspressoScene
              scrollProgress={scrollProgress}
              overview={overview}
              tables={tables}
              reducedMotion={reducedMotion}
            />
          </Suspense>
        ) : (
          <EspressoFallbackVisual scrollProgress={scrollProgress} overview={overview} tables={tables} />
        )}
        {/* Subtle readability vignette */}
        <div className="absolute inset-0 bg-gradient-to-b from-espresso/50 via-transparent to-espresso/85" />
      </div>

      {/* 5-Scene Scroll Narrative Overlay */}
      <main className="relative z-10">
        {/* SCENE 1 — THE FIRST DROP (0-20%) */}
        <section
          id="scene-drop"
          className="mx-auto flex min-h-[88vh] max-w-[1440px] flex-col justify-center px-4 py-16 sm:px-6 lg:px-8"
        >
          <div className="max-w-2xl space-y-6">
            <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-caramel/35 bg-espresso/75 px-4 py-1.5 text-xs font-medium text-caramel-light backdrop-blur-md">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Google Cloud · Firestore Transactions · Gemini ADK</span>
              {overview && (
                <span className="font-mono-num ml-1 border-l border-caramel/30 pl-2 text-oat">
                  {overview.freeSeatsCount} seats free · {overview.etaEstimate.minMinutes}–{overview.etaEstimate.maxMinutes}m wait
                </span>
              )}
            </div>

            <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight text-porcelain sm:text-7xl">
              AURA
              <span className="mt-2 block text-3xl font-normal text-caramel-light sm:text-5xl">
                The café that thinks with you.
              </span>
            </h1>

            <p className="max-w-xl text-base leading-relaxed text-oat/85 sm:text-lg">
              A café that understands <em>why</em> you came, not just what you ordered—connecting human intention directly to live ingredient stock and barista capacity.
            </p>

            {/* Instant, never-blocked primary CTAs */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                href="/app"
                className="inline-flex items-center gap-2 rounded-full bg-caramel px-7 py-3.5 text-sm font-bold text-espresso shadow-glow transition hover:bg-caramel-light"
              >
                Enter the Café
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#scene-ripple"
                className="inline-flex items-center gap-2 rounded-full border border-oat/30 bg-espresso/60 px-6 py-3.5 text-sm font-semibold text-porcelain backdrop-blur-md transition hover:border-caramel hover:text-caramel-light"
              >
                Explore the Experience
                <ArrowDown className="h-4 w-4" />
              </a>
              <Link
                href="/staff"
                className="rounded-full px-4 py-2 text-xs font-semibold text-oat/75 underline decoration-caramel/60 underline-offset-4 hover:text-caramel-light"
              >
                Manager Console
              </Link>
            </div>
          </div>
        </section>

        {/* SCENE 2 — FROM BEAN TO EXPERIENCE / THE RIPPLE (20-40%) */}
        <section id="scene-ripple" className="mx-auto flex min-h-[82vh] max-w-[1440px] items-center px-4 py-20 sm:px-6 lg:px-8">
          <div className="espresso-glass ml-auto max-w-2xl rounded-3xl p-7 sm:p-10">
            <p className="font-mono-num text-xs font-semibold uppercase tracking-[0.2em] text-caramel">
              02 · From Bean to Experience
            </p>
            <h2 className="font-display mt-2 text-3xl font-semibold sm:text-5xl">
              Every ripple reveals what’s truly possible right now.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-oat/80">
              Select why you’re visiting. AURA checks live oat milk milliliters, espresso roast grams, open power-outlet corners, and current prep load before suggesting a single cup.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {INTENT_CARDS.map((card) => (
                <Link
                  key={card.id}
                  href={`/app?intent=${card.id}`}
                  className="group rounded-2xl border border-caramel/25 bg-espresso/65 p-4 transition hover:border-caramel hover:bg-roast/90"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-porcelain">{card.title}</h3>
                    <ArrowRight className="h-4 w-4 text-caramel transition group-hover:translate-x-0.5" />
                  </div>
                  <p className="mt-1 text-xs text-oat/70">{card.desc}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* SCENE 3 — THE LIVING CAFÉ (40-65%) */}
        <section id="scene-cafe" className="mx-auto flex min-h-[82vh] max-w-[1440px] items-center px-4 py-20 sm:px-6 lg:px-8">
          <div className="espresso-glass max-w-2xl rounded-3xl p-7 sm:p-10">
            <p className="font-mono-num text-xs font-semibold uppercase tracking-[0.2em] text-sage">
              03 · The Living Room
            </p>
            <h2 className="font-display mt-2 text-3xl font-semibold sm:text-5xl">
              Twelve tables, four acoustic zones, zero guesswork.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-oat/80">
              The 3D café behind this card maps directly to real Firestore/demo table states. Tap a table below to inspect quietness, outlets, and live availability.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {(tables.length > 0 ? tables.slice(0, 8) : []).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTableId(t.id)}
                  className={`font-mono-num rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    selectedTableId === t.id
                      ? "border-caramel bg-caramel text-espresso"
                      : t.status === "free"
                      ? "border-sage/50 bg-sage/15 text-oat hover:border-sage"
                      : "border-oat/20 bg-espresso/70 text-oat/60"
                  }`}
                >
                  {t.id} · {t.status}
                </button>
              ))}
            </div>

            {inspectedTable && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-caramel/25 bg-espresso/80 p-4 text-xs">
                <div>
                  <p className="text-sm font-semibold text-porcelain">
                    {inspectedTable.label} ({inspectedTable.zone} zone)
                  </p>
                  <p className="mt-0.5 text-oat/75">
                    {inspectedTable.seats} seats · {inspectedTable.hasOutlet ? "Power outlet" : "No outlet"} · ~{inspectedTable.ambientNoiseDb} dB (simulated)
                  </p>
                </div>
                <Link href="/app/room" className="rounded-full bg-sage px-4 py-1.5 font-semibold text-espresso">
                  Open Floorplan
                </Link>
              </div>
            )}
          </div>
        </section>

        {/* SCENE 4 — THE INTELLIGENCE FLOW (65-85%) */}
        <section id="scene-flow" className="mx-auto flex min-h-[82vh] max-w-[1440px] items-center px-4 py-20 sm:px-6 lg:px-8">
          <div className="espresso-glass ml-auto max-w-3xl rounded-3xl p-7 sm:p-10">
            <p className="font-mono-num text-xs font-semibold uppercase tracking-[0.2em] text-caramel">
              04 · The Intelligence Flow
            </p>
            <h2 className="font-display mt-2 text-3xl font-semibold sm:text-5xl">
              From a customer’s sentence to exact milliliters reserved.
            </h2>

            {/* Concrete 5-step connected pipeline */}
            <ol className="mt-5 grid gap-2 text-xs sm:grid-cols-5">
              {[
                "1. Guest Intent",
                "2. Grounded Tools",
                "3. Human Confirm",
                "4. Atomic Reserve",
                "5. Consume on Ready",
              ].map((step) => (
                <li key={step} className="rounded-xl border border-caramel/30 bg-espresso/80 p-2.5 text-center font-semibold text-caramel-light">
                  {step}
                </li>
              ))}
            </ol>

            {/* Live Ingredient Node Health Bars */}
            {overview && (
              <div className="mt-6 space-y-2.5">
                <div className="flex items-center justify-between text-xs text-oat/75">
                  <span>Live Key Ingredient Flow Nodes</span>
                  <span className="font-mono-num uppercase text-caramel-light">
                    Mode: {overview.scenario} · ETA {overview.etaEstimate.minMinutes}–{overview.etaEstimate.maxMinutes}m
                  </span>
                </div>
                {overview.ingredientFlowNodes.map((node) => (
                  <div key={node.id} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-porcelain">{node.label}</span>
                      <span className="font-mono-num text-oat/80">
                        ~{node.servingsEstimate} servings · <span className="uppercase">{node.status}</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-roast">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          node.status === "out" ? "bg-coral" : node.status === "low" ? "bg-caramel" : "bg-sage"
                        }`}
                        style={{ width: `${Math.max(6, Math.round(node.healthRatio * 100))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* SCENE 5 — ONE CAFÉ, TWO PERSPECTIVES (85-100%) */}
        <section id="scene-perspectives" className="mx-auto max-w-[1440px] px-4 py-24 sm:px-6 lg:px-8">
          <div className="espresso-glass rounded-3xl p-8 sm:p-12">
            <div className="max-w-2xl">
              <p className="font-mono-num text-xs font-semibold uppercase tracking-[0.2em] text-caramel">
                05 · Enter AURA
              </p>
              <h2 className="font-display mt-2 text-4xl font-semibold sm:text-5xl">
                One café. Two perspectives. Grounded in live reality.
              </h2>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <div className="flex flex-col justify-between rounded-2xl border border-caramel/35 bg-espresso/85 p-6">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-caramel/20 px-3 py-1 text-xs font-semibold text-caramel-light">
                    <Coffee className="h-3.5 w-3.5" /> People Intelligence
                  </span>
                  <h3 className="font-display mt-3 text-3xl font-semibold">Customer Experience</h3>
                  <ul className="mt-3 space-y-2 text-sm text-oat/80">
                    <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-sage" /> Stock-verified Gemini Concierge & Menu</li>
                    <li className="flex items-center gap-2"><Armchair className="h-4 w-4 text-sage" /> Interactive 12-table seat map & atomic reservations</li>
                    <li className="flex items-center gap-2"><Users className="h-4 w-4 text-sage" /> Opt-in Connect meetups with host-approved privacy</li>
                  </ul>
                </div>
                <Link
                  href="/app"
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-caramel px-6 py-3 text-sm font-bold text-espresso hover:bg-caramel-light"
                >
                  Open Customer Experience <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="flex flex-col justify-between rounded-2xl border border-sage/35 bg-espresso/85 p-6">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-sage/20 px-3 py-1 text-xs font-semibold text-sage">
                    <Cpu className="h-3.5 w-3.5" /> Inventory Intelligence
                  </span>
                  <h3 className="font-display mt-3 text-3xl font-semibold">Café Command Center</h3>
                  <ul className="mt-3 space-y-2 text-sm text-oat/80">
                    <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-caramel" /> Live barista order queue & single-consumption on Ready</li>
                    <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-caramel" /> 26-ingredient base-unit ledger & audited restocks</li>
                    <li className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-caramel" /> Approval-only AI Ops insights & Rush/Low-Stock simulation</li>
                  </ul>
                </div>
                <Link
                  href="/staff"
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-full border border-caramel px-6 py-3 text-sm font-bold text-caramel-light hover:bg-caramel/15"
                >
                  Open Café Command Center <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            {/* Privacy & AI Transparency Footer */}
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-oat/15 pt-5 text-xs text-oat/65">
              <span>
                <strong>AI Transparency:</strong> Gemini interprets intent and explains grounded tool results. Deterministic backend transactions control all prices, stock, and reservations.
              </span>
              <span>No payments · No emotion inference · Opt-in community only</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
