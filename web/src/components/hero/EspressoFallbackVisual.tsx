"use client";

import React from "react";
import { CafeOverview, TableItem } from "@/lib/types";

interface Props {
  scrollProgress: number;
  overview: CafeOverview | null;
  tables: TableItem[];
  reason?: string;
}

/**
 * Lightweight, accessible SVG/CSS fallback when WebGL is unavailable, disabled, or reduced-motion is active.
 */
export function EspressoFallbackVisual({ scrollProgress, overview, tables, reason }: Props) {
  const freeCount = tables.filter((t) => t.status === "free").length || overview?.freeSeatsCount || 8;
  const nodes = overview?.ingredientFlowNodes || [
    { id: "espresso", label: "Espresso Roast", servingsEstimate: 120, healthRatio: 0.9, status: "healthy" as const },
    { id: "oat", label: "Barista Oat Milk", servingsEstimate: 8, healthRatio: 0.45, status: "low" as const },
    { id: "cold_brew", label: "Cold Brew", servingsEstimate: 21, healthRatio: 0.85, status: "healthy" as const },
  ];

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-gradient-to-b from-[#120d0b] via-[#1b130f] to-[#261a15]"
      data-testid="hero-fallback-visual"
      aria-hidden="true"
    >
      <svg viewBox="0 0 1200 800" className="h-full w-full object-cover opacity-85" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="cremaGlow" cx="50%" cy="46%" r="50%">
            <stop offset="0%" stopColor="#C88B50" stopOpacity="0.42" />
            <stop offset="52%" stopColor="#5C361E" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#17120F" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="ribbonGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#C88B50" stopOpacity="0.1" />
            <stop offset="50%" stopColor="#E0AC76" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#8B9B7E" stopOpacity="0.45" />
          </linearGradient>
        </defs>

        <rect width="1200" height="800" fill="url(#cremaGlow)" />

        {/* Concentric damped coffee ripples */}
        {[90, 160, 240, 330, 430].map((r, i) => (
          <circle
            key={r}
            cx="600"
            cy={380 - scrollProgress * 40}
            r={r + scrollProgress * 30}
            fill="none"
            stroke="#C88B50"
            strokeWidth={1.6 - i * 0.2}
            strokeOpacity={0.34 - i * 0.05}
          />
        ))}

        {/* Luminous fluid ribbon connecting customer intent to kitchen stock */}
        <path
          d="M 120 560 C 340 420, 480 280, 620 390 C 760 500, 920 320, 1080 260"
          fill="none"
          stroke="url(#ribbonGrad)"
          strokeWidth="3.5"
          strokeLinecap="round"
        />

        {/* Droplet silhouette */}
        <path
          d="M 600 185 C 625 235, 642 268, 642 296 A 42 42 0 1 1 558 296 C 558 268, 575 235, 600 185 Z"
          fill="#261A15"
          stroke="#E0AC76"
          strokeWidth="2"
        />

        {/* Stylized live ingredient nodes */}
        {nodes.slice(0, 5).map((n, idx) => {
          const cx = 240 + idx * 180;
          const cy = 620 - (idx % 2) * 35;
          const rad = 12 + Math.max(0.25, n.healthRatio) * 18;
          const color = n.status === "out" ? "#D86F51" : n.status === "low" ? "#C88B50" : "#8B9B7E";
          return (
            <g key={n.id}>
              <circle cx={cx} cy={cy} r={rad} fill={color} fillOpacity="0.28" stroke={color} strokeWidth="1.5" />
              <circle cx={cx} cy={cy} r={5} fill={color} />
            </g>
          );
        })}
      </svg>

      {reason && (
        <span className="sr-only">
          Static accessible visual mode active ({reason}). {freeCount} tables open.
        </span>
      )}
    </div>
  );
}
