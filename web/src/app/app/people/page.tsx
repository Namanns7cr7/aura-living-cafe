"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Lock, Plus, Shield, Users, X } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { CommunitySessionView } from "@/lib/types";

export default function PeoplePage() {
  const { user, token } = useAuth();
  const [discoverable, setDiscoverable] = useState(false);
  const [sessions, setSessions] = useState<CommunitySessionView[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Create session form
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [tagsText, setTagsText] = useState("AI, coffee");
  const [zoneHint, setZoneHint] = useState<"quiet" | "window" | "social" | "bar">("social");
  const [meetingNote, setMeetingNote] = useState("");

  const loadSessions = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const qs = tagFilter ? `?tag=${encodeURIComponent(tagFilter)}` : "";
      const res = await apiRequest<{ discoverableInConnect: boolean; sessions: CommunitySessionView[] }>(
        `/api/v1/customer/sessions${qs}`,
        { token }
      );
      setDiscoverable(res.discoverableInConnect);
      setSessions(res.sessions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sessions.");
    } finally {
      setLoading(false);
    }
  }, [token, tagFilter]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const toggleOptIn = async (next: boolean) => {
    if (!token) return;
    setError(null);
    await apiRequest("/api/v1/customer/preferences", {
      method: "PUT",
      token,
      body: { discoverableInConnect: next, consentGranted: next },
    });
    setDiscoverable(next);
  };

  const joinSession = async (id: string) => {
    if (!token) return;
    setError(null);
    try {
      await apiRequest(`/api/v1/customer/sessions/${id}/join`, {
        method: "POST",
        token,
        body: { note: "Would love to join this table!" },
      });
      await loadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Join request failed.");
    }
  };

  const leaveSession = async (id: string) => {
    if (!token) return;
    await apiRequest(`/api/v1/customer/sessions/${id}/leave`, { method: "POST", token });
    await loadSessions();
  };

  const decideJoin = async (sessionId: string, targetUserId: string, approve: boolean) => {
    if (!token) return;
    await apiRequest(`/api/v1/customer/sessions/${sessionId}/decide`, {
      method: "POST",
      token,
      body: { targetUserId, approve },
    });
    await loadSessions();
  };

  const createSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    try {
      await apiRequest("/api/v1/customer/sessions", {
        method: "POST",
        token,
        body: {
          title,
          description: desc,
          tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
          zoneHint,
          meetingNoteForApproved: meetingNote || "Look for the AURA table tent in the zone.",
          joinPolicy: "approval",
        },
      });
      setTitle("");
      setDesc("");
      setMeetingNote("");
      setShowCreate(false);
      await loadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create session.");
    }
  };

  return (
    <div className="min-h-screen bg-oat text-ink">
      <Navbar variant="app" />
      <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-caramel">Opt-In Café Community</p>
            <h1 className="font-display mt-1 text-4xl font-semibold">Connect</h1>
            <p className="text-sm text-ink/70">
              Discover interest-based sessions without exposing exact seats or identities. Member lists stay in private subcollections.
            </p>
          </div>
          {user && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="ceramic-card flex cursor-pointer items-center gap-2.5 rounded-full px-4 py-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={discoverable}
                  onChange={(e) => toggleOptIn(e.target.checked)}
                  className="accent-caramel"
                />
                Opt-in to Connect Hosting
              </label>
              <button
                type="button"
                disabled={!discoverable}
                onClick={() => setShowCreate((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full bg-espresso px-4 py-2 text-xs font-semibold text-porcelain hover:bg-roast disabled:opacity-45"
              >
                <Plus className="h-4 w-4" /> Host a Session
              </button>
            </div>
          )}
        </div>

        {/* Privacy Promise Strip */}
        <div className="flex items-center gap-2.5 rounded-2xl border border-sage/40 bg-sage/15 px-4 py-3 text-xs text-ink">
          <Shield className="h-4 w-4 shrink-0 text-success" />
          <span>
            <strong>Privacy-by-Design:</strong> No background tracking, no emotion inference, no public member lists. Meeting notes appear only after host approval.
          </span>
        </div>

        {!user ? (
          <div className="ceramic-card rounded-2xl p-8 text-center">
            <Users className="mx-auto h-8 w-8 text-caramel" />
            <h2 className="font-display mt-2 text-2xl font-semibold">Sign in to explore opt-in sessions</h2>
            <p className="mt-1 text-sm text-ink/70">Try Ananya or Rohan from the demo sign-in screen to test join requests and host approvals.</p>
            <Link href="/login?next=/app/people" className="mt-4 inline-block rounded-full bg-espresso px-6 py-2.5 text-sm font-semibold text-porcelain">
              Sign in
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div className="rounded-xl border border-coral/40 bg-coral/10 p-3.5 text-sm text-coral" role="alert">
                {error}
              </div>
            )}

            {showCreate && (
              <form onSubmit={createSession} className="ceramic-card space-y-3 rounded-2xl p-6">
                <h2 className="font-display text-2xl font-semibold">Host an Opt-In Café Session</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Session title (e.g., Sunday Sketch & Espresso)"
                    className="rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm"
                  />
                  <input
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    placeholder="Tags comma-separated (AI, design, reading)"
                    className="rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm"
                  />
                </div>
                <textarea
                  required
                  rows={2}
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="What brings this group together?"
                  className="w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    value={zoneHint}
                    onChange={(e) => setZoneHint(e.target.value as "quiet" | "window" | "social" | "bar")}
                    className="rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm"
                  >
                    <option value="social">Social Zone</option>
                    <option value="window">Window Zone</option>
                    <option value="quiet">Quiet Zone</option>
                    <option value="bar">Bar Counter</option>
                  </select>
                  <input
                    value={meetingNote}
                    onChange={(e) => setMeetingNote(e.target.value)}
                    placeholder="Private meeting note (revealed ONLY after you approve)"
                    className="rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm"
                  />
                </div>
                <button type="submit" className="rounded-full bg-caramel px-6 py-2 text-xs font-bold text-espresso">
                  Publish Session
                </button>
              </form>
            )}

            {/* Tag filter chips */}
            <div className="flex flex-wrap gap-2">
              {["", "AI", "reading", "design", "coffee"].map((tag) => (
                <button
                  key={tag || "all"}
                  type="button"
                  onClick={() => setTagFilter(tag)}
                  className={`rounded-full px-3.5 py-1 text-xs font-semibold ${
                    tagFilter === tag ? "bg-espresso text-porcelain" : "border border-ink/15 bg-porcelain text-ink"
                  }`}
                >
                  {tag ? `#${tag}` : "All Topics"}
                </button>
              ))}
            </div>

            {loading ? (
              <p className="text-sm text-ink/60">Loading sessions...</p>
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                {sessions.map((s) => (
                  <article key={s.id} className="ceramic-card flex flex-col justify-between rounded-2xl p-6">
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="rounded-full bg-oat px-2.5 py-0.5 font-semibold capitalize text-roast">
                          {s.zoneHint} zone · {s.startTimeLabel}
                        </span>
                        <span className="font-mono-num text-ink/65">
                          {s.memberCount}/{s.maxMembers} joined · {s.joinPolicy === "open" ? "Open" : "Host Approval"}
                        </span>
                      </div>
                      <h2 className="font-display mt-3 text-2xl font-semibold">{s.title}</h2>
                      <p className="mt-1 text-xs text-ink/60">Hosted by {s.hostDisplayName}</p>
                      <p className="mt-2 text-sm text-ink/80">{s.description}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {s.tags.map((t) => (
                          <span key={t} className="rounded-full bg-sage/20 px-2.5 py-0.5 text-[11px] font-medium">
                            #{t}
                          </span>
                        ))}
                      </div>

                      {s.meetingNote ? (
                        <div className="mt-4 rounded-xl border border-success/40 bg-success/10 p-3 text-xs text-ink">
                          <strong className="text-success">Approved Meeting Details:</strong> {s.meetingNote}
                        </div>
                      ) : (
                        <p className="mt-4 flex items-center gap-1.5 text-xs text-ink/55">
                          <Lock className="h-3.5 w-3.5" /> Exact meeting note hidden until host approves your request.
                        </p>
                      )}

                      {/* Host Approval Queue */}
                      {s.isHost && s.pendingRequests.length > 0 && (
                        <div className="mt-4 space-y-2 rounded-xl border border-caramel/40 bg-caramel/10 p-3 text-xs">
                          <p className="font-semibold text-roast">Pending Join Requests ({s.pendingRequests.length})</p>
                          {s.pendingRequests.map((r) => (
                            <div key={r.userId} className="flex items-center justify-between gap-2 rounded-lg bg-porcelain px-3 py-2">
                              <div>
                                <p className="font-semibold">{r.displayName}</p>
                                {r.note && <p className="text-ink/65">{r.note}</p>}
                              </div>
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => decideJoin(s.id, r.userId, true)}
                                  className="rounded-full bg-success p-1.5 text-white"
                                  aria-label={`Approve ${r.displayName}`}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => decideJoin(s.id, r.userId, false)}
                                  className="rounded-full bg-coral p-1.5 text-white"
                                  aria-label={`Decline ${r.displayName}`}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-5 flex items-center justify-end gap-2 border-t border-ink/10 pt-3">
                      {s.isHost ? (
                        <span className="text-xs font-semibold text-caramel">You are the host</span>
                      ) : s.isApprovedMember ? (
                        <button
                          type="button"
                          onClick={() => leaveSession(s.id)}
                          className="rounded-full border border-coral px-4 py-1.5 text-xs font-semibold text-coral hover:bg-coral/10"
                        >
                          Leave Session
                        </button>
                      ) : s.isPending ? (
                        <button
                          type="button"
                          onClick={() => leaveSession(s.id)}
                          className="rounded-full border border-ink/20 px-4 py-1.5 text-xs font-medium text-ink/70"
                        >
                          Request Pending (Cancel)
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => joinSession(s.id)}
                          className="rounded-full bg-espresso px-5 py-2 text-xs font-semibold text-porcelain hover:bg-roast"
                        >
                          {s.joinPolicy === "open" ? "Join Session" : "Request to Join"}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
