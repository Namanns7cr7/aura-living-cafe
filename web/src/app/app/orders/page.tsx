"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CheckCircle2, ClipboardList, Clock, Coffee, XCircle } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { apiRequest, formatRupees, subscribeCafeEvents } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Order, OrderEvent } from "@/lib/types";

const STEPS = ["confirmed", "preparing", "ready", "collected"] as const;

function OrdersContent() {
  const { user, token } = useAuth();
  const params = useSearchParams();
  const pathname = usePathname();

  // Support both /app/orders?id=ord_... AND /app/orders/ord_...
  const pathParts = pathname.split("/").filter(Boolean);
  const pathOrderId = pathParts.length >= 3 && pathParts[0] === "app" && pathParts[1] === "orders" ? pathParts[2] : null;
  const initialId = params.get("id") || pathOrderId;

  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [selectedDetail, setSelectedDetail] = useState<{ order: Order; events: OrderEvent[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyCancel, setBusyCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await apiRequest<{ orders: Order[] }>("/api/v1/customer/orders", { token });
      setOrders(res.orders);
      const targetId = selectedId || res.orders[0]?.id || null;
      if (targetId) {
        setSelectedId(targetId);
        const det = await apiRequest<{ order: Order; events: OrderEvent[] }>(`/api/v1/customer/orders/${targetId}`, { token });
        setSelectedDetail(det);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not fetch orders.");
    } finally {
      setLoading(false);
    }
  }, [token, selectedId]);

  useEffect(() => {
    loadOrders();
    return subscribeCafeEvents((type) => {
      if (type === "order_created" || type === "order_updated") {
        loadOrders();
      }
    });
  }, [loadOrders]);

  const cancelOrder = async (orderId: string) => {
    if (!token) return;
    setBusyCancel(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/customer/orders/${orderId}/cancel`, { method: "POST", token });
      await loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot cancel order.");
    } finally {
      setBusyCancel(false);
    }
  };

  return (
    <div className="min-h-screen bg-oat text-ink">
      <Navbar variant="app" />
      <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-caramel">Live Order Telemetry</p>
          <h1 className="font-display mt-1 text-4xl font-semibold">Your Orders</h1>
          <p className="text-sm text-ink/70">Status updates stream live as your barista moves your drink from Confirmed → Preparing → Ready.</p>
        </div>

        {!user ? (
          <div className="ceramic-card rounded-2xl p-8 text-center">
            <ClipboardList className="mx-auto h-8 w-8 text-caramel" />
            <p className="mt-2 font-semibold">Sign in to view your live orders</p>
            <Link href="/login?next=/app/orders" className="mt-4 inline-block rounded-full bg-espresso px-6 py-2.5 text-sm font-semibold text-porcelain">
              Sign in
            </Link>
          </div>
        ) : loading ? (
          <p className="text-sm text-ink/60">Loading orders...</p>
        ) : orders.length === 0 ? (
          <div className="ceramic-card rounded-2xl p-8 text-center">
            <Coffee className="mx-auto h-8 w-8 text-caramel" />
            <p className="mt-2 font-semibold">No orders yet</p>
            <p className="text-sm text-ink/65">Visit the Concierge or Menu to place your first stock-verified drink.</p>
            <Link href="/app" className="mt-4 inline-block rounded-full bg-caramel px-6 py-2.5 text-sm font-bold text-espresso">
              Ask AURA Concierge
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Order List */}
            <div className="space-y-3 lg:col-span-4">
              {orders.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSelectedId(o.id)}
                  className={`ceramic-card w-full rounded-2xl p-4 text-left transition ${
                    selectedId === o.id ? "border-caramel ring-2 ring-caramel/40" : "hover:border-ink/25"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono-num text-xs font-semibold text-roast">#{o.id}</span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                        o.status === "ready"
                          ? "bg-success/20 text-success"
                          : o.status === "cancelled"
                          ? "bg-coral/20 text-coral"
                          : "bg-caramel/20 text-roast"
                      }`}
                    >
                      {o.status}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold">
                    {o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-xs text-ink/60">
                    <span className="font-mono-num font-semibold text-ink">{formatRupees(o.totalPaise)}</span>
                    <span>{new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Selected Order Timeline */}
            <div className="ceramic-card rounded-3xl p-6 lg:col-span-8">
              {error && <p className="mb-4 rounded-xl bg-coral/10 p-3 text-sm text-coral">{error}</p>}
              {selectedDetail ? (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink/10 pb-4">
                    <div>
                      <span className="font-mono-num text-xs font-semibold text-caramel">ORDER #{selectedDetail.order.id}</span>
                      <h2 className="font-display text-3xl font-semibold capitalize">
                        Status: {selectedDetail.order.status}
                      </h2>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-ink/70">
                        <Clock className="h-3.5 w-3.5" />
                        Estimated pickup window: {selectedDetail.order.etaMinMinutes}–{selectedDetail.order.etaMaxMinutes} min
                        {selectedDetail.order.tableId ? ` · Seat ${selectedDetail.order.tableId} reserved` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono-num text-2xl font-bold text-roast">{formatRupees(selectedDetail.order.totalPaise)}</p>
                      <p className="text-[11px] text-ink/60">
                        {selectedDetail.order.consumedAt ? "Ingredients consumed on Ready" : selectedDetail.order.status === "cancelled" ? "Reservation released" : "Ingredients reserved"}
                      </p>
                    </div>
                  </div>

                  {/* Stepper */}
                  {selectedDetail.order.status !== "cancelled" ? (
                    <ol className="grid grid-cols-4 gap-2">
                      {STEPS.map((st, idx) => {
                        const currentIdx = STEPS.indexOf(selectedDetail.order.status as (typeof STEPS)[number]);
                        const done = idx <= currentIdx;
                        return (
                          <li
                            key={st}
                            className={`rounded-xl border p-3 text-center ${
                              done ? "border-success bg-success/10 text-espresso" : "border-ink/10 bg-oat/50 text-ink/45"
                            }`}
                          >
                            <CheckCircle2 className={`mx-auto h-4 w-4 ${done ? "text-success" : "text-ink/25"}`} />
                            <p className="mt-1 text-xs font-semibold capitalize">{st}</p>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl border border-coral/30 bg-coral/10 p-4 text-sm text-coral">
                      <XCircle className="h-5 w-5" /> Order cancelled — reserved ingredients have been released back to available stock.
                    </div>
                  )}

                  {/* Items */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink/60">Items</h3>
                    {selectedDetail.order.items.map((it, i) => (
                      <div key={i} className="flex items-center justify-between rounded-xl bg-oat/60 px-4 py-3 text-sm">
                        <div>
                          <p className="font-semibold">{it.qty}× {it.name}</p>
                          {it.selectedModifierNames.length > 0 && (
                            <p className="text-xs text-ink/60">{it.selectedModifierNames.join(", ")}</p>
                          )}
                        </div>
                        <span className="font-mono-num font-semibold">{formatRupees(it.lineTotalPaise)}</span>
                      </div>
                    ))}
                  </div>

                  {/* Audit Timeline */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink/60">Audit Timeline</h3>
                    <ul className="space-y-2 text-xs">
                      {selectedDetail.events.map((ev) => (
                        <li key={ev.id} className="flex items-center justify-between rounded-lg border border-ink/10 px-3 py-2">
                          <span>
                            <strong className="capitalize">{ev.toStatus}</strong> — {ev.reason}
                          </span>
                          <span className="font-mono-num text-ink/55">
                            {new Date(ev.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {selectedDetail.order.status === "confirmed" && (
                    <div className="flex justify-end border-t border-ink/10 pt-4">
                      <button
                        type="button"
                        disabled={busyCancel}
                        onClick={() => cancelOrder(selectedDetail.order.id)}
                        className="rounded-full border border-coral px-5 py-2 text-xs font-semibold text-coral hover:bg-coral/10 disabled:opacity-50"
                      >
                        {busyCancel ? "Cancelling..." : "Cancel Order (Release Reserved Stock)"}
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-oat p-10 text-center text-sm text-ink/60">Loading orders...</div>}>
      <OrdersContent />
    </Suspense>
  );
}
