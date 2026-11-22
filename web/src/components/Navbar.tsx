"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Coffee, LayoutDashboard, LogOut, Menu, ShoppingBag, Users, Armchair, ClipboardList, Sparkles, X, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useCart } from "@/lib/cart-context";

export function Navbar({ variant = "app" }: { variant?: "public" | "app" | "staff" }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { totalCount, setDrawerOpen } = useCart();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isDark = variant === "public";
  const isStaff = user?.role === "barista" || user?.role === "manager";

  const customerLinks = [
    { href: "/app", label: "Concierge", icon: Sparkles },
    { href: "/app/menu", label: "Menu", icon: Coffee },
    { href: "/app/room", label: "Room", icon: Armchair },
    { href: "/app/people", label: "Connect", icon: Users },
    { href: "/app/orders", label: "Orders", icon: ClipboardList },
  ];

  const staffLinks = [
    { href: "/staff", label: "Command Center", icon: LayoutDashboard },
    { href: "/staff/orders", label: "Queue", icon: ClipboardList },
    { href: "/staff/inventory", label: "Inventory Ledger", icon: Coffee },
    { href: "/staff/insights", label: "AI Ops", icon: Sparkles },
  ];

  const activeLinks = variant === "staff" ? staffLinks : customerLinks;

  const handleLogout = () => {
    logout();
    setMobileOpen(false);
    router.push("/login");
  };

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-colors ${
        isDark
          ? "border-caramel/20 bg-espresso/85 text-porcelain backdrop-blur-md"
          : "border-ink/10 bg-porcelain/95 text-ink backdrop-blur-md"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Wordmark */}
        <Link href="/" className="flex items-center gap-2.5 focus:outline-none">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-caramel text-espresso shadow-sm">
            <Coffee className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="leading-tight">
            <span className="font-display text-xl font-semibold tracking-wider">AURA</span>
            <span className={`block text-[10px] uppercase tracking-[0.22em] ${isDark ? "text-caramel-light" : "text-ink/60"}`}>
              The Living Café
            </span>
          </div>
        </Link>

        {/* Desktop Nav */}
        {variant === "public" ? (
          <nav aria-label="Landing navigation" className="hidden items-center gap-7 md:flex">
            <a href="#scene-ripple" className="text-sm text-oat/80 hover:text-caramel-light">
              Experience
            </a>
            <a href="#scene-flow" className="text-sm text-oat/80 hover:text-caramel-light">
              How it works
            </a>
            <a href="#scene-perspectives" className="text-sm text-oat/80 hover:text-caramel-light">
              For cafés
            </a>
            <Link
              href="/staff"
              className="rounded-full border border-caramel/40 px-4 py-1.5 text-sm font-medium text-caramel-light hover:bg-caramel/10"
            >
              Staff Console
            </Link>
            <Link
              href="/app"
              className="rounded-full bg-caramel px-5 py-2 text-sm font-semibold text-espresso shadow-glow hover:bg-caramel-light"
            >
              Enter the Café
            </Link>
          </nav>
        ) : (
          <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
            {activeLinks.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname === `${item.href}/`;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-espresso text-porcelain"
                      : "text-ink/75 hover:bg-oat hover:text-ink"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
            {variant === "app" && isStaff && (
              <Link
                href="/staff"
                className="ml-2 flex items-center gap-1.5 rounded-full border border-caramel/50 bg-caramel/10 px-3.5 py-1.5 text-xs font-semibold text-roast hover:bg-caramel/20"
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Staff Console
              </Link>
            )}
            {variant === "staff" && (
              <Link
                href="/app"
                className="ml-2 flex items-center gap-1.5 rounded-full border border-ink/15 px-3.5 py-1.5 text-xs font-medium text-ink/80 hover:bg-oat"
              >
                Customer View
              </Link>
            )}
          </nav>
        )}

        {/* Right Controls */}
        <div className="flex items-center gap-2.5">
          {variant !== "staff" && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label={`Open cart with ${totalCount} items`}
              className={`relative flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition ${
                isDark
                  ? "border border-caramel/30 text-porcelain hover:bg-caramel/15"
                  : "border border-ink/15 bg-oat text-ink hover:bg-caramel/15"
              }`}
            >
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Cart</span>
              {totalCount > 0 && (
                <span className="font-mono-num flex h-5 min-w-5 items-center justify-center rounded-full bg-caramel px-1.5 text-xs font-bold text-espresso">
                  {totalCount}
                </span>
              )}
            </button>
          )}

          {user ? (
            <div className="hidden items-center gap-2 sm:flex">
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  isDark ? "bg-roast text-caramel-light" : "bg-oat text-ink"
                }`}
              >
                {user.displayName} · <span className="uppercase text-caramel">{user.role}</span>
              </span>
              <button
                type="button"
                onClick={handleLogout}
                title="Sign out"
                aria-label="Sign out"
                className={`rounded-full p-2 transition ${
                  isDark ? "text-oat/70 hover:bg-roast hover:text-porcelain" : "text-ink/70 hover:bg-oat hover:text-ink"
                }`}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                isDark
                  ? "border border-oat/30 text-porcelain hover:bg-oat/10"
                  : "bg-espresso text-porcelain hover:bg-roast"
              }`}
            >
              Sign in
            </Link>
          )}

          <button
            type="button"
            className="rounded-lg p-2 md:hidden"
            aria-label="Toggle navigation menu"
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className={`border-t px-4 py-3 md:hidden ${isDark ? "border-caramel/20 bg-espresso text-porcelain" : "border-ink/10 bg-porcelain text-ink"}`}>
          <div className="flex flex-col gap-2">
            {variant === "public" ? (
              <>
                <Link href="/app" onClick={() => setMobileOpen(false)} className="rounded-lg bg-caramel px-4 py-2.5 text-center font-semibold text-espresso">
                  Enter the Café
                </Link>
                <Link href="/staff" onClick={() => setMobileOpen(false)} className="rounded-lg border border-caramel/40 px-4 py-2 text-center text-sm text-caramel-light">
                  Open Staff Console
                </Link>
              </>
            ) : (
              activeLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-oat/20"
                >
                  {item.label}
                </Link>
              ))
            )}
            <div className="mt-2 flex items-center justify-between border-t border-current/10 pt-2">
              {user ? (
                <>
                  <span className="text-xs opacity-80">{user.displayName} ({user.role})</span>
                  <button type="button" onClick={handleLogout} className="text-xs font-semibold text-coral">
                    Sign out
                  </button>
                </>
              ) : (
                <Link href="/login" onClick={() => setMobileOpen(false)} className="text-sm font-semibold text-caramel">
                  Sign in / Switch Persona
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
