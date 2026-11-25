import { PartIcon, Icon } from "./icons";
import { dateKey, dayStats, formatMinutes, partAt } from "./logic";
import type { StorageAdapter } from "./storage";
import { BUCKETS, BUCKET_LABEL, PART_LABEL, type Part, type Task, type PlannerState } from "./types";
import { usePlanner } from "./usePlanner";
import { useEffect, useState } from "react";

export interface CardConfig {
  title?: string;
  /** "auto" follows the clock; otherwise pin one day part. */
  part?: Part | "auto";
  /** Hide the Could and Won't buckets to keep the card short. */
  hide_low_priority?: boolean;
}

/** Compact Lovelace card: the current day part's tasks with check-offs. */
export function TodayCard({ adapter, config }: { adapter: StorageAdapter; config: CardConfig }) {
  const { state, status, update } = usePlanner(adapter);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  if (status !== "ready" || !state) {
    return <div className="center-note small">{status === "error" ? "Could not load the planner." : "Loading…"}</div>;
  }

  const today = dateKey(now);
  const part: Part = config.part && config.part !== "auto" ? config.part : partAt(now, state.settings.starts);
  const tasks = state.days[today] ?? [];
  const stats = dayStats(tasks, state.settings);
  const buckets = config.hide_low_priority ? BUCKETS.slice(0, 2) : BUCKETS.slice(0, 3);
  const list = tasks
    .filter((t) => t.part === part && buckets.includes(t.bucket))
    .sort((a, b) => BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket) || Number(a.done) - Number(b.done) || a.created - b.created);
  const ps = stats.parts[part];

  const toggle = (t: Task) =>
    update((s: PlannerState) => ({
      ...s,
      days: { ...s.days, [today]: (s.days[today] ?? []).map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) },
    }));

  return (
    <div className="mini-card">
      <header>
        <span className="mc-title">
          <PartIcon part={part} size={18} /> {config.title ?? PART_LABEL[part]}
        </span>
        <span className="mc-meta">
          {formatMinutes(ps.done)} / {formatMinutes(ps.planned)}
        </span>
      </header>
      <div className="bar" aria-hidden="true">
        <div className="bar-fill accent" style={{ width: `${stats.progress}%` }} />
      </div>
      <ul className="mc-list">
        {list.map((t) => (
          <li key={t.id} className={t.done ? "done" : ""}>
            <button className="check" role="checkbox" aria-checked={t.done} aria-label={t.title} onClick={() => toggle(t)}>
              {t.done && <Icon name="check" size={13} />}
            </button>
            <span className={`dot b-${t.bucket}`} title={BUCKET_LABEL[t.bucket]} />
            <span className="mc-task">{t.title}</span>
            {t.minutes > 0 && <span className="chip">{formatMinutes(t.minutes)}</span>}
          </li>
        ))}
        {list.length === 0 && <li className="empty">Nothing planned for this part of the day.</li>}
      </ul>
    </div>
  );
}
