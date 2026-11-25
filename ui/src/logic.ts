import {
  BUCKETS,
  PARTS,
  type Bucket,
  type Part,
  type PlannerState,
  type Settings,
  type Task,
} from "./types";

export const DEFAULT_SETTINGS: Settings = {
  budgets: { morning: 240, afternoon: 300, evening: 180, night: 60 },
  starts: { morning: "06:00", afternoon: "12:00", evening: "18:00", night: "22:00" },
  mustCap: 60,
};

export function emptyState(): PlannerState {
  return { version: 1, settings: structuredCloneSafe(DEFAULT_SETTINGS), days: {} };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

/* ---------- dates ---------- */

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

/** Monday-first week containing the given date. */
export function weekOf(key: string): string[] {
  const d = parseKey(key);
  const offset = (d.getDay() + 6) % 7;
  const start = addDays(key, -offset);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/* ---------- day parts ---------- */

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Day part that contains the given clock time (night wraps past midnight). */
export function partAt(now: Date, starts: Record<Part, string>): Part {
  const minute = now.getHours() * 60 + now.getMinutes();
  const ordered = [...PARTS].sort((a, b) => toMinutes(starts[a]) - toMinutes(starts[b]));
  let current = ordered[ordered.length - 1];
  for (const p of ordered) {
    if (toMinutes(starts[p]) <= minute) current = p;
  }
  return current;
}

/* ---------- stats ---------- */

export function weight(t: Task): number {
  return Math.max(t.minutes, 5);
}

export interface PartStat {
  planned: number;
  done: number;
  budget: number;
  over: boolean;
  count: number;
}

export interface DayStats {
  planned: number;
  done: number;
  progress: number;
  mustShare: number;
  mustLevel: "ok" | "warn" | "over";
  mustLeft: number;
  parts: Record<Part, PartStat>;
  counts: Record<Bucket, { total: number; done: number }>;
}

export function dayStats(tasks: Task[], settings: Settings): DayStats {
  const parts = {} as Record<Part, PartStat>;
  for (const p of PARTS) {
    parts[p] = { planned: 0, done: 0, budget: settings.budgets[p], over: false, count: 0 };
  }
  const counts = {} as Record<Bucket, { total: number; done: number }>;
  for (const b of BUCKETS) counts[b] = { total: 0, done: 0 };

  let planned = 0;
  let done = 0;
  let mustMinutes = 0;
  let mustLeft = 0;
  let weighted = 0;
  let weightedDone = 0;

  for (const t of tasks) {
    counts[t.bucket].total += 1;
    if (t.done) counts[t.bucket].done += 1;
    if (t.bucket === "wont") continue;
    planned += t.minutes;
    if (t.done) done += t.minutes;
    parts[t.part].planned += t.minutes;
    parts[t.part].count += 1;
    if (t.done) parts[t.part].done += t.minutes;
    weighted += weight(t);
    if (t.done) weightedDone += weight(t);
    if (t.bucket === "must") {
      mustMinutes += t.minutes;
      if (!t.done) mustLeft += 1;
    }
  }
  for (const p of PARTS) parts[p].over = parts[p].planned > parts[p].budget;

  const mustShare = planned > 0 ? (mustMinutes / planned) * 100 : 0;
  const mustLevel = mustShare <= settings.mustCap ? "ok" : mustShare <= settings.mustCap + 10 ? "warn" : "over";
  const progress = weighted > 0 ? Math.round((weightedDone / weighted) * 100) : 0;
  return { planned, done, progress, mustShare, mustLevel, mustLeft, parts, counts };
}

/** First unfinished Must, starting from the given part and wrapping through the day. */
export function nextMust(tasks: Task[], from: Part): Task | undefined {
  const start = PARTS.indexOf(from);
  for (let i = 0; i < PARTS.length; i++) {
    const part = PARTS[(start + i) % PARTS.length];
    const hit = tasks.find((t) => t.bucket === "must" && !t.done && t.part === part);
    if (hit) return hit;
  }
  return undefined;
}

export function formatMinutes(min: number): string {
  if (min <= 0) return "0 min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

/* ---------- mutations (pure) ---------- */

export function withDay(state: PlannerState, date: string, tasks: Task[]): PlannerState {
  const days = { ...state.days };
  if (tasks.length === 0) delete days[date];
  else days[date] = tasks;
  return { ...state, days };
}

/** Copy unfinished tasks from the previous day into `date`, keeping their bucket and day part. */
export function carryOver(state: PlannerState, date: string, buckets: Bucket[] = ["must"]): { state: PlannerState; moved: number } {
  const prev = addDays(date, -1);
  const source = (state.days[prev] ?? []).filter((t) => !t.done && buckets.includes(t.bucket));
  const existing = state.days[date] ?? [];
  const have = new Set(existing.map((t) => `${t.title.toLowerCase()}|${t.part}`));
  const fresh = source
    .filter((t) => !have.has(`${t.title.toLowerCase()}|${t.part}`))
    .map((t) => ({ ...t, id: uid(), created: Date.now() }));
  if (fresh.length === 0) return { state, moved: 0 };
  return { state: withDay(state, date, [...existing, ...fresh]), moved: fresh.length };
}

export function exampleDay(): Task[] {
  const now = Date.now();
  const t = (title: string, bucket: Bucket, part: Part, minutes: number, done = false): Task => ({
    id: uid(),
    title,
    bucket,
    part,
    minutes,
    done,
    created: now,
  });
  return [
    t("Review the week's priorities", "must", "morning", 20, true),
    t("Write the project update", "must", "morning", 90),
    t("Call the plumber about the boiler", "must", "afternoon", 15),
    t("Reply to open emails", "should", "morning", 30),
    t("Gym session", "should", "evening", 60),
    t("Tidy the garage shelf", "could", "afternoon", 45),
    t("Read two chapters", "could", "night", 30),
    t("Reorganise the photo archive", "wont", "evening", 120),
  ];
}

/* ---------- validation of loaded data ---------- */

function isPart(v: unknown): v is Part {
  return typeof v === "string" && (PARTS as string[]).includes(v);
}
function isBucket(v: unknown): v is Bucket {
  return typeof v === "string" && (BUCKETS as string[]).includes(v);
}

export function normalizeTask(raw: unknown): Task | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== "string" || !r.title.trim()) return null;
  return {
    id: typeof r.id === "string" && r.id ? r.id : uid(),
    title: r.title.slice(0, 200),
    bucket: isBucket(r.bucket) ? r.bucket : "should",
    part: isPart(r.part) ? r.part : "morning",
    minutes: Number.isFinite(r.minutes) ? Math.max(0, Math.min(1440, Math.round(r.minutes as number))) : 0,
    done: r.done === true,
    created: typeof r.created === "number" ? r.created : Date.now(),
  };
}

export function normalizeState(raw: unknown): PlannerState {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const s = (r.settings ?? {}) as Partial<Settings>;
  for (const p of PARTS) {
    const b = s.budgets?.[p];
    if (typeof b === "number" && b >= 0 && b <= 1440) base.settings.budgets[p] = Math.round(b);
    const st = s.starts?.[p];
    if (typeof st === "string" && /^\d{1,2}:\d{2}/.test(st)) base.settings.starts[p] = st.slice(0, 5).padStart(5, "0");
  }
  if (typeof s.mustCap === "number" && s.mustCap >= 10 && s.mustCap <= 100) base.settings.mustCap = Math.round(s.mustCap);
  const days = (r.days ?? {}) as Record<string, unknown>;
  for (const [key, list] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Array.isArray(list)) continue;
    const tasks = list.map(normalizeTask).filter((t): t is Task => t !== null);
    if (tasks.length) base.days[key] = tasks;
  }
  return base;
}
