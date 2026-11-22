"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, PlusCircle, Search } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { StaffGate } from "@/components/StaffGate";
import { apiRequest, subscribeCafeEvents } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { IngredientView, InventoryEvent } from "@/lib/types";

interface MenuServingRow {
  id: string;
  name: string;
  category: string;
  priceRupees: number;
  active: boolean;
  availableServings: number;
  isAvailable: boolean;
  limitingIngredientName?: string | null;
}

export default function StaffInventoryPage() {
  const { user, token } = useAuth();
  const [ingredients, setIngredients] = useState<IngredientView[]>([]);
  const [menuServings, setMenuServings] = useState<MenuServingRow[]>([]);
  const [events, setEvents] = useState<InventoryEvent[]>([]);
  const [search, setSearch] = useState("");
  const [restockDelta, setRestockDelta] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isManager = user?.role === "manager";

  const loadLedger = useCallback(async () => {
    if (!token) return;
    const res = await apiRequest<{ ingredients: IngredientView[]; menuServings: MenuServingRow[]; events: InventoryEvent[] }>(
      "/api/v1/staff/inventory",
      { token }
    );
    setIngredients(res.ingredients);
    setMenuServings(res.menuServings);
    setEvents(res.events);
  }, [token]);

  useEffect(() => {
    loadLedger();
    return subscribeCafeEvents(() => loadLedger(), { isStaff: true });
  }, [loadLedger]);

  const handleAdjust = async (ing: IngredientView) => {
    if (!token) return;
    const delta = restockDelta[ing.id] ?? (ing.unit === "each" ? 10 : ing.unit === "g" ? 500 : 1000);
    setError(null);
    setNotice(null);
    try {
      await apiRequest("/api/v1/staff/inventory/adjust", {
        method: "POST",
        token,
        body: {
          ingredientId: ing.id,
          deltaOnHand: delta,
          reason: `Manager audited ${delta >= 0 ? "restock" : "adjustment"}`,
          expectedVersion: ing.version,
        },
      });
      setNotice(`Updated ${ing.name} by ${delta >= 0 ? "+" : ""}${delta}${ing.unit}.`);
      await loadLedger();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Adjustment failed.");
    }
  };

  const toggleMenuItem = async (row: MenuServingRow) => {
    if (!token) return;
    setError(null);
    try {
      await apiRequest(`/api/v1/staff/menu/${row.id}/availability`, {
        method: "PATCH",
        token,
        body: { active: !row.active, reason: "Manager availability toggle" },
      });
      setNotice(`${row.name} marked ${!row.active ? "Active" : "Temporarily Paused"}.`);
      await loadLedger();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed.");
    }
  };

  const filteredIngredients = ingredients.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <StaffGate>
      <div className="min-h-screen bg-oat text-ink">
        <Navbar variant="staff" />
        <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-caramel">Deterministic Base-Unit Ledger</p>
              <h1 className="font-display mt-1 text-4xl font-semibold">Ingredient Inventory</h1>
              <p className="text-sm text-ink/70">
                Available = On-Hand − Reserved. Optimistic locking + atomic Firestore transactions prevent overselling.
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/45" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter 26 ingredients..."
                className="w-full rounded-full border border-ink/15 bg-porcelain py-2 pl-10 pr-4 text-sm"
              />
            </div>
          </div>

          {notice && (
            <div className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> {notice}
            </div>
          )}
          {error && <p className="rounded-xl bg-coral/10 p-3 text-sm text-coral">{error}</p>}

          {/* Ingredient Table */}
          <section className="ceramic-card overflow-x-auto rounded-3xl p-4">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink/10 text-xs uppercase text-ink/60">
                <tr>
                  <th className="p-3">Ingredient</th>
                  <th className="p-3">On Hand</th>
                  <th className="p-3">Reserved</th>
                  <th className="p-3">Available</th>
                  <th className="p-3">Threshold</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Affected Drinks</th>
                  {isManager && <th className="p-3">Manager Restock</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/10">
                {filteredIngredients.map((ing) => (
                  <tr key={ing.id}>
                    <td className="p-3 font-semibold">
                      {ing.name}
                      <span className="block text-[10px] font-normal uppercase text-ink/50">{ing.category} · v{ing.version}</span>
                    </td>
                    <td className="font-mono-num p-3">{ing.onHand}{ing.unit}</td>
                    <td className="font-mono-num p-3 text-caramel">{ing.reserved}{ing.unit}</td>
                    <td className="font-mono-num p-3 font-bold">{ing.available}{ing.unit}</td>
                    <td className="font-mono-num p-3 text-ink/65">{ing.lowThreshold}{ing.unit}</td>
                    <td className="p-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                          ing.status === "healthy"
                            ? "bg-success/15 text-success"
                            : ing.status === "low"
                            ? "bg-caramel/25 text-roast"
                            : "bg-coral/20 text-coral"
                        }`}
                      >
                        {ing.status}
                      </span>
                    </td>
                    <td className="max-w-xs truncate p-3 text-xs text-ink/70">{ing.affectedDrinks.join(", ")}</td>
                    {isManager && (
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            aria-label={`Restock quantity for ${ing.name}`}
                            value={restockDelta[ing.id] ?? (ing.unit === "each" ? 10 : ing.unit === "g" ? 500 : 1000)}
                            onChange={(e) => setRestockDelta((p) => ({ ...p, [ing.id]: Number(e.target.value) }))}
                            className="font-mono-num w-20 rounded-lg border border-ink/20 bg-white px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => handleAdjust(ing)}
                            className="inline-flex items-center gap-1 rounded-full bg-espresso px-3 py-1 text-xs font-semibold text-porcelain hover:bg-roast"
                          >
                            <PlusCircle className="h-3.5 w-3.5" /> Apply
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Recipe Impact + Audit Events */}
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="ceramic-card rounded-3xl p-5">
              <h2 className="font-display text-2xl font-semibold">Recipe Servings Impact</h2>
              <p className="text-xs text-ink/65">Live servings computable per drink; managers can temporarily pause any item.</p>
              <div className="mt-4 max-h-96 space-y-2 overflow-y-auto pr-1">
                {menuServings.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2 rounded-xl bg-oat/55 px-3.5 py-2.5 text-xs">
                    <div>
                      <p className="font-semibold">{m.name}</p>
                      <p className="text-ink/60">
                        {m.availableServings} servings possible · limited by {m.limitingIngredientName || "stock"}
                      </p>
                    </div>
                    {isManager && (
                      <button
                        type="button"
                        onClick={() => toggleMenuItem(m)}
                        className={`rounded-full px-3 py-1 font-semibold ${
                          m.active ? "border border-coral text-coral hover:bg-coral/10" : "bg-success text-white"
                        }`}
                      >
                        {m.active ? "Pause Item" : "Re-Enable"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="ceramic-card rounded-3xl p-5">
              <h2 className="font-display text-2xl font-semibold">Inventory Transaction Journal</h2>
              <p className="text-xs text-ink/65">Append-only audit log of every reservation, consumption, release, and restock.</p>
              <div className="mt-4 max-h-96 space-y-2 overflow-y-auto pr-1 text-xs">
                {events.map((ev) => (
                  <div key={ev.id} className="flex items-center justify-between rounded-xl border border-ink/10 px-3 py-2">
                    <div>
                      <span className="font-semibold">{ev.ingredientName}</span>
                      <span className="ml-1.5 rounded bg-oat px-1.5 py-0.5 text-[10px] font-bold uppercase text-roast">{ev.eventType}</span>
                      <p className="text-[11px] text-ink/60">{ev.reason}</p>
                    </div>
                    <div className="font-mono-num text-right font-semibold">
                      {ev.deltaOnHand !== 0 && <div>OnHand {ev.deltaOnHand > 0 ? "+" : ""}{ev.deltaOnHand}</div>}
                      {ev.deltaReserved !== 0 && <div className="text-caramel">Res {ev.deltaReserved > 0 ? "+" : ""}{ev.deltaReserved}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>
      </div>
    </StaffGate>
  );
}
