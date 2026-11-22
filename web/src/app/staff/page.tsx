"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, CheckCircle2, Clock, Flame, Package, RefreshCw, Sparkles, X } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { StaffGate } from "@/components/StaffGate";
import { apiRequest, formatRupees, subscribeCafeEvents } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { IngredientView, InventoryEvent, OperationalRecommendation, Order } from "@/lib/types";

interface DashboardPayload {
  kpis: {
    activeQueue: number;
    readyForPickup: number;
    ordersByStatus: Record<string, number>;
    totalRevenueRupees: number;
    atRiskIngredients: number;
    availableDrinks: number;
    totalDrinks: number;
    freeTables: number;
    totalTables: number;
  };
  etaEstimate: { minMinutes: number; maxMinutes: number; scenario: string; queuedWorkUnits: number };
  atRiskStrip: IngredientView[];
  demandLeaders: { menuItemId: string; name: string; unitsOrdered: number; revenueRupees: number }[];
  activeOrders: Order[];
  recentInventoryEvents: InventoryEvent[];
  pendingRecommendations: OperationalRecommendation[];
  demoState: { scenario: "calm" | "rush" | "low_stock"; promoBanner?: string | null; label: string };
  staffRole: string;
}

export default function StaffDashboardPage() {
  const { user, token } = useAuth();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest<DashboardPayload>("/api/v1/staff/dashboard", { token });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load command center.");
    }
  }, [token]);

  useEffect(() => {
    loadDashboard();
    return subscribeCafeEvents(() => loadDashboard(), { isStaff: true });
  }, [loadDashboard]);

  const advanceOrder = async (orderId: string, nextStatus: "preparing" | "ready" | "collected") => {
    if (!token) return;
    setBusy(orderId);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/v1/staff/orders/${orderId}/status`, {
        method: "PATCH",
        token,
        body: { status: nextStatus, reason: `Marked ${nextStatus} by ${user?.displayName}` },
      });
      setNotice(
        nextStatus === "ready"
          ? `Order #${orderId} marked Ready — reserved ingredients consumed once!`
          : `Order #${orderId} moved to ${nextStatus}.`
      );
      await loadDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update order.");
    } finally {
      setBusy(null);
    }
  };

  const setScenario = async (scenario: "calm" | "rush" | "low_stock") => {
    if (!token) return;
    setBusy(`scenario-${scenario}`);
    setError(null);
    setNotice(null);
    try {
      await apiRequest("/api/v1/demo/scenario", { method: "POST", token, body: { scenario } });
      setNotice(`Demo simulation switched to ${scenario.replace("_", " ").toUpperCase()}.`);
      await loadDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scenario update requires Manager role.");
    } finally {
      setBusy(null);
    }
  };

  const resetDemo = async () => {
    if (!token) return;
    setBusy("reset");
    setError(null);
    try {
      await apiRequest("/api/v1/demo/reset", { method: "POST", token });
      setNotice("Demo café dataset cleanly reset to deterministic baseline.");
      await loadDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset requires Manager role.");
    } finally {
      setBusy(null);
    }
  };

  const decideRec = async (recId: string, decision: "approved" | "dismissed") => {
    if (!token) return;
    setBusy(recId);
    try {
      await apiRequest(`/api/v1/staff/recommendations/${recId}/decide`, {
        method: "POST",
        token,
        body: { decision, note: "Manager decision from command center" },
      });
      setNotice(`Recommendation ${decision}.`);
      await loadDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Only Managers can approve recommendations.");
    } finally {
      setBusy(null);
    }
  };

  const isManager = user?.role === "manager";

  return (
    <StaffGate>
      <div className="min-h-screen bg-oat text-ink">
        <Navbar variant="staff" />
        <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
          {/* Header + Manager Demo Controls */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-caramel">Inventory Intelligence · Live Operations</p>
              <h1 className="font-display mt-1 text-4xl font-semibold">Café Command Center</h1>
              <p className="text-sm text-ink/70">
                Real-time order queue, recipe-level ingredient ledger, and approval-only AI operations proposals.
              </p>
            </div>

            {isManager && (
              <div className="ceramic-card flex flex-wrap items-center gap-2 rounded-2xl p-2.5 text-xs">
                <span className="px-2 font-semibold uppercase tracking-wider text-ink/60">Demo Simulation:</span>
                {(["calm", "rush", "low_stock"] as const).map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => setScenario(sc)}
                    className={`rounded-full px-3 py-1.5 font-semibold capitalize transition ${
                      data?.demoState.scenario === sc
                        ? "bg-espresso text-caramel-light"
                        : "bg-oat text-ink hover:bg-caramel/20"
                    }`}
                  >
                    {sc === "rush" && <Flame className="mr-1 inline h-3.5 w-3.5" />}
                    {sc.replace("_", " ")}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={resetDemo}
                  className="inline-flex items-center gap-1 rounded-full border border-ink/20 px-3 py-1.5 font-semibold hover:bg-oat"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Reset Demo
                </button>
              </div>
            )}
          </div>

          {notice && (
            <div className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> {notice}
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-coral/40 bg-coral/10 px-4 py-3 text-sm text-coral" role="alert">
              {error}
            </div>
          )}

          {/* KPI Strip */}
          {data && (
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="ceramic-card rounded-2xl p-4">
                <p className="text-xs text-ink/60">Active Queue</p>
                <p className="font-mono-num mt-1 text-3xl font-bold text-espresso">{data.kpis.activeQueue}</p>
                <p className="text-[11px] text-ink/55">Est. wait {data.etaEstimate.minMinutes}–{data.etaEstimate.maxMinutes}m</p>
              </div>
              <div className="ceramic-card rounded-2xl p-4">
                <p className="text-xs text-ink/60">Ready for Pickup</p>
                <p className="font-mono-num mt-1 text-3xl font-bold text-success">{data.kpis.readyForPickup}</p>
                <p className="text-[11px] text-ink/55">Stock consumed once</p>
              </div>
              <div className="ceramic-card rounded-2xl p-4">
                <p className="text-xs text-ink/60">At-Risk Ingredients</p>
                <p className={`font-mono-num mt-1 text-3xl font-bold ${data.kpis.atRiskIngredients > 0 ? "text-coral" : "text-success"}`}>
                  {data.kpis.atRiskIngredients}
                </p>
                <Link href="/staff/inventory" className="text-[11px] font-semibold text-caramel underline">
                  Open Ledger →
                </Link>
              </div>
              <div className="ceramic-card rounded-2xl p-4">
                <p className="text-xs text-ink/60">Menu Available</p>
                <p className="font-mono-num mt-1 text-3xl font-bold text-roast">
                  {data.kpis.availableDrinks}/{data.kpis.totalDrinks}
                </p>
                <p className="text-[11px] text-ink/55">Recipe-verified</p>
              </div>
              <div className="ceramic-card rounded-2xl p-4">
                <p className="text-xs text-ink/60">Session Volume</p>
                <p className="font-mono-num mt-1 text-3xl font-bold text-espresso">₹{Math.round(data.kpis.totalRevenueRupees)}</p>
                <p className="text-[11px] text-ink/55">{data.kpis.freeTables}/{data.kpis.totalTables} tables free</p>
              </div>
            </section>
          )}

          {/* Inventory At-Risk Strip */}
          {data && data.atRiskStrip.length > 0 && (
            <section className="rounded-2xl border border-coral/35 bg-coral/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-coral">
                  <AlertTriangle className="h-4 w-4" /> Ingredients At or Below Reorder Threshold
                </h2>
                <Link href="/staff/insights" className="text-xs font-semibold text-roast underline">
                  Ask AI Operations Agent →
                </Link>
              </div>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {data.atRiskStrip.map((ing) => (
                  <div key={ing.id} className="rounded-xl bg-porcelain p-3 text-xs">
                    <div className="flex items-center justify-between font-semibold">
                      <span>{ing.name}</span>
                      <span className="rounded-full bg-coral/20 px-2 py-0.5 uppercase text-coral">{ing.status}</span>
                    </div>
                    <p className="font-mono-num mt-1 text-sm font-bold">
                      {ing.available}{ing.unit} avail{" "}
                      <span className="text-[11px] font-normal text-ink/60">(res: {ing.reserved}, thr: {ing.lowThreshold})</span>
                    </p>
                    <p className="mt-1 truncate text-[11px] text-ink/60">Affects: {ing.affectedDrinks.join(", ")}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Main Grid: Live Order Queue + Right Sidebar (Demand + Audit Feed + Pending AI Proposals) */}
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Active Order Queue */}
            <section className="ceramic-card rounded-3xl p-6 lg:col-span-7">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-2xl font-semibold">Live Order Queue</h2>
                <Link href="/staff/orders" className="text-xs font-semibold text-caramel underline">
                  Full History →
                </Link>
              </div>

              {!data || data.activeOrders.length === 0 ? (
                <p className="rounded-xl bg-oat/60 p-6 text-center text-sm text-ink/65">No active orders in queue right now.</p>
              ) : (
                <div className="space-y-3">
                  {data.activeOrders.map((o) => (
                    <div key={o.id} className="rounded-2xl border border-ink/10 bg-oat/50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-mono-num text-xs font-bold text-roast">#{o.id}</span>
                          <span className="ml-2 text-sm font-semibold">{o.customerName}</span>
                          {o.tableId && (
                            <span className="ml-2 rounded-full bg-sage/25 px-2 py-0.5 text-[10px] font-semibold">Seat {o.tableId}</span>
                          )}
                        </div>
                        <span className="rounded-full bg-espresso px-2.5 py-0.5 text-[10px] font-bold uppercase text-caramel-light">
                          {o.status}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm">
                        {o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")} ·{" "}
                        <strong className="font-mono-num">{formatRupees(o.totalPaise)}</strong>
                      </p>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-1 text-[11px] text-ink/60">
                          <Clock className="h-3.5 w-3.5" />
                          {o.consumedAt ? "Consumed on Ready" : "Ingredients Reserved"}
                        </span>
                        <div className="flex gap-2">
                          {o.status === "confirmed" && (
                            <button
                              type="button"
                              disabled={busy === o.id}
                              onClick={() => advanceOrder(o.id, "preparing")}
                              className="rounded-full bg-roast px-4 py-1.5 text-xs font-semibold text-porcelain hover:bg-espresso"
                            >
                              Mark Preparing
                            </button>
                          )}
                          {(o.status === "confirmed" || o.status === "preparing") && (
                            <button
                              type="button"
                              disabled={busy === o.id}
                              onClick={() => advanceOrder(o.id, "ready")}
                              className="rounded-full bg-success px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                            >
                              Mark Ready (Consume Stock)
                            </button>
                          )}
                          {o.status === "ready" && (
                            <button
                              type="button"
                              disabled={busy === o.id}
                              onClick={() => advanceOrder(o.id, "collected")}
                              className="rounded-full border border-espresso px-4 py-1.5 text-xs font-semibold text-espresso hover:bg-espresso hover:text-porcelain"
                            >
                              Mark Collected
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Sidebar: Pending AI Approvals + Recent Stock Ledger Feed */}
            <aside className="space-y-6 lg:col-span-5">
              {/* Approval-Only AI Recommendations */}
              <div className="ceramic-card rounded-3xl p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display flex items-center gap-1.5 text-xl font-semibold">
                    <Sparkles className="h-4 w-4 text-caramel" /> Pending AI Proposals
                  </h2>
                  <Link href="/staff/insights" className="text-xs font-semibold text-caramel underline">
                    Run AI Ops Brief
                  </Link>
                </div>
                {!data || data.pendingRecommendations.length === 0 ? (
                  <p className="mt-3 text-xs text-ink/60">No pending proposals. Open AI Ops to analyze stock risks and substitutes.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {data.pendingRecommendations.map((r) => (
                      <div key={r.id} className="rounded-xl border border-caramel/35 bg-oat/55 p-3.5 text-xs">
                        <p className="font-semibold text-ink">{r.title}</p>
                        <p className="mt-1 text-ink/75">{r.rationale}</p>
                        {isManager && (
                          <div className="mt-2.5 flex gap-2">
                            <button
                              type="button"
                              disabled={busy === r.id}
                              onClick={() => decideRec(r.id, "approved")}
                              className="inline-flex items-center gap-1 rounded-full bg-success px-3 py-1 font-semibold text-white"
                            >
                              <Check className="h-3 w-3" /> Approve
                            </button>
                            <button
                              type="button"
                              disabled={busy === r.id}
                              onClick={() => decideRec(r.id, "dismissed")}
                              className="inline-flex items-center gap-1 rounded-full border border-ink/20 px-3 py-1 font-medium"
                            >
                              <X className="h-3 w-3" /> Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Inventory Consumption & Reservation Ledger */}
              <div className="ceramic-card rounded-3xl p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display flex items-center gap-1.5 text-xl font-semibold">
                    <Package className="h-4 w-4 text-caramel" /> Live Stock Movement
                  </h2>
                  <Link href="/staff/inventory" className="text-xs font-semibold text-caramel underline">
                    Full Ledger
                  </Link>
                </div>
                <ul className="mt-3 space-y-2 text-xs">
                  {(data?.recentInventoryEvents || []).slice(0, 8).map((ev) => (
                    <li key={ev.id} className="flex items-center justify-between gap-2 rounded-lg bg-oat/55 px-3 py-2">
                      <div>
                        <span className="font-semibold">{ev.ingredientName}</span>
                        <span className="ml-1.5 rounded bg-white px-1.5 py-0.5 text-[10px] uppercase text-roast">{ev.eventType}</span>
                        <p className="text-[10px] text-ink/60">{ev.reason}</p>
                      </div>
                      <span className="font-mono-num shrink-0 font-bold">
                        {ev.deltaOnHand !== 0 ? `OH ${ev.deltaOnHand > 0 ? "+" : ""}${ev.deltaOnHand}` : ""}
                        {ev.deltaReserved !== 0 ? ` RES ${ev.deltaReserved > 0 ? "+" : ""}${ev.deltaReserved}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </main>
      </div>
    </StaffGate>
  );
}
