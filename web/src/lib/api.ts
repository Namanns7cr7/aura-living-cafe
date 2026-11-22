import { subscribeFirestoreSnapshots } from "./firebase-live";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080").replace(/\/$/, "");
const CAFE_ID = process.env.NEXT_PUBLIC_CAFE_ID || "demo-cafe";

export function getApiBase(): string {
  return API_BASE;
}

export function getCafeId(): string {
  return CAFE_ID;
}

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    token?: string | null;
    body?: unknown;
  } = {}
): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${API_BASE}${path}${sep}cafeId=${encodeURIComponent(CAFE_ID)}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const detailObj = (parsed as { detail?: unknown })?.detail;
    const msg =
      typeof detailObj === "string"
        ? detailObj
        : typeof (detailObj as { message?: string })?.message === "string"
        ? (detailObj as { message: string }).message
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, detailObj);
  }

  return parsed as T;
}

/**
 * Resilient live sync:
 *  1. Uses client-side Firestore onSnapshot listeners when Firebase web config is present.
 *  2. Uses SSE with auto-reconnect AND a gentle 10s polling fallback for local / multi-instance resilience.
 */
export function subscribeCafeEvents(
  onEvent: (eventType: string, data?: unknown) => void,
  options?: { userId?: string | null; isStaff?: boolean }
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const cleanups: (() => void)[] = [];

  // 1. Real Firestore onSnapshot listeners when configured
  const fsUnsub = subscribeFirestoreSnapshots((src) => onEvent(src), options);
  if (fsUnsub) {
    cleanups.push(fsUnsub);
  }

  // 2. SSE with auto-reconnect (for immediate local/single-instance push)
  let closed = false;
  let es: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const connectSse = () => {
    if (closed || typeof EventSource === "undefined") return;
    const url = `${API_BASE}/api/v1/public/events?cafeId=${encodeURIComponent(CAFE_ID)}`;
    es = new EventSource(url);
    const types = [
      "order_created",
      "order_updated",
      "inventory_updated",
      "table_updated",
      "demo_updated",
      "recommendation_updated",
    ];
    for (const t of types) {
      es.addEventListener(t, (ev: MessageEvent) => {
        attempt = 0;
        try {
          onEvent(t, JSON.parse(ev.data));
        } catch {
          onEvent(t, ev.data);
        }
      });
    }
    es.onerror = () => {
      es?.close();
      es = null;
      if (!closed) {
        const delay = Math.min(15000, 1500 * Math.pow(2, attempt++));
        reconnectTimer = setTimeout(connectSse, delay);
      }
    };
  };
  connectSse();

  // 3. Lightweight polling fallback (10s) so multi-instance or offline transitions never go stale
  const pollInterval = setInterval(() => {
    if (!document.hidden) {
      onEvent("poll_sync");
    }
  }, 10000);

  cleanups.push(() => {
    closed = true;
    es?.close();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    clearInterval(pollInterval);
  });

  return () => {
    for (const fn of cleanups) fn();
  };
}

export function formatRupees(paise: number): string {
  const rs = paise / 100;
  return Number.isInteger(rs) ? `₹${rs}` : `₹${rs.toFixed(2)}`;
}
