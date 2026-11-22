"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Armchair, CheckCircle2, List, Map, Plug, Volume2 } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { apiRequest, subscribeCafeEvents } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useCart } from "@/lib/cart-context";
import { TableItem } from "@/lib/types";

export default function RoomPage() {
  const router = useRouter();
  const { user, token } = useAuth();
  const { tableId: cartTableId, setTableId, setDrawerOpen } = useCart();

  const [tables, setTables] = useState<TableItem[]>([]);
  const [selected, setSelected] = useState<TableItem | null>(null);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTables = useCallback(async () => {
    const res = await apiRequest<{ tables: TableItem[] }>("/api/v1/public/tables", { token });
    setTables(res.tables);
    setSelected((prev) => (prev ? res.tables.find((t) => t.id === prev.id) || res.tables[0] : res.tables[0] || null));
  }, [token]);

  useEffect(() => {
    loadTables();
    return subscribeCafeEvents(() => loadTables());
  }, [loadTables]);

  const reserveNow = async (tbl: TableItem) => {
    if (!token || !user) {
      router.push("/login?next=/app/room");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest("/api/v1/customer/tables/reserve", {
        method: "POST",
        token,
        body: { tableId: tbl.id, durationMinutes: 60 },
      });
      setTableId(tbl.id);
      setMessage(`Reserved ${tbl.label} (${tbl.id}) for 60 minutes!`);
      await loadTables();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reserve table.");
    } finally {
      setBusy(false);
    }
  };

  const releaseNow = async (tbl: TableItem) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest(`/api/v1/customer/tables/${tbl.id}/release`, { method: "POST", token });
      if (cartTableId === tbl.id) setTableId(null);
      setMessage(`Released ${tbl.label}.`);
      await loadTables();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not release table.");
    } finally {
      setBusy(false);
    }
  };

  const statusColor = (st: TableItem["status"]) => {
    if (st === "free") return "border-sage bg-sage/15 text-espresso";
    if (st === "reserved") return "border-caramel bg-caramel/20 text-roast";
    return "border-espresso/20 bg-espresso/5 text-roast/60";
  };

  return (
    <div className="min-h-screen bg-cream text-espresso">
      <Navbar variant="app" />
      <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-espresso/10 pb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-caramel">Live Seating & Acoustic Zones</p>
            <h1 className="font-display mt-1 text-4xl font-semibold sm:text-5xl">The Living Room</h1>
            <p className="mt-1 text-sm text-roast/75">
              12 tables across 4 zones. Click any seat to inspect power outlets, simulated ambient dB, and atomic reservation status.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-espresso/15 bg-porcelain p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setViewMode("map")}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 ${
                viewMode === "map" ? "bg-espresso text-cream" : "text-roast/75"
              }`}
            >
              <Map className="h-3.5 w-3.5" /> Floorplan
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 ${
                viewMode === "list" ? "bg-espresso text-cream" : "text-roast/75"
              }`}
            >
              <List className="h-3.5 w-3.5" /> Accessible List
            </button>
          </div>
        </div>

        {/* Status Legend */}
        <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sage bg-sage/20 px-3 py-1">
            ● Free ({tables.filter((t) => t.status === "free").length})
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-caramel bg-caramel/20 px-3 py-1">
            ◐ Reserved ({tables.filter((t) => t.status === "reserved").length})
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-espresso/20 bg-espresso/5 px-3 py-1">
            ■ Occupied ({tables.filter((t) => t.status === "occupied").length})
          </span>
          <span className="text-roast/65">Ambient noise figures labeled as simulated demo sensors.</span>
        </div>

        {message && (
          <div className="flex items-center gap-2 rounded-xl border border-sage/45 bg-sage/15 p-3.5 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> {message}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-coral/35 bg-coral/10 p-3.5 text-sm text-coral" role="alert">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="ceramic-card rounded-3xl p-5 lg:col-span-8">
            {viewMode === "map" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {(["quiet", "window", "social", "bar"] as const).map((zone) => (
                  <div key={zone} className="rounded-2xl border border-espresso/10 bg-cream/65 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-xs font-bold uppercase tracking-widest text-roast">{zone} Zone</h2>
                      <span className="text-[11px] text-roast/65">
                        {tables.filter((t) => t.zone === zone && t.status === "free").length} free
                      </span>
                    </div>
                    <div className="grid gap-2.5">
                      {tables
                        .filter((t) => t.zone === zone)
                        .map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setSelected(t)}
                            className={`flex items-center justify-between rounded-xl border-2 px-3.5 py-3 text-left transition ${statusColor(
                              t.status
                            )} ${selected?.id === t.id ? "ring-2 ring-espresso ring-offset-2" : ""}`}
                          >
                            <div>
                              <p className="font-semibold">
                                <span className="font-mono-num mr-1.5">{t.id}</span>
                                {t.label}
                              </p>
                              <p className="mt-0.5 text-[11px] opacity-80">
                                {t.seats} seats · {t.hasOutlet ? "Outlet" : "No outlet"} · ~{t.ambientNoiseDb} dB (sim)
                              </p>
                            </div>
                            <span className="rounded-full bg-white/85 px-2.5 py-0.5 text-[10px] font-bold uppercase text-espresso">
                              {t.reservedByMe ? "Yours" : t.status}
                            </span>
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-espresso/10 text-xs uppercase text-roast/65">
                    <tr>
                      <th className="py-2 pr-3">Table</th>
                      <th className="py-2 pr-3">Zone</th>
                      <th className="py-2 pr-3">Seats</th>
                      <th className="py-2 pr-3">Power</th>
                      <th className="py-2 pr-3">Noise (Sim)</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-espresso/10">
                    {tables.map((t) => (
                      <tr key={t.id}>
                        <td className="py-2.5 pr-3 font-semibold">
                          {t.id} · {t.label}
                        </td>
                        <td className="py-2.5 pr-3 capitalize">{t.zone}</td>
                        <td className="font-mono-num py-2.5 pr-3">{t.seats}</td>
                        <td className="py-2.5 pr-3">{t.hasOutlet ? "Yes" : "No"}</td>
                        <td className="font-mono-num py-2.5 pr-3">{t.ambientNoiseDb} dB</td>
                        <td className="py-2.5 pr-3 capitalize">{t.reservedByMe ? "Reserved (Yours)" : t.status}</td>
                        <td className="py-2.5">
                          <button type="button" onClick={() => setSelected(t)} className="text-xs font-semibold text-caramel underline">
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <aside className="ceramic-card flex flex-col justify-between rounded-3xl p-6 lg:col-span-4">
            {selected ? (
              <div>
                <span className="rounded-full bg-cream px-3 py-1 text-xs font-semibold uppercase tracking-wider text-roast">
                  {selected.zone} Zone · {selected.id}
                </span>
                <h2 className="font-display mt-3 text-3xl font-semibold">{selected.label}</h2>
                <p className="mt-1 text-sm capitalize text-roast/75">
                  Status: <strong>{selected.reservedByMe ? "Reserved by you" : selected.status}</strong>
                </p>

                <dl className="mt-5 space-y-3 border-y border-espresso/10 py-4 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-2 text-roast/75">
                      <Armchair className="h-4 w-4" /> Capacity
                    </dt>
                    <dd className="font-mono-num font-semibold">{selected.seats} seats</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-2 text-roast/75">
                      <Plug className="h-4 w-4" /> Power Outlet
                    </dt>
                    <dd className="font-semibold">{selected.hasOutlet ? "Available" : "None"}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-2 text-roast/75">
                      <Volume2 className="h-4 w-4" /> Ambient Noise
                    </dt>
                    <dd className="font-mono-num font-semibold">~{selected.ambientNoiseDb} dB (simulated)</dd>
                  </div>
                </dl>

                <div className="mt-5 space-y-2.5">
                  {selected.status === "free" && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => reserveNow(selected)}
                        className="w-full rounded-full bg-espresso py-3 text-sm font-semibold text-cream transition hover:bg-roast disabled:opacity-50"
                      >
                        {busy ? "Reserving..." : "Reserve Seat (60 min)"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTableId(selected.id);
                          setDrawerOpen(true);
                        }}
                        className="w-full rounded-full border border-caramel py-2.5 text-xs font-semibold text-roast transition hover:bg-milk/40"
                      >
                        Pair with Current Drink Tray
                      </button>
                    </>
                  )}
                  {selected.reservedByMe && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => releaseNow(selected)}
                      className="w-full rounded-full border border-coral py-2.5 text-sm font-semibold text-coral transition hover:bg-coral/10"
                    >
                      Release My Reservation
                    </button>
                  )}
                  {selected.status !== "free" && !selected.reservedByMe && (
                    <p className="rounded-xl bg-cream p-3 text-xs text-roast/75">
                      This table is currently {selected.status}. Expired reservations release automatically.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-roast/65">Select a table to view details.</p>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
