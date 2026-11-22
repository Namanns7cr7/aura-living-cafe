"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { OrderItemInput } from "./types";

export interface CartEntry extends OrderItemInput {
  name: string;
  unitPricePaise: number;
  modifierNames: string[];
}

interface CartContextValue {
  items: CartEntry[];
  tableId: string | null;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  setTableId: (tableId: string | null) => void;
  addItem: (entry: CartEntry) => void;
  updateQty: (menuItemId: string, selectedModifierIds: string[], delta: number) => void;
  removeItem: (menuItemId: string, selectedModifierIds: string[]) => void;
  replaceCart: (entries: CartEntry[], tableId?: string | null) => void;
  clearCart: () => void;
  totalCount: number;
  estimatedTotalPaise: number;
}

const CartContext = createContext<CartContextValue | null>(null);
const CART_KEY = "aura_cart_v1";

function entryKey(menuItemId: string, mods: string[]): string {
  return `${menuItemId}::${[...mods].sort().join(",")}`;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartEntry[]>([]);
  const [tableId, setTableId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { items?: CartEntry[]; tableId?: string | null };
        if (Array.isArray(parsed.items)) setItems(parsed.items);
        if (parsed.tableId) setTableId(parsed.tableId);
      }
    } catch {
      // ignore storage parse error
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify({ items, tableId }));
    } catch {
      // ignore
    }
  }, [items, tableId]);

  const addItem = useCallback((entry: CartEntry) => {
    const k = entryKey(entry.menuItemId, entry.selectedModifierIds);
    setItems((prev) => {
      const idx = prev.findIndex((p) => entryKey(p.menuItemId, p.selectedModifierIds) === k);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: Math.min(10, next[idx].qty + entry.qty) };
        return next;
      }
      return [...prev, entry];
    });
  }, []);

  const updateQty = useCallback((menuItemId: string, mods: string[], delta: number) => {
    const k = entryKey(menuItemId, mods);
    setItems((prev) =>
      prev
        .map((p) => (entryKey(p.menuItemId, p.selectedModifierIds) === k ? { ...p, qty: p.qty + delta } : p))
        .filter((p) => p.qty > 0)
    );
  }, []);

  const removeItem = useCallback((menuItemId: string, mods: string[]) => {
    const k = entryKey(menuItemId, mods);
    setItems((prev) => prev.filter((p) => entryKey(p.menuItemId, p.selectedModifierIds) !== k));
  }, []);

  const replaceCart = useCallback((entries: CartEntry[], nextTableId?: string | null) => {
    setItems(entries);
    if (nextTableId !== undefined) setTableId(nextTableId);
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setTableId(null);
  }, []);

  const totalCount = items.reduce((acc, i) => acc + i.qty, 0);
  const estimatedTotalPaise = items.reduce((acc, i) => acc + i.unitPricePaise * i.qty, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        tableId,
        drawerOpen,
        setDrawerOpen,
        setTableId,
        addItem,
        updateQty,
        removeItem,
        replaceCart,
        clearCart,
        totalCount,
        estimatedTotalPaise,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
