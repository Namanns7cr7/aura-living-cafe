"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Coffee, Search, SlidersHorizontal } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { apiRequest, formatRupees, subscribeCafeEvents } from "@/lib/api";
import { useCart } from "@/lib/cart-context";
import { MenuItem } from "@/lib/types";

const CATEGORIES = [
  { id: "all", label: "All Items" },
  { id: "cold_coffee", label: "Cold Coffee" },
  { id: "espresso", label: "Espresso" },
  { id: "signature", label: "Signatures" },
  { id: "tea_matcha", label: "Tea & Matcha" },
  { id: "bakery", label: "Bakery" },
];

export default function MenuPage() {
  const { addItem, setDrawerOpen } = useCart();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [dietary, setDietary] = useState("");
  const [excludeAllergen, setExcludeAllergen] = useState("");
  const [selectedMods, setSelectedMods] = useState<Record<string, string[]>>({});

  const fetchMenu = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (category !== "all") qs.set("category", category);
      if (search.trim()) qs.set("search", search.trim());
      if (dietary) qs.set("dietary", dietary);
      if (excludeAllergen) qs.set("excludeAllergen", excludeAllergen);
      const res = await apiRequest<{ items: MenuItem[] }>(`/api/v1/public/menu?${qs.toString()}`);
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  }, [category, search, dietary, excludeAllergen]);

  useEffect(() => {
    fetchMenu();
    return subscribeCafeEvents(() => fetchMenu());
  }, [fetchMenu]);

  const toggleMod = (itemId: string, modId: string) => {
    setSelectedMods((prev) => {
      const cur = prev[itemId] || [];
      const next = cur.includes(modId) ? cur.filter((id) => id !== modId) : [...cur, modId];
      return { ...prev, [itemId]: next };
    });
  };

  return (
    <div className="min-h-screen bg-oat text-ink">
      <Navbar variant="app" />
      <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-caramel">Live Recipe-Backed Catalog</p>
            <h1 className="font-display mt-1 text-4xl font-semibold">Crafted Menu</h1>
            <p className="text-sm text-ink/70">Every availability badge is computed directly from live café ingredient stock.</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/45" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search drinks or tasting notes..."
              aria-label="Search menu"
              className="w-full rounded-full border border-ink/15 bg-porcelain py-2.5 pl-10 pr-4 text-sm focus:border-caramel focus:outline-none"
            />
          </div>
        </div>

        {/* Category + Dietary Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  category === c.id ? "bg-espresso text-porcelain" : "border border-ink/15 bg-porcelain text-ink hover:border-caramel"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <SlidersHorizontal className="h-4 w-4 text-ink/50" />
            <select
              aria-label="Filter by dietary preference"
              value={dietary}
              onChange={(e) => setDietary(e.target.value)}
              className="rounded-full border border-ink/15 bg-porcelain px-3 py-1.5 font-medium"
            >
              <option value="">All Dietary</option>
              <option value="dairy-free">Dairy-Free</option>
              <option value="vegan">Vegan</option>
              <option value="sugar-free">Sugar-Free</option>
              <option value="low-sugar">Low Sugar</option>
              <option value="caffeine-free">Caffeine-Free</option>
              <option value="decaf">Decaf</option>
            </select>
            <select
              aria-label="Exclude allergen"
              value={excludeAllergen}
              onChange={(e) => setExcludeAllergen(e.target.value)}
              className="rounded-full border border-ink/15 bg-porcelain px-3 py-1.5 font-medium"
            >
              <option value="">Exclude Allergen: None</option>
              <option value="dairy">No Dairy</option>
              <option value="tree_nuts">No Tree Nuts</option>
              <option value="gluten">No Gluten</option>
              <option value="oats">No Oats</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className="ceramic-card h-56 animate-pulse rounded-2xl p-5" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="ceramic-card rounded-2xl p-10 text-center">
            <Coffee className="mx-auto h-8 w-8 text-caramel" />
            <p className="mt-2 font-semibold">No menu items match these filters</p>
            <p className="text-sm text-ink/65">Try clearing your search or allergen filter.</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
              const mods = selectedMods[item.id] || [];
              const extraPaise = item.modifiers
                .filter((m) => mods.includes(m.id))
                .reduce((sum, m) => sum + m.priceDeltaPaise, 0);
              const totalUnit = item.pricePaise + extraPaise;

              return (
                <article key={item.id} className="ceramic-card flex flex-col justify-between rounded-2xl p-5">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-caramel">
                          {item.category.replace("_", " ")} · {item.temperature}
                        </span>
                        <h2 className="font-display text-2xl font-semibold text-ink">{item.name}</h2>
                      </div>
                      <span className="font-mono-num text-lg font-bold text-roast">{formatRupees(totalUnit)}</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-ink/75">{item.description}</p>

                    {/* Dietary & Allergens */}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {item.dietaryTags.map((t) => (
                        <span key={t} className="rounded-full bg-sage/20 px-2 py-0.5 text-[10px] font-medium text-ink">
                          {t}
                        </span>
                      ))}
                      {item.allergens.map((a) => (
                        <span key={a} className="rounded-full border border-coral/30 bg-coral/10 px-2 py-0.5 text-[10px] font-medium text-coral">
                          Contains {a.replace("_", " ")}
                        </span>
                      ))}
                    </div>

                    {/* Modifiers */}
                    {item.modifiers.length > 0 && item.isAvailable && (
                      <div className="mt-3 space-y-1.5 border-t border-ink/10 pt-3">
                        <p className="text-[11px] font-semibold text-ink/65">Customize (recipe-aware):</p>
                        {item.modifiers.map((m) => (
                          <label key={m.id} className="flex cursor-pointer items-center justify-between text-xs">
                            <span className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={mods.includes(m.id)}
                                onChange={() => toggleMod(item.id, m.id)}
                                className="accent-caramel"
                              />
                              {m.name}
                            </span>
                            <span className="font-mono-num text-ink/65">+{formatRupees(m.priceDeltaPaise)}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 space-y-2.5 border-t border-ink/10 pt-3">
                    <div className="flex items-center justify-between text-xs">
                      <span
                        className={`rounded-full px-2.5 py-0.5 font-semibold ${
                          !item.isAvailable
                            ? "bg-coral/15 text-coral"
                            : item.availableServings <= 3
                            ? "bg-caramel/25 text-roast"
                            : "bg-success/15 text-success"
                        }`}
                      >
                        {item.isAvailable
                          ? `${item.availableServings} servings possible`
                          : item.active
                          ? `Sold out (${item.limitingIngredientName || "stock"})`
                          : "Paused by staff"}
                      </span>
                      <span className="font-mono-num text-[11px] text-ink/55">{item.prepWorkUnits} prep units</span>
                    </div>

                    <button
                      type="button"
                      disabled={!item.isAvailable}
                      onClick={() => {
                        addItem({
                          menuItemId: item.id,
                          name: item.name,
                          qty: 1,
                          unitPricePaise: totalUnit,
                          selectedModifierIds: mods,
                          modifierNames: item.modifiers.filter((m) => mods.includes(m.id)).map((m) => m.name),
                        });
                        setDrawerOpen(true);
                      }}
                      className="w-full rounded-full bg-espresso py-2.5 text-xs font-semibold text-porcelain transition hover:bg-roast disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/50"
                    >
                      {item.isAvailable ? `Add to Tray · ${formatRupees(totalUnit)}` : "Currently Unavailable"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
