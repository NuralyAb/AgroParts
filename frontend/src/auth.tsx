import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";
import type { Me } from "./types";

interface AuthState {
  user: Me | null;
  ready: boolean;
  login: (phone: string, password: string) => Promise<Me>;
  register: (data: { phone: string; password: string; name: string }) => Promise<Me>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      setUser(await api<Me>("/auth/me"));
    } catch {
      setToken(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setReady(true));
  }, [refresh]);

  const accept = (r: { token: string; user: Me }) => {
    setToken(r.token);
    setUser(r.user);
    return r.user;
  };

  const value: AuthState = {
    user,
    ready,
    refresh,
    login: async (phone, password) => accept(await api("/auth/login", { body: { phone, password } })),
    register: async (data) => accept(await api("/auth/register", { body: data })),
    logout: () => {
      setToken(null);
      setUser(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}

export const isCatalogEditor = (u: Me | null) => u?.role === "admin" || u?.role === "content_manager";
