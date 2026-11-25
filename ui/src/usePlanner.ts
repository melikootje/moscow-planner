import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeState } from "./logic";
import type { StorageAdapter } from "./storage";
import type { PlannerState } from "./types";

export type Status = "loading" | "ready" | "error";

const SAVE_DELAY = 350;
const ECHO_WINDOW = 1500;

/** Loads state from an adapter, saves edits with a short debounce, and applies outside changes. */
export function usePlanner(adapter: StorageAdapter) {
  const [state, setState] = useState<PlannerState | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const latest = useRef<PlannerState | null>(null);
  const savedJson = useRef("");
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef(0);
  const quietUntil = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback(() => {
    timer.current = undefined;
    const snap = latest.current;
    if (!snap) return;
    inflight.current += 1;
    setSaving(true);
    chain.current = chain.current
      .then(() => adapter.save(snap))
      .then(() => {
        savedJson.current = JSON.stringify(normalizeState(snap));
        setSaveError(null);
      })
      .catch((e: unknown) => setSaveError(e instanceof Error ? e.message : "Could not save"))
      .finally(() => {
        inflight.current -= 1;
        quietUntil.current = Date.now() + ECHO_WINDOW;
        if (inflight.current === 0) setSaving(false);
      });
  }, [adapter]);

  useEffect(() => {
    let alive = true;
    latest.current = null;
    setState(null);
    setStatus("loading");

    const giveUp = window.setTimeout(() => {
      if (alive && latest.current === null) setStatus("error");
    }, 10000);

    adapter
      .load()
      .then((s) => {
        if (!alive) return;
        window.clearTimeout(giveUp);
        latest.current = s;
        savedJson.current = JSON.stringify(normalizeState(s));
        setState(s);
        setStatus("ready");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });

    const unsubscribe = adapter.subscribe?.((incoming) => {
      if (!alive) return;
      const busy = timer.current !== undefined || inflight.current > 0 || Date.now() < quietUntil.current;
      if (busy) return;
      const json = JSON.stringify(normalizeState(incoming));
      if (json === savedJson.current) return;
      savedJson.current = json;
      latest.current = incoming;
      setState(incoming);
    });

    return () => {
      alive = false;
      window.clearTimeout(giveUp);
      unsubscribe?.();
      if (timer.current !== undefined) {
        window.clearTimeout(timer.current);
        flush();
      }
    };
  }, [adapter, flush]);

  const update = useCallback(
    (fn: (s: PlannerState) => PlannerState) => {
      const cur = latest.current;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      latest.current = next;
      setState(next);
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY);
    },
    [flush],
  );

  return { state, status, saving, saveError, update };
}
