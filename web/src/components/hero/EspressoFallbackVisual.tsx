"use client";

import React from "react";
import { CafeOverview, TableItem } from "@/lib/types";

interface Props {
  scrollProgress?: number;
  overview: CafeOverview | null;
  tables: TableItem[];
  reason?: string;
}

/**
 * Editorial photography fallback when WebGL is unavailable, disabled, or reduced-motion is active.
 * Also renders immediately as the fast LCP poster while 3D hydrates.
 */
export function EspressoFallbackVisual({ scrollProgress = 0, overview, tables, reason }: Props) {
  const freeCount = tables.filter((t) => t.status === "free").length || overview?.freeSeatsCount || 8;
  const sceneShift = Math.min(1, Math.max(0, scrollProgress));

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-espresso"
      data-testid="hero-fallback-visual"
      aria-hidden="true"
    >
      <img
        src="/images/hero-espresso-poster.webp"
        alt=""
        className="h-full w-full object-cover object-center transition-transform duration-700"
        style={{
          transform: `scale(${1.02 + sceneShift * 0.05}) translateY(${-sceneShift * 14}px)`,
        }}
      />

      {/* Warm morning editorial vignette ensuring legible typography */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(105deg, rgba(24,15,10,0.88) 0%, rgba(36,23,16,0.58) 42%, rgba(24,15,10,0.22) 76%, rgba(24,15,10,0.55) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(24,15,10,0.45) 0%, rgba(24,15,10,0.0) 30%, rgba(24,15,10,0.65) 100%)",
        }}
      />

      {reason && (
        <span className="sr-only">
          Static editorial espresso view active ({reason}). {freeCount} tables currently open.
        </span>
      )}
    </div>
  );
}
