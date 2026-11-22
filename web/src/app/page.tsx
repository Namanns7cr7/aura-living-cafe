"use client";

import React, { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Armchair,
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  Coffee,
  Droplets,
  Package,
  RotateCcw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { EspressoFallbackVisual } from "@/components/hero/EspressoFallbackVisual";
import { apiRequest, formatRupees, subscribeCafeEvents } from "@/lib/api";
import { getDrinkPhoto } from "@/lib/coffee-media";
import { CafeOverview, MenuItem, TableItem } from "@/lib/types";

const CoffeePhysicsCanvas = dynamic(
  () => import("@/components/hero/CoffeePhysicsCanvas").then((m) => m.CoffeePhysicsCanvas),
  { ssr: false }
);

const INTENT_CARDS = [
  { id: "focus", title: "Focus", desc: "Quiet corners, power outlets, sustained calm pours." },
  { id: "catch_up", title: "Catch Up", desc: "Social tables & shared craft coffee flights." },
  { id: "explore", title: "Explore", desc: "Single-origin Indian pour-overs & seasonal infusions." },
  { id: "grab_and_go", title: "Grab & Go", desc: "Fast-prep cold brews & honest queue ETAs." },
];

const SCENE_NAV = [
  { id: "scene-espresso", label: "01" },
  { id: "scene-experience", label: "02" },
  { id: "scene-bean-to-cup", label: "03" },
  { id: "scene-inventory", label: "04" },
  { id: "scene-living-cafe", label: "05" },
];

export default function HomePage() {
  const [activeSceneIdx, setActiveSceneIdx] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [mount3D, setMount3D] = useState(false);
  const [pourNonce, setPourNonce] = useState(0);
  const [dropNonce, setDropNonce] = useState(0);

  const [overview, setOverview] = useState<CafeOverview | null>(null);
  const [tables, setTables] = useState<TableItem[]>([]);
  const [featuredDrinks, setFeaturedDrinks] = useState<MenuItem[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string>("Q2");

  const loadLiveCafe = useCallback(async () => {
    try {
      const [ov, tblRes, menuRes] = await Promise.all([
        apiRequest<CafeOverview>("/api/v1/public/overview"),
        apiRequest<{ tables: TableItem[] }>("/api/v1/public/tables"),
        apiRequest<{ items: MenuItem[] }>("/api/v1/public/menu"),
      ]);
      setOverview(ov);
      setTables(tblRes.tables);

      // Select 4 distinct visual drinks so every card displays a unique studio photo
      const picked: MenuItem[] = [];
      const seenSrc = new Set<string>();
      for (const item of menuRes.items) {
        const photo = getDrinkPhoto(item);
        if (!seenSrc.has(photo.src)) {
          seenSrc.add(photo.src);
          picked.push(item);
        }
        if (picked.length === 4) break;
      }
      setFeaturedDrinks(picked.length > 0 ? picked : menuRes.items.slice(0, 4));
    } catch {
      // Static editorial showcase still renders cleanly when backend is waking
    }
  }, []);

  useEffect(() => {
    loadLiveCafe();
    const unsub = subscribeCafeEvents(() => loadLiveCafe());

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onMq = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onMq);

    // Mount 3D after initial poster paint so LCP and CTAs render immediately
    const raf = requestAnimationFrame(() => setMount3D(true));

    const onScroll = () => {
      const midY = window.innerHeight * 0.55;
      let nextIdx = 0;
      for (let i = 0; i < SCENE_NAV.length; i++) {
        const el = document.getElementById(SCENE_NAV[i].id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= midY) nextIdx = i;
        }
      }
      setActiveSceneIdx((prev) => (prev === nextIdx ? prev : nextIdx));
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
    <div className="relative min-h-screen bg-espresso text-cream">
      <a
        href="#scene-living-cafe"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-cream focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-espresso"
      >
        Skip visual journey to café entry
      </a>

      <Navbar variant="public" />

      {/* Full-Viewport Sticky 3D Realistic Coffee Physics Canvas */}
      <div className="pointer-events-none fixed inset-0 top-16 z-0" aria-hidden="true">
        {mount3D ? (
          <CoffeePhysicsCanvas
            overview={overview}
            tables={tables}
            reducedMotion={reducedMotion}
            pourNonce={pourNonce}
            dropNonce={dropNonce}
          />
        ) : (
          <EspressoFallbackVisual overview={overview} tables={tables} />
        )}
        {/* Subtle editorial scrim for crisp typography contrast across desktop and mobile */}
        <div
          className="pointer-events-none absolute inset-0 md:hidden"
          style={{
            background:
              "linear-gradient(180deg, rgba(22,13,9,0.72) 0%, rgba(22,13,9,0.52) 55%, rgba(22,13,9,0.76) 100%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 hidden md:block"
          style={{
            background:
              "linear-gradient(100deg, rgba(22,13,9,0.78) 0%, rgba(22,13,9,0.34) 44%, rgba(22,13,9,0.08) 78%, rgba(22,13,9,0.38) 100%)",
          }}
        />
      </div>

      {/* Subtle Physics & Scene Navigation Pill (hidden while reading 2D Inventory section) */}
      {!reducedMotion && activeSceneIdx !== 3 && (
        <div className="fixed bottom-5 right-5 z-30 hidden items-center gap-2 rounded-full border border-milk/15 bg-espresso/85 px-3 py-1.5 text-xs text-milk backdrop-blur-md md:flex">
          <button
            type="button"
            onClick={() => setPourNonce((n) => n + 1)}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition hover:bg-roast hover:text-cream"
            title="Replay espresso extraction"
          >
            <Droplets className="h-3.5 w-3.5 text-caramel" />
            Replay Pour
          </button>
          <span className="h-3.5 w-px bg-milk/15" />
          <button
            type="button"
            onClick={() => setDropNonce((n) => n + 1)}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition hover:bg-roast hover:text-cream"
            title="Drop fresh roasted coffee beans onto the table"
          >
            <RotateCcw className="h-3.5 w-3.5 text-caramel" />
            Drop Beans
          </button>
          <span className="h-3.5 w-px bg-milk/15" />
          <div className="flex items-center gap-1 pl-1">
            {SCENE_NAV.map((s, idx) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                aria-label={`Jump to scene ${s.label}`}
                className={`font-mono-num rounded-full px-2 py-0.5 text-[11px] transition ${
                  activeSceneIdx === idx ? "bg-caramel font-bold text-espresso" : "text-milk/60 hover:text-cream"
                }`}
              >
                {s.label}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 5-Scene Cinematic Scroll Narrative */}
      <main className="relative z-10">
        {/* SCENE 1 — THE PERFECT ESPRESSO */}
        <section
          id="scene-espresso"
          className="mx-auto flex min-h-[92vh] max-w-[1440px] flex-col justify-center px-5 py-16 sm:px-8 lg:px-12"
        >
          <div className="max-w-xl space-y-6">
            <div className="inline-flex flex-wrap items-center gap-3 border-b border-milk/20 pb-3 text-xs tracking-[0.18em] text-milk/85 uppercase">
              <span>Specialty Roastery · Live Café</span>
              {overview && (
                <span className="font-mono-num border-l border-milk/25 pl-3 text-caramel-light">
                  {overview.freeSeatsCount} seats open · {overview.etaEstimate.minMinutes}–{overview.etaEstimate.maxMinutes}m pour
                </span>
              )}
            </div>

            <h1 className="font-display text-6xl font-semibold leading-[0.98] tracking-tight text-cream sm:text-8xl">
              AURA
              <span className="mt-3 block text-3xl font-normal italic leading-snug text-milk sm:text-5xl">
                Every cup begins with understanding.
              </span>
            </h1>

            <p className="max-w-md text-base leading-relaxed text-milk/85 sm:text-lg">
              Craft espresso, thoughtful seating, and live ingredient intelligence—woven together without guesswork.
            </p>

            <div className="flex flex-wrap items-center gap-3.5 pt-2">
              <Link
                href="/app"
                className="inline-flex items-center gap-2.5 rounded-full bg-cream px-7 py-3.5 text-sm font-semibold text-espresso shadow-elevated transition hover:bg-milk"
              >
                Enter Your Café
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#scene-experience"
                className="inline-flex items-center gap-2 rounded-full border border-milk/30 bg-espresso/55 px-6 py-3.5 text-sm font-medium text-cream backdrop-blur-sm transition hover:border-caramel hover:text-milk"
              >
                Explore the Craft
                <ArrowDown className="h-4 w-4" />
              </a>
              <Link
                href="/staff"
                className="px-2 py-2 text-xs font-medium text-milk/75 underline decoration-caramel/60 underline-offset-4 transition hover:text-cream"
              >
                Manager Console
              </Link>
            </div>
          </div>
        </section>

        {/* SCENE 2 — THE HUMAN EXPERIENCE */}
        <section
          id="scene-experience"
          className="mx-auto flex min-h-[92vh] max-w-[1440px] items-center px-5 py-20 sm:px-8 lg:px-12"
        >
          <div className="editorial-dark-panel ml-auto max-w-2xl rounded-3xl p-7 sm:p-10">
            <p className="font-mono-num text-xs font-semibold uppercase tracking-[0.22em] text-caramel-light">
              02 · The Human Experience
            </p>
            <h2 className="font-display mt-2 text-4xl font-semibold leading-tight text-cream sm:text-5xl">
              More than coffee. <span className="italic font-normal text-milk">Your kind of moment.</span>
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-milk/80">
              AURA tailors each cup and corner to your taste preferences, time window, and budget—checking live barista queue capacity and quiet acoustics before suggesting a seat.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {INTENT_CARDS.map((card) => (
                <Link
                  key={card.id}
                  href={`/app?intent=${card.id}`}
                  className="group rounded-2xl border border-milk/15 bg-roast/55 p-4 transition hover:border-caramel/65 hover:bg-roast/90"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-xl font-semibold text-cream">{card.title}</h3>
                    <ArrowRight className="h-4 w-4 text-caramel transition group-hover:translate-x-0.5" />
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-milk/70">{card.desc}</p>
                </Link>
              ))}
            </div>

            {tables.length > 0 && (
              <div className="mt-6 border-t border-milk/15 pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-milk/75">
                  <span>Live Café Seating ({tables.filter((t) => t.status === "free").length} open)</span>
                  <Link href="/app/room" className="font-semibold text-caramel-light underline underline-offset-4">
                    Open Floorplan →
                  </Link>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {tables.slice(0, 6).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTableId(t.id)}
                      className={`font-mono-num rounded-full border px-3 py-1 text-xs transition ${
                        selectedTableId === t.id
                          ? "border-cream bg-cream font-semibold text-espresso"
                          : t.status === "free"
                          ? "border-sage/50 bg-sage/15 text-cream hover:border-sage"
                          : "border-milk/20 bg-espresso/60 text-milk/60"
                      }`}
                    >
                      {t.id} · {t.status}
                    </button>
                  ))}
                </div>
                {inspectedTable && (
                  <p className="mt-2.5 text-xs text-milk/80">
                    <strong className="text-cream">{inspectedTable.label}</strong> ({inspectedTable.zone} zone) ·{" "}
                    {inspectedTable.seats} seats · {inspectedTable.hasOutlet ? "Power outlet" : "No outlet"} · ~
                    {inspectedTable.ambientNoiseDb} dB
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* SCENE 3 — FROM BEAN TO CUP */}
        <section
          id="scene-bean-to-cup"
          className="mx-auto flex min-h-[94vh] max-w-[1440px] items-center px-5 py-24 sm:px-8 lg:px-12"
        >
          <div className="editorial-dark-panel max-w-2xl overflow-hidden rounded-3xl">
            <div className="grid sm:grid-cols-12">
              <div className="sm:col-span-5">
                <img
                  src="/images/bean-to-cup.webp"
                  alt="Roasted single-origin beans, steamed oat milk pitcher, and espresso demitasse on dark walnut"
                  className="h-56 w-full object-cover sm:h-full"
                />
              </div>
              <div className="p-7 sm:col-span-7 sm:p-8">
                <p className="font-mono-num text-xs font-semibold uppercase tracking-[0.22em] text-caramel-light">
                  03 · From Bean to Cup
                </p>
                <h2 className="font-display mt-2 text-3xl font-semibold leading-tight text-cream sm:text-4xl">
                  Every ingredient tells a story.
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-milk/80">
                  Behind every velvet latte lies exact craft ratios—18g Chikmagalur roast, 180ml steamed barista oat milk—monitored continuously so we only recommend drinks we can genuinely pour.
                </p>

                <dl className="mt-5 space-y-2.5 border-t border-milk/15 pt-4 text-xs">
                  {(overview?.ingredientFlowNodes || []).slice(0, 3).map((node) => (
                    <div key={node.id} className="flex items-center justify-between">
                      <dt className="text-milk/85">{node.label}</dt>
                      <dd className="font-mono-num font-semibold text-caramel-light">
                        ~{node.servingsEstimate} pours ready
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </section>

        {/* SCENE 4 — INTELLIGENT INVENTORY (Clean High-Contrast 2D Editorial Surface) */}
        <section id="scene-inventory" className="relative bg-cream py-20 text-espresso sm:py-24">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-espresso/10 pb-8">
              <div className="max-w-2xl">
                <p className="font-mono-num text-xs font-semibold uppercase tracking-[0.22em] text-caramel">
                  04 · Intelligent Inventory
                </p>
                <h2 className="font-display mt-2 text-4xl font-semibold leading-tight text-espresso sm:text-5xl">
                  Real kitchen stock behind every pour.
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-roast/80">
                  Confirming an order atomically reserves exact grams and milliliters. Marking an order ready consumes stock once—preventing overselling and last-minute substitutions.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/app/menu"
                  className="rounded-full bg-espresso px-5 py-2.5 text-xs font-semibold text-cream transition hover:bg-roast"
                >
                  Explore Full Menu
                </Link>
                <Link
                  href="/staff/inventory"
                  className="rounded-full border border-espresso/20 px-5 py-2.5 text-xs font-semibold text-espresso transition hover:border-caramel"
                >
                  Open Inventory Ledger
                </Link>
              </div>
            </div>

            <div className="mt-10 grid gap-8 lg:grid-cols-12">
              {/* Left: Live Ingredient Capacity & Order-Linked Workflow */}
              <div className="ceramic-card rounded-3xl p-6 sm:p-8 lg:col-span-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-display flex items-center gap-2 text-2xl font-semibold text-espresso">
                    <Package className="h-5 w-5 text-caramel" />
                    Available Ingredients
                  </h3>
                  {overview && (
                    <span className="font-mono-num rounded-full bg-cream px-3 py-1 text-[11px] font-semibold uppercase text-roast">
                      {overview.scenario} · {overview.etaEstimate.minMinutes}–{overview.etaEstimate.maxMinutes}m
                    </span>
                  )}
                </div>

                <div className="mt-5 space-y-4">
                  {(overview?.ingredientFlowNodes || [
                    { id: "espresso", label: "Chikmagalur Espresso Roast", servingsEstimate: 120, healthRatio: 0.9, status: "healthy" as const },
                    { id: "oat", label: "Barista Oat Milk", servingsEstimate: 8, healthRatio: 0.45, status: "low" as const },
                    { id: "cold_brew", label: "18h Cold Brew Concentrate", servingsEstimate: 21, healthRatio: 0.85, status: "healthy" as const },
                  ]).map((node) => (
                    <div key={node.id} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-espresso">{node.label}</span>
                        <span className="font-mono-num text-xs text-roast">
                          ~{node.servingsEstimate} servings ·{" "}
                          <strong
                            className={
                              node.status === "out"
                                ? "text-coral uppercase"
                                : node.status === "low"
                                ? "text-caramel uppercase"
                                : "text-success uppercase"
                            }
                          >
                            {node.status}
                          </strong>
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-milk/60">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            node.status === "out"
                              ? "bg-coral"
                              : node.status === "low"
                              ? "bg-caramel"
                              : "bg-sage"
                          }`}
                          style={{ width: `${Math.max(8, Math.round(node.healthRatio * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-7 border-t border-espresso/10 pt-5">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-roast/70">
                    Order-Linked Stock Consumption
                  </p>
                  <ol className="mt-3 grid grid-cols-5 gap-1.5 text-[11px]">
                    {["Intent", "Stock Check", "Confirm", "Reserve", "Consume"].map((step, i) => (
                      <li
                        key={step}
                        className="rounded-xl border border-espresso/10 bg-cream px-2 py-2 text-center font-medium text-espresso"
                      >
                        <span className="font-mono-num block text-[10px] text-caramel">0{i + 1}</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              {/* Right: Live Stock-Backed Menu Photography Grid */}
              <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
                {(featuredDrinks.length > 0
                  ? featuredDrinks
                  : [
                      {
                        id: "iced-oat-latte",
                        name: "Iced Oat Velvet Latte",
                        pricePaise: 22000,
                        availableServings: 8,
                        isAvailable: true,
                        category: "cold_coffee",
                        tastingNotes: ["toasted oat", "dark chocolate"],
                      },
                      {
                        id: "double-espresso",
                        name: "Chikmagalur Double Espresso",
                        pricePaise: 14000,
                        availableServings: 120,
                        isAvailable: true,
                        category: "espresso",
                        tastingNotes: ["dark cocoa", "plum"],
                      },
                      {
                        id: "classic-cold-brew",
                        name: "18-Hour Slow Cold Brew",
                        pricePaise: 18000,
                        availableServings: 21,
                        isAvailable: true,
                        category: "cold_coffee",
                        tastingNotes: ["cacao nib", "velvet smooth"],
                      },
                      {
                        id: "coorg-v60-pourover",
                        name: "Coorg Single-Origin V60",
                        pricePaise: 21000,
                        availableServings: 75,
                        isAvailable: true,
                        category: "signature",
                        tastingNotes: ["jasmine", "bergamot"],
                      },
                    ]
                ).map((drink) => {
                  const photo = getDrinkPhoto(drink);
                  return (
                    <Link
                      key={drink.id}
                      href="/app/menu"
                      className="ceramic-card group overflow-hidden rounded-2xl transition hover:-translate-y-0.5 hover:border-caramel/50"
                    >
                      <div className="aspect-[4/3] overflow-hidden bg-espresso">
                        <img
                          src={photo.src}
                          alt={photo.alt}
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                        />
                      </div>
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-display text-xl font-semibold text-espresso">{drink.name}</h3>
                          <span className="font-mono-num text-sm font-bold text-roast">
                            {formatRupees(drink.pricePaise)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span
                            className={`rounded-full px-2.5 py-0.5 font-medium ${
                              !drink.isAvailable
                                ? "bg-coral/15 text-coral"
                                : drink.availableServings <= 8
                                ? "bg-caramel/20 text-roast"
                                : "bg-sage/20 text-success"
                            }`}
                          >
                            {drink.isAvailable ? `${drink.availableServings} pours available` : "Sold out"}
                          </span>
                          <span className="text-roast/65">{drink.tastingNotes?.slice(0, 2).join(" · ")}</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* SCENE 5 — THE LIVING CAFÉ */}
        <section id="scene-living-cafe" className="mx-auto max-w-[1440px] px-5 py-24 sm:px-8 lg:px-12">
          <div className="editorial-dark-panel rounded-3xl p-8 sm:p-12">
            <div className="max-w-2xl">
              <p className="font-mono-num text-xs font-semibold uppercase tracking-[0.22em] text-caramel-light">
                05 · The Living Café
              </p>
              <h2 className="font-display mt-2 text-4xl font-semibold leading-tight text-cream sm:text-5xl">
                One connected café. <span className="italic font-normal text-milk">A thousand better moments.</span>
              </h2>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <div className="flex flex-col justify-between rounded-2xl border border-milk/15 bg-espresso/85 p-6 sm:p-7">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-caramel/20 px-3 py-1 text-xs font-semibold text-milk">
                    <Coffee className="h-3.5 w-3.5 text-caramel-light" /> Guest Experience
                  </span>
                  <h3 className="font-display mt-3 text-3xl font-semibold text-cream">Customer Experience</h3>
                  <ul className="mt-4 space-y-2.5 text-sm text-milk/80">
                    <li className="flex items-center gap-2.5">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-sage" /> Stock-verified Gemini Concierge & Crafted Menu
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Armchair className="h-4 w-4 shrink-0 text-sage" /> Interactive 12-table seat map & atomic reservations
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Users className="h-4 w-4 shrink-0 text-sage" /> Opt-in Connect meetups with host-approved privacy
                    </li>
                  </ul>
                </div>
                <Link
                  href="/app"
                  className="mt-7 inline-flex items-center justify-center gap-2 rounded-full bg-cream px-6 py-3 text-sm font-semibold text-espresso transition hover:bg-milk"
                >
                  Open Customer Experience <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="flex flex-col justify-between rounded-2xl border border-milk/15 bg-espresso/85 p-6 sm:p-7">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-sage/20 px-3 py-1 text-xs font-semibold text-milk">
                    <ShieldCheck className="h-3.5 w-3.5 text-sage" /> Team Operations
                  </span>
                  <h3 className="font-display mt-3 text-3xl font-semibold text-cream">Café Command Center</h3>
                  <ul className="mt-4 space-y-2.5 text-sm text-milk/80">
                    <li className="flex items-center gap-2.5">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-caramel-light" /> Live barista order queue & single-consumption on Ready
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Package className="h-4 w-4 shrink-0 text-caramel-light" /> 26-ingredient base-unit ledger & audited restocks
                    </li>
                    <li className="flex items-center gap-2.5">
                      <ShieldCheck className="h-4 w-4 shrink-0 text-caramel-light" /> Approval-only AI Ops insights & Rush/Low-Stock simulation
                    </li>
                  </ul>
                </div>
                <Link
                  href="/staff"
                  className="mt-7 inline-flex items-center justify-center gap-2 rounded-full border border-milk/30 px-6 py-3 text-sm font-semibold text-cream transition hover:border-caramel hover:bg-roast/60"
                >
                  Open Café Command Center <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-milk/15 pt-5 text-xs text-milk/65">
              <span>
                <strong className="text-milk">Transparent Intelligence:</strong> Gemini interprets intent and explains verified stock. Transactional Firestore controls all prices, ingredients, and seat holds.
              </span>
              <span>
                Opt-in community only · Client-side 3D coffee physics · 3D cup &amp; beans (CC BY 4.0): senorp3dro, kouitimizuno, mikethornley
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
