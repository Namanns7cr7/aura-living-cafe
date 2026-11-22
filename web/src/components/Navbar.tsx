"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Armchair,
  ClipboardList,
  Coffee,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Users,
  X,
} from "lucide-react";
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
          ? "border-milk/15 bg-espresso/85 text-cream backdrop-blur-md"
          : "border-espresso/10 bg-porcelain/95 text-espresso backdrop-blur-md"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Wordmark */}
        <Link href="/" className="flex items-center gap-3 focus:outline-none">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-full border ${
              isDark
                ? "border-caramel/40 bg-roast/70 text-milk"
                : "border-espresso/15 bg-espresso text-cream"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <ellipse cx="12" cy="12" rx="6.5" ry="9" transform="rotate(-18 12 12)" />
              <path d="M10.5 4.5 C12.5 9.5, 11.5 14.5, 13.5 19.5" strokeLinecap="round" />
            </svg>
          </span>
          <div className="leading-tight">
            <span className="font-display text-2xl font-semibold tracking-[0.14em]">AURA</span>
            <span
              className={`block text-[10px] uppercase tracking-[0.26em] ${
                isDark ? "text-milk/70" : "text-roast/70"
              }`}
            >
              The Living Café
            </span>
          </div>
        </Link>

        {/* Desktop Navigation */}
        {variant === "public" ? (
          <nav aria-label="Landing navigation" className="hidden items-center gap-7 lg:flex">
            <a href="#scene-experience" className="text-sm text-milk/80 transition hover:text-cream">
              Experience
            </a>
            <a href="#scene-bean-to-cup" className="text-sm text-milk/80 transition hover:text-cream">
              Craft
            </a>
            <a href="#scene-inventory" className="text-sm text-milk/80 transition hover:text-cream">
              Inventory
            </a>
            <Link
              href="/staff"
              className="rounded-full border border-milk/25 px-4 py-1.5 text-sm font-medium text-milk transition hover:border-caramel hover:text-cream"
            >
              Staff Console
            </Link>
            <Link
              href="/app"
              className="rounded-full bg-cream px-5 py-2 text-sm font-semibold text-espresso transition hover:bg-milk"
            >
              Enter the Café
            </Link>
          </nav>
        ) : (
          <nav aria-label="Main navigation" className="hidden items-center gap-1 lg:flex">
            {activeLinks.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname === `${item.href}/`;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-espresso text-cream"
                      : "text-roast/80 hover:bg-cream hover:text-espresso"
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
                className="ml-2 flex items-center gap-1.5 rounded-full border border-caramel/45 bg-caramel/10 px-3.5 py-1.5 text-xs font-semibold text-roast transition hover:bg-caramel/20"
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Staff Console
              </Link>
            )}
            {variant === "staff" && (
              <Link
                href="/app"
                className="ml-2 flex items-center gap-1.5 rounded-full border border-espresso/15 px-3.5 py-1.5 text-xs font-medium text-roast transition hover:bg-cream"
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
                  ? "border border-milk/25 text-cream hover:bg-roast/60"
                  : "border border-espresso/15 bg-cream text-espresso hover:border-caramel"
              }`}
            >
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Tray</span>
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
                  isDark ? "bg-roast text-milk" : "bg-cream text-espresso border border-espresso/10"
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
                  isDark ? "text-milk/70 hover:bg-roast hover:text-cream" : "text-roast/70 hover:bg-cream hover:text-espresso"
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
                  ? "border border-milk/25 text-cream hover:bg-roast/60"
                  : "bg-espresso text-cream hover:bg-roast"
              }`}
            >
              Sign in
            </Link>
          )}

          <button
            type="button"
            className="rounded-lg p-2 lg:hidden"
            aria-label="Toggle navigation menu"
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div
          className={`border-t px-4 py-3 lg:hidden ${
            isDark ? "border-milk/15 bg-espresso text-cream" : "border-espresso/10 bg-porcelain text-espresso"
          }`}
        >
          <div className="flex flex-col gap-2">
            {variant === "public" ? (
              <>
                <Link
                  href="/app"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-full bg-cream px-4 py-2.5 text-center font-semibold text-espresso"
                >
                  Enter the Café
                </Link>
                <Link
                  href="/staff"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-full border border-milk/30 px-4 py-2 text-center text-sm text-milk"
                >
                  Open Staff Console
                </Link>
              </>
            ) : (
              activeLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-cream/60"
                >
                  {item.label}
                </Link>
              ))
            )}
            <div className="mt-2 flex items-center justify-between border-t border-current/10 pt-2">
              {user ? (
                <>
                  <span className="text-xs opacity-80">
                    {user.displayName} ({user.role})
                  </span>
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
