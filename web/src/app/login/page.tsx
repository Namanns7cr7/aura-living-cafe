"use client";

import React, { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Coffee, KeyRound, ShieldCheck, Sparkles, User, Wrench } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/lib/auth-context";

const CUSTOMER_PERSONAS = [
  {
    key: "customer-1" as const,
    name: "Ananya",
    role: "Customer",
    desc: "Explore menu, chat with AURA concierge, book quiet seats, confirm orders, join opt-in meetups.",
    dest: "/app",
    icon: User,
    badge: "Public Demo Customer",
  },
  {
    key: "customer-2" as const,
    name: "Rohan",
    role: "Customer & Meetup Host",
    desc: "Second customer identity for testing concurrent stock races, order isolation, and Connect host approvals.",
    dest: "/app",
    icon: Sparkles,
    badge: "Public Demo Customer",
  },
];

const STAFF_PERSONAS = [
  {
    key: "barista-1" as const,
    name: "Kabir",
    role: "Barista",
    desc: "Live order queue, mark Preparing → Ready (consumes stock once) → Collected. Cannot adjust stock.",
    dest: "/staff/orders",
    icon: Coffee,
    badge: "Staff Passcode Required",
  },
  {
    key: "manager-1" as const,
    name: "Meera",
    role: "Café Manager",
    desc: "Full Inventory Command Center: audited restocks, menu pauses, AI ops approvals, Rush/Low-Stock simulation & reset.",
    dest: "/staff",
    icon: ShieldCheck,
    badge: "Manager Passcode Required",
  },
];

function LoginContent() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get("next");
  const { user, loginDemoPersona, logout } = useAuth();
  const [staffPasscode, setStaffPasscode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (personaKey: "customer-1" | "customer-2" | "barista-1" | "manager-1", dest: string, needsPasscode: boolean) => {
    if (needsPasscode && !staffPasscode.trim()) {
      setError("Enter the café staff passcode below before signing into a barista or manager account.");
      return;
    }
    setBusy(personaKey);
    setError(null);
    try {
      await loginDemoPersona(personaKey, needsPasscode ? staffPasscode.trim() : undefined);
      router.push(nextPath || dest);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-oat text-ink">
      <Navbar variant="app" />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="mb-8 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-caramel/40 bg-caramel/10 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-roast">
            <Wrench className="h-3.5 w-3.5" /> Isolated Demo Identity · demo-cafe
          </span>
          <h1 className="font-display mt-3 text-4xl font-semibold sm:text-5xl">Choose Your Perspective</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-ink/70">
            Customer demo accounts are open to try immediately. Barista and Manager accounts are server-gated with a staff passcode (or Firebase café-scoped custom claims).
          </p>
        </div>

        {user && (
          <div className="ceramic-card mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
            <div className="text-sm">
              Currently signed in as <strong>{user.displayName}</strong>{" "}
              <span className="rounded-full bg-caramel/20 px-2 py-0.5 text-xs font-semibold uppercase text-roast">{user.role}</span>
            </div>
            <div className="flex gap-2">
              <Link href={user.role === "customer" ? "/app" : "/staff"} className="rounded-full bg-espresso px-4 py-1.5 text-xs font-semibold text-porcelain">
                Continue
              </Link>
              <button type="button" onClick={logout} className="rounded-full border border-ink/20 px-4 py-1.5 text-xs font-medium hover:bg-oat">
                Sign out
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-xl border border-coral/40 bg-coral/10 p-4 text-sm text-coral" role="alert">
            {error}
          </div>
        )}

        <section className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-ink/60">Customer Perspectives (Public Demo)</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {CUSTOMER_PERSONAS.map((p) => {
              const Icon = p.icon;
              return (
                <button
                  key={p.key}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => handleSelect(p.key, p.dest, false)}
                  className="ceramic-card group flex flex-col justify-between rounded-2xl p-6 text-left transition hover:-translate-y-0.5 hover:border-caramel/60 disabled:opacity-60"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-espresso text-caramel-light">
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="rounded-full bg-sage/20 px-3 py-1 text-[11px] font-semibold text-espresso">
                        {p.badge}
                      </span>
                    </div>
                    <h3 className="font-display mt-4 text-2xl font-semibold text-ink">
                      {p.name} <span className="text-base font-normal text-ink/60">· {p.role}</span>
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-ink/70">{p.desc}</p>
                  </div>
                  <div className="mt-5 flex items-center gap-1.5 text-sm font-semibold text-roast group-hover:text-caramel">
                    {busy === p.key ? "Signing in..." : `Enter as ${p.name}`}
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-ink/60">Staff & Manager Perspectives (Passcode Gated)</h2>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-caramel" />
              <label htmlFor="staff-passcode" className="sr-only">Staff passcode</label>
              <input
                id="staff-passcode"
                type="password"
                value={staffPasscode}
                onChange={(e) => setStaffPasscode(e.target.value)}
                placeholder="Enter staff passcode..."
                className="rounded-full border border-ink/20 bg-white px-4 py-1.5 text-sm focus:border-caramel focus:outline-none"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {STAFF_PERSONAS.map((p) => {
              const Icon = p.icon;
              return (
                <button
                  key={p.key}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => handleSelect(p.key, p.dest, true)}
                  className="ceramic-card group flex flex-col justify-between rounded-2xl p-6 text-left transition hover:-translate-y-0.5 hover:border-caramel/60 disabled:opacity-60"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-roast text-caramel-light">
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="rounded-full bg-caramel/20 px-3 py-1 text-[11px] font-semibold text-roast">
                        {p.badge}
                      </span>
                    </div>
                    <h3 className="font-display mt-4 text-2xl font-semibold text-ink">
                      {p.name} <span className="text-base font-normal text-ink/60">· {p.role}</span>
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-ink/70">{p.desc}</p>
                  </div>
                  <div className="mt-5 flex items-center gap-1.5 text-sm font-semibold text-roast group-hover:text-caramel">
                    {busy === p.key ? "Verifying passcode..." : `Enter as ${p.name}`}
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-oat p-10 text-center text-sm text-ink/60">Loading sign-in...</div>}>
      <LoginContent />
    </Suspense>
  );
}
