"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { loadAll } from "@/lib/data";
import type { AppData, Player } from "@/lib/types";

const K_ME = "cox45:me";

interface Ctx {
  data: AppData | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  me: Player | null;
  setMeId: (id: string | null) => void;
  toast: (msg: string) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [meId, setMeIdState] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await loadAll());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      setMeIdState(localStorage.getItem(K_ME));
    } catch {}
    refresh();
    const iv = setInterval(() => {
      if (!document.hidden) refresh();
    }, 30000);
    const onVis = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const setMeId = useCallback((id: string | null) => {
    setMeIdState(id);
    try {
      if (id) localStorage.setItem(K_ME, id);
      else localStorage.removeItem(K_ME);
    } catch {}
  }, []);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const me = useMemo(() => data?.players.find((p) => p.id === meId) ?? null, [data, meId]);

  const value = useMemo(() => ({ data, error, loading, refresh, me, setMeId, toast }), [data, error, loading, refresh, me, setMeId, toast]);
  return (
    <AppCtx.Provider value={value}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </AppCtx.Provider>
  );
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}
