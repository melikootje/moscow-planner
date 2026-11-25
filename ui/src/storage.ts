import { emptyState, normalizeState } from "./logic";
import type { PlannerState } from "./types";

/**
 * Where the planner keeps its data. The UI only talks to this interface, so the same
 * bundle runs inside Home Assistant, as a published artifact, or from a plain page.
 */
export interface StorageAdapter {
  kind: "ha" | "db" | "local";
  load(): Promise<PlannerState>;
  save(state: PlannerState): Promise<void>;
  /** Push updates made elsewhere (other devices, services, automations). Returns an unsubscribe. */
  subscribe?(cb: (state: PlannerState) => void): () => void;
}

/* ---------- local browser storage ---------- */

const LOCAL_KEY = "moscow-planner:v1";

export function createLocalAdapter(): StorageAdapter {
  let memory: string | null = null;
  return {
    kind: "local",
    async load() {
      try {
        const raw = window.localStorage.getItem(LOCAL_KEY);
        if (raw) return normalizeState(JSON.parse(raw));
      } catch {
        if (memory) return normalizeState(JSON.parse(memory));
      }
      return emptyState();
    },
    async save(state) {
      const raw = JSON.stringify(state);
      memory = raw;
      try {
        window.localStorage.setItem(LOCAL_KEY, raw);
      } catch {
        /* storage blocked: memory copy keeps the session working */
      }
    },
  };
}

/* ---------- Home Assistant ---------- */

export interface Hass {
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  connection: {
    subscribeMessage<T>(cb: (msg: T) => void, msg: Record<string, unknown>): Promise<() => void>;
  };
  themes?: { darkMode?: boolean };
}

export function createHaAdapter(getHass: () => Hass | undefined): StorageAdapter {
  let known: PlannerState = emptyState();
  const json = (v: unknown) => JSON.stringify(v);

  return {
    kind: "ha",
    async load() {
      const hass = getHass();
      if (!hass) return emptyState();
      known = normalizeState(await hass.callWS({ type: "moscow_planner/get_state" }));
      return known;
    },
    async save(next) {
      const hass = getHass();
      if (!hass) return;
      if (json(next.settings) !== json(known.settings)) {
        await hass.callWS({ type: "moscow_planner/set_settings", settings: next.settings });
      }
      const dates = new Set([...Object.keys(known.days), ...Object.keys(next.days)]);
      for (const date of dates) {
        const a = known.days[date] ?? [];
        const b = next.days[date] ?? [];
        if (json(a) !== json(b)) {
          await hass.callWS({ type: "moscow_planner/set_day", date, tasks: b });
        }
      }
      known = next;
    },
    subscribe(cb) {
      const hass = getHass();
      let stop: (() => void) | undefined;
      let cancelled = false;
      if (hass) {
        hass
          .connection.subscribeMessage<{ state: unknown }>(
            (msg) => {
              known = normalizeState(msg.state);
              cb(known);
            },
            { type: "moscow_planner/subscribe" },
          )
          .then((unsub) => {
            if (cancelled) unsub();
            else stop = unsub;
          })
          .catch(() => undefined);
      }
      return () => {
        cancelled = true;
        stop?.();
      };
    },
  };
}

/* ---------- Claude artifact database (per-person) ---------- */

interface DbDoc {
  get(): Promise<unknown>;
  set(value: Record<string, unknown>): Promise<unknown>;
}
interface DbNamespace {
  collection(path: string): { doc(id: string): DbDoc };
}
interface UserNamespace {
  id(): Promise<string>;
}
interface ClaudeGlobal {
  use(name: string): Promise<unknown>;
}

/** Resolves to an adapter when the page runs as a Claude artifact with `db` and `user`, otherwise null. */
export async function createDbAdapter(): Promise<StorageAdapter | null> {
  const claude = (window as unknown as { claude?: ClaudeGlobal }).claude;
  if (!claude?.use) return null;
  try {
    const [db, user] = (await Promise.all([claude.use("db"), claude.use("user")])) as [
      DbNamespace | null,
      UserNamespace | null,
    ];
    if (!db || !user) return null;
    const id = await user.id();
    const doc = db.collection(`data/users/${id}`).doc("planner");
    return {
      kind: "db",
      async load() {
        try {
          const snap = (await doc.get()) as { data?: unknown } | null;
          const data = typeof snap?.data === "function" ? (snap.data as () => unknown)() : snap?.data ?? snap;
          const payload = (data as { state?: unknown } | null | undefined)?.state;
          if (typeof payload === "string") return normalizeState(JSON.parse(payload));
        } catch {
          /* no saved document yet: start empty */
        }
        return emptyState();
      },
      async save(state) {
        await doc.set({ state: JSON.stringify(state), updated: Date.now() });
      },
    };
  } catch {
    return null;
  }
}
