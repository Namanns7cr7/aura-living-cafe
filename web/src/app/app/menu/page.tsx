"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Coffee, Search, SlidersHorizontal } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { apiRequest, formatRupees, subscribeCafeEvents } from "@/lib/api";
import { useCart } from "@/lib/cart-context";
import { getDrinkPhoto } from "@/lib/coffee-media";
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
    <div className="min-h-screen bg-cream text-espresso">
      <Navbar variant="app" />
      <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-espresso/10 pb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-caramel">Live Recipe-Backed Catalog</p>
            <h1 className="font-display mt-1 text-4xl font-semibold sm:text-5xl">Crafted Menu</h1>
            <p className="mt-1 text-sm text-roast/75">
              Every availability badge is computed directly from live café ingredient stock.
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-roast/45" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search drinks or tasting notes..."
              aria-label="Search menu"
              className="w-full rounded-full border border-espresso/15 bg-porcelain py-2.5 pl-10 pr-4 text-sm focus:border-caramel focus:outline-none"
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
                  category === c.id
                    ? "bg-espresso text-cream"
                    : "border border-espresso/15 bg-porcelain text-espresso hover:border-caramel"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <SlidersHorizontal className="h-4 w-4 text-roast/55" />
            <select
              aria-label="Filter by dietary preference"
              value={dietary}
              onChange={(e) => setDietary(e.target.value)}
              className="rounded-full border border-espresso/15 bg-porcelain px-3.5 py-1.5 font-medium text-espresso"
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
              className="rounded-full border border-espresso/15 bg-porcelain px-3.5 py-1.5 font-medium text-espresso"
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
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className="ceramic-card h-80 animate-pulse rounded-2xl p-5" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="ceramic-card rounded-2xl p-10 text-center">
            <Coffee className="mx-auto h-8 w-8 text-caramel" />
            <p className="mt-2 font-semibold">No menu items match these filters</p>
            <p className="text-sm text-roast/65">Try clearing your search or allergen filter.</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
              const mods = selectedMods[item.id] || [];
              const extraPaise = item.modifiers
                .filter((m) => mods.includes(m.id))
                .reduce((sum, m) => sum + m.priceDeltaPaise, 0);
              const totalUnit = item.pricePaise + extraPaise;
              const photo = getDrinkPhoto(item);

              return (
                <article
                  key={item.id}
                  className="ceramic-card group flex flex-col justify-between overflow-hidden rounded-2xl"
                >
                  <div>
                    <div className="relative aspect-[4/3] overflow-hidden bg-espresso">
                      <img
                        src={photo.src}
                        alt={photo.alt}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                      />
                      <span className="absolute left-3 top-3 rounded-full bg-espresso/80 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-milk backdrop-blur-sm">
                        {item.category.replace("_", " ")} · {item.temperature}
                      </span>
                    </div>

                    <div className="p-5 pb-0">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="font-display text-2xl font-semibold text-espresso">{item.name}</h2>
                        <span className="font-mono-num text-lg font-bold text-roast">{formatRupees(totalUnit)}</span>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-roast/75">{item.description}</p>

                      {item.tastingNotes && item.tastingNotes.length > 0 && (
                        <p className="mt-2 text-[11px] italic text-roast/65">
                          Notes: {item.tastingNotes.join(" · ")}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {item.dietaryTags.map((t) => (
                          <span key={t} className="rounded-full bg-sage/20 px-2 py-0.5 text-[10px] font-medium text-espresso">
                            {t}
                          </span>
                        ))}
                        {item.allergens.map((a) => (
                          <span
                            key={a}
                            className="rounded-full border border-coral/30 bg-coral/10 px-2 py-0.5 text-[10px] font-medium text-coral"
                          >
                            Contains {a.replace("_", " ")}
                          </span>
                        ))}
                      </div>

                      {item.modifiers.length > 0 && item.isAvailable && (
                        <div className="mt-3 space-y-1.5 border-t border-espresso/10 pt-3">
                          <p className="text-[11px] font-semibold text-roast/70">Customize (recipe-aware):</p>
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
                              <span className="font-mono-num text-roast/70">+{formatRupees(m.priceDeltaPaise)}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 space-y-3 border-t border-espresso/10 p-5 pt-3">
                    <div className="flex items-center justify-between text-xs">
                      <span
                        className={`rounded-full px-2.5 py-0.5 font-semibold ${
                          !item.isAvailable
                            ? "bg-coral/15 text-coral"
                            : item.availableServings <= 8
                            ? "bg-caramel/25 text-roast"
                            : "bg-sage/20 text-success"
                        }`}
                      >
                        {item.isAvailable
                          ? `${item.availableServings} servings possible`
                          : item.active
                          ? `Sold out (${item.limitingIngredientName || "stock"})`
                          : "Paused by staff"}
                      </span>
                      <span className="font-mono-num text-[11px] text-roast/60">{item.prepWorkUnits} prep units</span>
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
                      className="w-full rounded-full bg-espresso py-2.5 text-xs font-semibold text-cream transition hover:bg-roast disabled:cursor-not-allowed disabled:bg-espresso/20 disabled:text-roast/50"
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
