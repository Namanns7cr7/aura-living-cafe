"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { StaffGate } from "@/components/StaffGate";
import { apiRequest, formatRupees, subscribeCafeEvents } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Order } from "@/lib/types";

export default function StaffOrdersPage() {
  const { user, token } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    if (!token) return;
    const res = await apiRequest<{ orders: Order[] }>(`/api/v1/staff/orders?status=${filter}`, { token });
    setOrders(res.orders);
  }, [token, filter]);

  useEffect(() => {
    loadOrders();
    return subscribeCafeEvents(() => loadOrders(), { isStaff: true });
  }, [loadOrders]);

  const transition = async (id: string, status: "preparing" | "ready" | "collected" | "cancelled") => {
    if (!token) return;
    setBusy(id);
    setError(null);
    try {
      await apiRequest(`/api/v1/staff/orders/${id}/status`, {
        method: "PATCH",
        token,
        body: { status, reason: `Updated by ${user?.displayName}` },
      });
      await loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transition failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <StaffGate>
      <div className="min-h-screen bg-oat text-ink">
        <Navbar variant="staff" />
        <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-caramel">Barista Fulfillment Queue</p>
              <h1 className="font-display mt-1 text-4xl font-semibold">Orders & State Transitions</h1>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["all", "confirmed", "preparing", "ready", "collected", "cancelled"].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setFilter(st)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize ${
                    filter === st ? "bg-espresso text-porcelain" : "border border-ink/15 bg-porcelain text-ink"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="rounded-xl bg-coral/10 p-3 text-sm text-coral">{error}</p>}

          <div className="ceramic-card overflow-x-auto rounded-3xl p-4">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink/10 text-xs uppercase text-ink/60">
                <tr>
                  <th className="p-3">Order</th>
                  <th className="p-3">Guest</th>
                  <th className="p-3">Items</th>
                  <th className="p-3">Total</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Stock State</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/10">
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="font-mono-num p-3 text-xs font-semibold">#{o.id}</td>
                    <td className="p-3">
                      {o.customerName}
                      {o.tableId ? <span className="ml-1.5 rounded bg-sage/20 px-1.5 py-0.5 text-[10px]">Seat {o.tableId}</span> : null}
                    </td>
                    <td className="p-3 text-xs">{o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</td>
                    <td className="font-mono-num p-3 font-semibold">{formatRupees(o.totalPaise)}</td>
                    <td className="p-3">
                      <span className="rounded-full bg-oat px-2.5 py-0.5 text-xs font-semibold capitalize">{o.status}</span>
                    </td>
                    <td className="p-3 text-xs text-ink/70">{o.consumedAt ? "Consumed once" : o.status === "cancelled" ? "Released" : "Reserved"}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1.5">
                        {o.status === "confirmed" && (
                          <button type="button" disabled={busy === o.id} onClick={() => transition(o.id, "preparing")} className="rounded-full bg-roast px-3 py-1 text-xs font-semibold text-porcelain">
                            Preparing
                          </button>
                        )}
                        {(o.status === "confirmed" || o.status === "preparing") && (
                          <button type="button" disabled={busy === o.id} onClick={() => transition(o.id, "ready")} className="rounded-full bg-success px-3 py-1 text-xs font-semibold text-white">
                            Ready
                          </button>
                        )}
                        {o.status === "ready" && (
                          <button type="button" disabled={busy === o.id} onClick={() => transition(o.id, "collected")} className="rounded-full border border-espresso px-3 py-1 text-xs font-semibold">
                            Collected
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </StaffGate>
  );
}
