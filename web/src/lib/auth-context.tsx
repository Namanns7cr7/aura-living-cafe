"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiRequest } from "./api";
import { AuthUser } from "./types";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  loginDemoPersona: (
    persona: "customer-1" | "customer-2" | "barista-1" | "manager-1",
    staffPasscode?: string
  ) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const STORAGE_KEY = "aura_auth_session_v1";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function hydrate() {
      try {
        const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        if (!raw) {
          if (active) setLoading(false);
          return;
        }
        const saved = JSON.parse(raw) as { token: string; user: AuthUser };
        if (!saved?.token) {
          if (active) setLoading(false);
          return;
        }
        const res = await apiRequest<{ authenticated: boolean; user: AuthUser | null }>("/api/v1/public/me", {
          token: saved.token,
        });
        if (active) {
          if (res.authenticated && res.user) {
            setToken(saved.token);
            setUser(res.user);
          } else {
            localStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch {
        // Keep session gracefully if backend is momentarily unreachable
      } finally {
        if (active) setLoading(false);
      }
    }
    hydrate();
    return () => {
      active = false;
    };
  }, []);

  const loginDemoPersona = useCallback(
    async (persona: "customer-1" | "customer-2" | "barista-1" | "manager-1", staffPasscode?: string) => {
      const res = await apiRequest<{ token: string; user: AuthUser }>("/api/v1/public/demo-login", {
        method: "POST",
        body: { persona, staffPasscode: staffPasscode || undefined },
      });
      setToken(res.token);
      setUser(res.user);
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: res.token, user: res.user }));
      }
      return res.user;
    },
    []
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, loginDemoPersona, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
