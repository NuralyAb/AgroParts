import { useCallback, useEffect, useRef, useState } from "react";

const TOKEN_KEY = "agroparts.token";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* приватный режим — токен живёт до перезагрузки */
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(query: Query): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

interface Options {
  method?: string;
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  if (!res.ok) {
    let message = res.statusText || "Ошибка сервера";
    let code: string | undefined;
    try {
      const j = await res.json();
      code = j.code;
      if (typeof j.detail === "string") message = j.detail;
      else if (Array.isArray(j.detail)) message = j.detail.map((d: { msg: string }) => d.msg).join("; ");
    } catch {
      /* не JSON */
    }
    if (res.status === 401 && token) setToken(null);
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return "Нет связи с сервером. Запущен ли backend?";
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Загрузка данных с перезапросом при смене пути. path = null — не загружать. */
export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (path === null) {
      setLoading(false);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(errorText(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
