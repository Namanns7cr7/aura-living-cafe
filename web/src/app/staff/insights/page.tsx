"use client";

import React, { useState } from "react";
import { Check, CheckCircle2, Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { StaffGate } from "@/components/StaffGate";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { OpsInsightResponse } from "@/lib/types";

const SAMPLE_QUESTIONS = [
  "What ingredients will run out this afternoon and what in-stock drinks should we promote?",
  "Analyze current demand leaders and recommend restock quantities.",
  "Explain any current recipe shortages and safe customer substitutes.",
];

export default function StaffInsightsPage() {
  const { user, token } = useAuth();
  const [question, setQuestion] = useState(SAMPLE_QUESTIONS[0]);
  const [insight, setInsight] = useState<OpsInsightResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isManager = user?.role === "manager";

  const askOpsAgent = async (q?: string) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<OpsInsightResponse>("/api/v1/agent/ops-insights", {
        method: "POST",
        token,
        body: { question: (q ?? question).trim() },
      });
      setInsight(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not run inventory operations analysis.");
    } finally {
      setLoading(false);
    }
  };

  const decideRec = async (recId: string, decision: "approved" | "dismissed") => {
    if (!token) return;
    setError(null);
    try {
      await apiRequest(`/api/v1/staff/recommendations/${recId}/decide`, {
        method: "POST",
        token,
        body: { decision, note: "Decided in AI Ops Insights" },
      });
      setNotice(
        `Recommendation ${decision}. ${decision === "approved" ? "Customer banner updated if applicable." : ""}`
      );
      setInsight((prev) =>
        prev
          ? {
              ...prev,
              proposedRecommendations: prev.proposedRecommendations.map((r) =>
                r.id === recId ? { ...r, status: decision } : r
              ),
            }
          : null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Manager role required to approve recommendations.");
    }
  };

  return (
    <StaffGate>
      <div className="min-h-screen bg-cream text-espresso">
        <Navbar variant="staff" />
        <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
          <div className="border-b border-espresso/10 pb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-caramel">
              Google ADK · Inventory Operations Agent
            </p>
            <h1 className="font-display mt-1 text-4xl font-semibold sm:text-5xl">AI Operational Intelligence</h1>
            <p className="mt-1 text-sm text-roast/75">
              Tool-grounded shortage analysis, restock sizing, and in-stock substitute recommendations. Strictly approval-only — AI never mutates inventory.
            </p>
          </div>

          <section className="ceramic-card space-y-4 rounded-3xl p-6">
            <div className="flex flex-wrap gap-2">
              {SAMPLE_QUESTIONS.map((sq) => (
                <button
                  key={sq}
                  type="button"
                  onClick={() => {
                    setQuestion(sq);
                    askOpsAgent(sq);
                  }}
                  className="rounded-full border border-espresso/15 bg-cream/75 px-3.5 py-1.5 text-xs font-medium text-espresso transition hover:border-caramel"
                >
                  {sq}
                </button>
              ))}
            </div>

            <form
              className="flex flex-col gap-3 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                askOpsAgent();
              }}
            >
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="flex-1 rounded-2xl border border-espresso/15 bg-white px-4 py-3 text-sm"
                placeholder="Ask about stock risk, demand, or safe substitutes..."
              />
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-espresso px-6 py-3 text-sm font-semibold text-cream hover:bg-roast disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {loading ? "Analyzing..." : "Analyze Operations"}
              </button>
            </form>
          </section>

          {notice && (
            <div className="flex items-center gap-2 rounded-xl border border-sage/45 bg-sage/15 px-4 py-3 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> {notice}
            </div>
          )}
          {error && <p className="rounded-xl bg-coral/10 p-3 text-sm text-coral">{error}</p>}

          {insight && (
            <div className="space-y-6">
              <div className="ceramic-card rounded-3xl p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-espresso px-3 py-1 text-[11px] font-semibold uppercase text-milk">
                    <Sparkles className="h-3.5 w-3.5 text-caramel-light" />
                    {insight.source === "gemini" ? `Gemini ADK · ${insight.modelId}` : "Deterministic Verified Analysis"}
                  </span>
                  <span className="flex items-center gap-1 text-xs font-medium text-success">
                    <ShieldCheck className="h-4 w-4" /> Manager Approval Required for All Actions
                  </span>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-espresso">{insight.summary}</p>
              </div>

              {insight.proposedRecommendations.length > 0 && (
                <section className="space-y-3">
                  <h2 className="font-display text-2xl font-semibold">Proposed Actions (Approval-Gated)</h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    {insight.proposedRecommendations.map((r) => (
                      <div key={r.id} className="ceramic-card flex flex-col justify-between rounded-2xl p-5">
                        <div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="rounded-full bg-milk px-2.5 py-0.5 font-semibold uppercase text-roast">
                              {r.type.replace("_", " ")}
                            </span>
                            <span className="capitalize text-roast/65">{r.status}</span>
                          </div>
                          <h3 className="mt-3 font-semibold text-espresso">{r.title}</h3>
                          <p className="mt-1 text-xs text-roast/80">{r.rationale}</p>
                          <p className="mt-2 rounded-lg bg-cream p-2.5 text-xs font-medium text-roast">
                            Action: {r.suggestedAction}
                          </p>
                        </div>
                        {isManager && r.status === "pending" && (
                          <div className="mt-4 flex gap-2">
                            <button
                              type="button"
                              onClick={() => decideRec(r.id, "approved")}
                              className="inline-flex items-center gap-1 rounded-full bg-success px-4 py-1.5 text-xs font-semibold text-white"
                            >
                              <Check className="h-3.5 w-3.5" /> Approve Action
                            </button>
                            <button
                              type="button"
                              onClick={() => decideRec(r.id, "dismissed")}
                              className="inline-flex items-center gap-1 rounded-full border border-espresso/20 px-4 py-1.5 text-xs font-medium"
                            >
                              <X className="h-3.5 w-3.5" /> Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div className="grid gap-6 md:grid-cols-2">
                <div className="ceramic-card rounded-2xl p-5">
                  <h3 className="font-display text-xl font-semibold">Tightest Servings</h3>
                  <ul className="mt-3 space-y-2 text-xs">
                    {insight.servingsAtRisk.map((s) => (
                      <li key={s.menuItemId} className="flex justify-between rounded-lg bg-cream/75 px-3 py-2">
                        <span className="font-semibold">{s.name}</span>
                        <span className="font-mono-num text-coral">
                          {s.availableServings} left ({s.limitingIngredient})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="ceramic-card rounded-2xl p-5">
                  <h3 className="font-display text-xl font-semibold">Top Demand Leaders</h3>
                  <ul className="mt-3 space-y-2 text-xs">
                    {insight.demandLeaders.map((d) => (
                      <li key={d.menuItemId} className="flex justify-between rounded-lg bg-cream/75 px-3 py-2">
                        <span className="font-semibold">{d.name}</span>
                        <span className="font-mono-num">
                          {d.unitsOrdered} cups · ₹{Math.round(d.revenueRupees)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </StaffGate>
  );
}
