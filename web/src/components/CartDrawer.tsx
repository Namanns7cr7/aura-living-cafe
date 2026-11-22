"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Minus, Plus, ShieldCheck, ShoppingBag, Trash2, X } from "lucide-react";
import { apiRequest, ApiError, formatRupees } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useCart } from "@/lib/cart-context";
import { ApprovalPreview, Order } from "@/lib/types";

export function CartDrawer() {
  const router = useRouter();
  const { user, token } = useAuth();
  const { items, tableId, setTableId, drawerOpen, setDrawerOpen, updateQty, removeItem, clearCart, estimatedTotalPaise } =
    useCart();

  const [preview, setPreview] = useState<ApprovalPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [substitutes, setSubstitutes] = useState<{ id: string; name: string; priceRupees: number; availableServings: number }[]>(
    []
  );

  useEffect(() => {
    setPreview(null);
    setError(null);
    setSubstitutes([]);
  }, [items, tableId, drawerOpen]);

  if (!drawerOpen) return null;

  const requestPreview = async () => {
    if (!token || !user) {
      setDrawerOpen(false);
      router.push("/login?next=/app/menu");
      return;
    }
    setLoadingPreview(true);
    setError(null);
    setSubstitutes([]);
    try {
      const res = await apiRequest<ApprovalPreview>("/api/v1/customer/orders/preview", {
        method: "POST",
        token,
        body: {
          items: items.map((i) => ({
            menuItemId: i.menuItemId,
            qty: i.qty,
            selectedModifierIds: i.selectedModifierIds,
          })),
          tableId,
        },
      });
      setPreview(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not validate stock right now.");
    } finally {
      setLoadingPreview(false);
    }
  };

  const confirmOrder = async () => {
    if (!preview || !token) return;
    setConfirming(true);
    setError(null);
    setSubstitutes([]);
    try {
      const idemKey = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await apiRequest<{ order: Order; idempotentReplay: boolean }>("/api/v1/customer/orders/confirm", {
        method: "POST",
        token,
        body: {
          items: items.map((i) => ({
            menuItemId: i.menuItemId,
            qty: i.qty,
            selectedModifierIds: i.selectedModifierIds,
          })),
          tableId,
          idempotencyKey: idemKey,
          approvalToken: preview.approvalToken,
        },
      });
      clearCart();
      setPreview(null);
      setDrawerOpen(false);
      router.push(`/app/orders?id=${encodeURIComponent(res.order.id)}`);
    } catch (e) {
      if (e instanceof ApiError && typeof e.detail === "object" && e.detail !== null) {
        const det = e.detail as {
          message?: string;
          substitutes?: { id: string; name: string; priceRupees: number; availableServings: number }[];
        };
        setError(det.message || e.message);
        if (Array.isArray(det.substitutes)) setSubstitutes(det.substitutes);
      } else {
        setError(e instanceof Error ? e.message : "Order confirmation failed.");
      }
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-espresso/55 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Your café tray"
    >
      <div className="flex h-full w-full max-w-md flex-col bg-porcelain text-espresso shadow-elevated">
        <div className="flex items-center justify-between border-b border-espresso/10 px-6 py-5">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="h-5 w-5 text-caramel" />
            <h2 className="font-display text-2xl font-semibold">Your Order Tray</h2>
          </div>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close cart"
            className="rounded-full p-1.5 text-roast hover:bg-cream"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-espresso/15 bg-cream/70 p-8 text-center">
              <p className="font-medium text-espresso">Your tray is currently empty</p>
              <p className="mt-1 text-sm text-roast/70">Explore our live stock-backed menu or ask the AURA Concierge.</p>
            </div>
          ) : (
            <>
              <ul className="space-y-3">
                {items.map((item) => (
                  <li key={`${item.menuItemId}-${item.selectedModifierIds.join(",")}`} className="ceramic-card rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-espresso">{item.name}</p>
                        {item.modifierNames.length > 0 && (
                          <p className="text-xs text-roast/70">{item.modifierNames.join(" · ")}</p>
                        )}
                        <p className="font-mono-num mt-1 text-sm font-semibold text-roast">
                          {formatRupees(item.unitPricePaise * item.qty)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => updateQty(item.menuItemId, item.selectedModifierIds, -1)}
                          aria-label={`Decrease ${item.name}`}
                          className="rounded-full border border-espresso/15 p-1 hover:bg-cream"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="font-mono-num w-6 text-center text-sm font-semibold">{item.qty}</span>
                        <button
                          type="button"
                          onClick={() => updateQty(item.menuItemId, item.selectedModifierIds, 1)}
                          aria-label={`Increase ${item.name}`}
                          className="rounded-full border border-espresso/15 p-1 hover:bg-cream"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeItem(item.menuItemId, item.selectedModifierIds)}
                          aria-label={`Remove ${item.name}`}
                          className="ml-1 rounded-full p-1 text-coral hover:bg-coral/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {tableId && (
                <div className="flex items-center justify-between rounded-xl border border-sage/40 bg-sage/15 px-3.5 py-2.5 text-sm">
                  <span>
                    Paired Seat: <strong className="font-mono-num">{tableId}</strong>
                  </span>
                  <button type="button" onClick={() => setTableId(null)} className="text-xs font-medium text-roast underline">
                    Remove seat
                  </button>
                </div>
              )}

              {preview && (
                <div className="rounded-2xl border border-sage/40 bg-sage/10 p-4 text-sm">
                  <div className="flex items-center gap-2 font-semibold text-success">
                    <ShieldCheck className="h-4 w-4" />
                    Live Stock & Price Verified
                  </div>
                  <p className="mt-1 text-xs text-roast">
                    Estimated ready in <strong className="font-mono-num">{preview.etaMinMinutes}–{preview.etaMaxMinutes} min</strong> · Verified Total:{" "}
                    <strong className="font-mono-num">{formatRupees(preview.totalPaise)}</strong>
                  </p>
                  <div className="mt-2.5 space-y-1 border-t border-sage/25 pt-2 text-xs text-roast/85">
                    <p className="font-medium text-espresso">Ingredients reserved on confirm:</p>
                    {preview.ingredientImpact.map((imp) => (
                      <div key={imp.ingredientId} className="flex justify-between">
                        <span>{imp.ingredientName}</span>
                        <span className="font-mono-num">
                          −{imp.required}
                          {imp.unit} (left: {imp.availableAfter}
                          {imp.unit})
                        </span>
                      </div>
                    ))}
                  </div>
                  {preview.warnings.map((w, idx) => (
                    <p key={idx} className="mt-2 text-xs font-medium text-coral">
                      ⚠ {w}
                    </p>
                  ))}
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-coral/35 bg-coral/10 p-3.5 text-sm text-espresso">
                  <div className="flex items-start gap-2 font-semibold text-coral">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                  {substitutes.length > 0 && (
                    <div className="mt-2 border-t border-coral/20 pt-2 text-xs">
                      <p className="font-semibold">In-stock alternatives right now:</p>
                      <ul className="mt-1 space-y-1">
                        {substitutes.map((s) => (
                          <li key={s.id} className="flex justify-between">
                            <span>{s.name}</span>
                            <span className="font-mono-num">
                              ₹{s.priceRupees} · {s.availableServings} left
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-espresso/10 bg-cream/85 p-6">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="text-roast/75">Estimated Total (server-validated)</span>
              <span className="font-mono-num text-lg font-bold text-espresso">
                {formatRupees(preview?.totalPaise ?? estimatedTotalPaise)}
              </span>
            </div>
            {!preview ? (
              <button
                type="button"
                disabled={loadingPreview}
                onClick={requestPreview}
                className="w-full rounded-full bg-espresso py-3 text-sm font-semibold text-cream transition hover:bg-roast disabled:opacity-50"
              >
                {loadingPreview ? "Checking live inventory..." : user ? "Verify Stock & Review Order" : "Sign in to Order"}
              </button>
            ) : (
              <button
                type="button"
                disabled={confirming}
                onClick={confirmOrder}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-caramel py-3 text-sm font-bold text-espresso transition hover:bg-caramel-light disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {confirming ? "Reserving Ingredients..." : "Confirm Order & Reserve Stock"}
              </button>
            )}
            <p className="mt-2 text-center text-[11px] text-roast/65">
              Atomic stock reservation · Consumed strictly when prepared
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
