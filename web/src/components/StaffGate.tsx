"use client";

import React from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/lib/auth-context";

export function StaffGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-oat text-ink">
        <Navbar variant="staff" />
        <div className="mx-auto max-w-2xl p-12 text-center text-sm text-ink/60">Verifying staff permissions...</div>
      </div>
    );
  }

  if (!user || (user.role !== "barista" && user.role !== "manager")) {
    return (
      <div className="min-h-screen bg-oat text-ink">
        <Navbar variant="staff" />
        <main className="mx-auto max-w-xl px-4 py-16 text-center">
          <div className="ceramic-card rounded-3xl p-8">
            <ShieldAlert className="mx-auto h-10 w-10 text-coral" />
            <p className="font-mono-num mt-3 text-xs font-bold uppercase tracking-widest text-coral">403 · Staff Authorization Required</p>
            <h1 className="font-display mt-2 text-3xl font-semibold">Café Command Center is Restricted</h1>
            <p className="mt-2 text-sm text-ink/70">
              {user
                ? `You are signed in as ${user.displayName} (${user.role}). Barista or Manager authorization is required to inspect stock ledgers or update order tickets.`
                : "Please sign in with a verified Barista or Manager account to access operations controls."}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/login?next=/staff" className="rounded-full bg-espresso px-6 py-2.5 text-sm font-semibold text-porcelain hover:bg-roast">
                Sign in as Staff / Manager
              </Link>
              <Link href="/app" className="rounded-full border border-ink/20 px-6 py-2.5 text-sm font-medium hover:bg-oat">
                Return to Customer View
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return <>{children}</>;
}
