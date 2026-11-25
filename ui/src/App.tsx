import { useEffect, useState, type DragEvent, type ReactNode } from "react";
import { Icon, PartIcon } from "./icons";
import {
  addDays,
  carryOver,
  dateKey,
  dayStats,
  exampleDay,
  formatMinutes,
  nextMust,
  normalizeTask,
  parseKey,
  partAt,
  uid,
  weekOf,
  withDay,
} from "./logic";
import type { StorageAdapter } from "./storage";
import {
  BUCKETS,
  BUCKET_HINT,
  BUCKET_KEY,
  BUCKET_LABEL,
  PARTS,
  PART_LABEL,
  type Bucket,
  type Part,
  type PlannerState,
  type Settings,
  type Task,
} from "./types";
import { usePlanner } from "./usePlanner";

const MINUTE_PRESETS = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

const STORAGE_NOTE: Record<StorageAdapter["kind"], string> = {
  ha: "Saved in Home Assistant",
  db: "Saved to your Claude account",
  local: "Saved in this browser only",
};

function useNow(intervalMs = 30000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      PARTS.indexOf(a.part) - PARTS.indexOf(b.part) ||
      Number(a.done) - Number(b.done) ||
      a.created - b.created,
  );
}

/* ====================================================================== */

export function App({ adapter, onMenu }: { adapter: StorageAdapter; onMenu?: () => void }) {
  const { state, status, saving, saveError, update } = usePlanner(adapter);
  const now = useNow();
  const today = dateKey(now);
  const [date, setDate] = useState(today);
  const [view, setView] = useState<Part | "all">("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 3500);
    return () => window.clearTimeout(id);
  }, [note]);

  if (status === "loading") return <div className="center-note">Loading your plans…</div>;
  if (status === "error" || !state) {
    return (
      <div className="center-note">
        <strong>Could not load your plans.</strong>
        <span>Check the connection and reload the page.</span>
      </div>
    );
  }

  const settings = state.settings;
  const tasks = state.days[date] ?? [];
  const stats = dayStats(tasks, settings);
  const nowPart = partAt(now, settings.starts);
  const isToday = date === today;
  const focusPart: Part = isToday ? nowPart : "morning";
  const upNext = nextMust(tasks, focusPart);

  const setTasks = (fn: (t: Task[]) => Task[]) => update((s) => withDay(s, date, fn(s.days[date] ?? [])));

  const addTask = (task: Omit<Task, "id" | "created" | "done">) =>
    setTasks((list) => [...list, { ...task, id: uid(), created: Date.now(), done: false }]);
  const patchTask = (id: string, patch: Partial<Task>) =>
    setTasks((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const removeTask = (id: string) => setTasks((list) => list.filter((t) => t.id !== id));

  const doCarry = () => {
    let moved = 0;
    update((s) => {
      const r = carryOver(s, date);
      moved = r.moved;
      return r.state;
    });
    setNote(moved > 0 ? `Carried over ${moved} unfinished Must ${moved === 1 ? "task" : "tasks"} from yesterday.` : "Nothing to carry over from yesterday.");
  };

  const longDate = parseKey(date).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="app">
      <header className="top">
        {onMenu && (
          <button className="btn icon menu-btn" onClick={onMenu} aria-label="Open Home Assistant menu">
            <Icon name="menu" size={20} />
          </button>
        )}
        <div className="title-block">
          <h1>MoSCoW day planner</h1>
          <p className="sub">
            {longDate}
            {isToday && <span className="pill now-pill">Today</span>}
          </p>
        </div>
        <div className="top-actions">
          <button className="btn icon" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
            <Icon name="chevron-left" />
          </button>
          <button className="btn" onClick={() => setDate(today)} disabled={isToday}>
            Today
          </button>
          <button className="btn icon" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
            <Icon name="chevron-right" />
          </button>
          <button className="btn icon" onClick={() => setSettingsOpen(true)} aria-label="Settings">
            <Icon name="gear" />
          </button>
        </div>
      </header>

      <WeekStrip state={state} date={date} today={today} onPick={setDate} />

      <section className="summary" aria-label="Day summary">
        <div className="tile">
          <span className="tile-label">Progress</span>
          <span className="big">{stats.progress}%</span>
          <div className="bar" role="progressbar" aria-valuenow={stats.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Day progress">
            <div className="bar-fill accent" style={{ width: `${stats.progress}%` }} />
          </div>
          <span className="tile-foot">
            {formatMinutes(stats.done)} done of {formatMinutes(stats.planned)} planned
          </span>
        </div>

        <div className="tile">
          <span className="tile-label">Must share</span>
          <span className={`big lvl-${stats.mustLevel}`}>{Math.round(stats.mustShare)}%</span>
          <div className="bar meter" aria-label="Share of planned time spent on Musts">
            <div className={`bar-fill lvl-bg-${stats.mustLevel}`} style={{ width: `${Math.min(100, stats.mustShare)}%` }} />
            <div className="cap" style={{ left: `${settings.mustCap}%` }} title={`Recommended maximum ${settings.mustCap}%`} />
          </div>
          <span className="tile-foot">
            {stats.mustLevel === "ok" && `Within the ${settings.mustCap}% guide.`}
            {stats.mustLevel === "warn" && `A little above the ${settings.mustCap}% guide.`}
            {stats.mustLevel === "over" && `Well above the ${settings.mustCap}% guide. Move something to Should.`}
          </span>
        </div>

        <div className="tile">
          <span className="tile-label">Next Must</span>
          {upNext ? (
            <>
              <span className="next-title">{upNext.title}</span>
              <span className="tile-foot">
                <PartIcon part={upNext.part} size={14} /> {PART_LABEL[upNext.part]}
                {upNext.minutes > 0 && ` · ${formatMinutes(upNext.minutes)}`}
              </span>
              <button className="btn small" onClick={() => patchTask(upNext.id, { done: true })}>
                <Icon name="check" size={14} /> Mark done
              </button>
            </>
          ) : stats.counts.must.total > 0 ? (
            <span className="next-title calm">Every Must is done.</span>
          ) : (
            <span className="next-title calm">No Musts planned yet.</span>
          )}
        </div>
      </section>

      <PartBar
        view={view}
        onView={setView}
        stats={stats}
        nowPart={isToday ? nowPart : null}
        onDropPart={(id, part) => patchTask(id, { part })}
      />

      <main className="board" aria-label="MoSCoW board">
        {BUCKETS.map((bucket) => (
          <Column
            key={bucket}
            bucket={bucket}
            tasks={sortTasks(tasks.filter((t) => t.bucket === bucket && (view === "all" || t.part === view)))}
            showPart={view === "all"}
            defaultPart={view === "all" ? focusPart : view}
            onAdd={addTask}
            onPatch={patchTask}
            onRemove={removeTask}
          />
        ))}
      </main>

      <footer className="foot">
        <div className="foot-actions">
          <button className="btn" onClick={doCarry}>
            <Icon name="carry" size={14} /> Carry over yesterday's Musts
          </button>
          {tasks.length === 0 && (
            <button className="btn" onClick={() => setTasks(() => exampleDay())}>
              Load example day
            </button>
          )}
          {tasks.some((t) => t.done) && (
            <button className="btn" onClick={() => setTasks((l) => l.filter((t) => !t.done))}>
              Clear finished
            </button>
          )}
          {tasks.length > 0 && <ConfirmButton label="Clear day" confirmLabel="Confirm: clear all tasks" onConfirm={() => setTasks(() => [])} />}
        </div>
        <p className={`save-state${saveError ? " bad" : ""}`} role="status">
          {saveError ? `Not saved: ${saveError}` : saving ? "Saving…" : STORAGE_NOTE[adapter.kind]}
        </p>
      </footer>

      {note && (
        <div className="toast" role="status">
          {note}
        </div>
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => {
            update((s) => ({ ...s, settings: next }));
            setSettingsOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ====================================================================== */

function WeekStrip({ state, date, today, onPick }: { state: PlannerState; date: string; today: string; onPick: (d: string) => void }) {
  const days = weekOf(date);
  return (
    <nav className="week" aria-label="Week">
      {days.map((d) => {
        const list = state.days[d] ?? [];
        const s = dayStats(list, state.settings);
        const past = d < today;
        const flag = past && s.mustLeft > 0;
        const dt = parseKey(d);
        return (
          <button
            key={d}
            className={`day${d === date ? " sel" : ""}${d === today ? " today" : ""}`}
            onClick={() => onPick(d)}
            aria-label={`${dt.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}${flag ? `, ${s.mustLeft} Must unfinished` : ""}`}
            aria-current={d === date ? "date" : undefined}
          >
            <span className="dow">{WEEKDAY[dt.getDay()]}</span>
            <span className="dom">{dt.getDate()}</span>
            <span className="mini" aria-hidden="true">
              <span style={{ width: `${list.length ? s.progress : 0}%` }} />
            </span>
            <span className={`flag${flag ? " on" : ""}`} aria-hidden="true">
              {flag ? `${s.mustLeft}` : ""}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function PartBar({
  view,
  onView,
  stats,
  nowPart,
  onDropPart,
}: {
  view: Part | "all";
  onView: (v: Part | "all") => void;
  stats: ReturnType<typeof dayStats>;
  nowPart: Part | null;
  onDropPart: (id: string, part: Part) => void;
}) {
  const [hover, setHover] = useState<Part | null>(null);
  const drop = (e: DragEvent, part: Part) => {
    e.preventDefault();
    setHover(null);
    const id = e.dataTransfer.getData("text/plain");
    if (id) onDropPart(id, part);
  };
  return (
    <div className="parts" role="tablist" aria-label="Day parts">
      <button role="tab" aria-selected={view === "all"} className={`part all${view === "all" ? " sel" : ""}`} onClick={() => onView("all")}>
        <span className="part-name">All day</span>
        <span className="part-meta">
          {formatMinutes(stats.planned)} planned
        </span>
      </button>
      {PARTS.map((p) => {
        const ps = stats.parts[p];
        const pct = ps.budget > 0 ? Math.min(100, (ps.planned / ps.budget) * 100) : ps.planned > 0 ? 100 : 0;
        return (
          <button
            key={p}
            role="tab"
            aria-selected={view === p}
            className={`part p-${p}${view === p ? " sel" : ""}${hover === p ? " drop" : ""}${ps.over ? " over" : ""}`}
            onClick={() => onView(p)}
            onDragOver={(e) => {
              e.preventDefault();
              setHover(p);
            }}
            onDragLeave={() => setHover((h) => (h === p ? null : h))}
            onDrop={(e) => drop(e, p)}
          >
            <span className="part-name">
              <PartIcon part={p} size={16} /> {PART_LABEL[p]}
              {nowPart === p && <span className="pill now-pill">Now</span>}
            </span>
            <span className="part-meta">
              {formatMinutes(ps.planned)} of {formatMinutes(ps.budget)}
              {ps.over && <strong> · over</strong>}
            </span>
            <span className="mini wide" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ====================================================================== */

function Column({
  bucket,
  tasks,
  showPart,
  defaultPart,
  onAdd,
  onPatch,
  onRemove,
}: {
  bucket: Bucket;
  tasks: Task[];
  showPart: boolean;
  defaultPart: Part;
  onAdd: (t: Omit<Task, "id" | "created" | "done">) => void;
  onPatch: (id: string, patch: Partial<Task>) => void;
  onRemove: (id: string) => void;
}) {
  const [over, setOver] = useState(false);
  const total = tasks.reduce((n, t) => n + t.minutes, 0);
  return (
    <section
      className={`col b-${bucket}${over ? " drop" : ""}`}
      aria-label={BUCKET_LABEL[bucket]}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onPatch(id, { bucket });
      }}
    >
      <header className="col-head">
        <div>
          <h2>{BUCKET_LABEL[bucket]}</h2>
          <p>{BUCKET_HINT[bucket]}</p>
        </div>
        <span className="count" aria-label={`${tasks.length} tasks, ${formatMinutes(total)}`}>
          {tasks.length}
          <small>{total > 0 ? formatMinutes(total) : ""}</small>
        </span>
      </header>

      <ul className="cards">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} showPart={showPart} onPatch={(p) => onPatch(t.id, p)} onRemove={() => onRemove(t.id)} />
        ))}
        {tasks.length === 0 && <li className="empty">Drop a task here or add one below.</li>}
      </ul>

      <AddForm bucket={bucket} defaultPart={defaultPart} onAdd={onAdd} />
    </section>
  );
}

function AddForm({ bucket, defaultPart, onAdd }: { bucket: Bucket; defaultPart: Part; onAdd: (t: Omit<Task, "id" | "created" | "done">) => void }) {
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [part, setPart] = useState<Part | null>(null);
  const effectivePart = part ?? defaultPart;
  const idBase = `add-${bucket}`;

  const submit = () => {
    const clean = title.trim();
    if (!clean) return;
    onAdd({ title: clean, bucket, part: effectivePart, minutes });
    setTitle("");
    setPart(null);
  };

  return (
    <form
      className="add"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="sr" htmlFor={`${idBase}-title`}>
        New {BUCKET_LABEL[bucket]} task
      </label>
      <input id={`${idBase}-title`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Add a ${BUCKET_LABEL[bucket]} task`} maxLength={200} />
      <div className="add-row">
        <label className="sr" htmlFor={`${idBase}-min`}>
          Estimate
        </label>
        <select id={`${idBase}-min`} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {MINUTE_PRESETS.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? "No estimate" : formatMinutes(m)}
            </option>
          ))}
        </select>
        <label className="sr" htmlFor={`${idBase}-part`}>
          Day part
        </label>
        <select id={`${idBase}-part`} value={effectivePart} onChange={(e) => setPart(e.target.value as Part)}>
          {PARTS.map((p) => (
            <option key={p} value={p}>
              {PART_LABEL[p]}
            </option>
          ))}
        </select>
        <button className="btn primary icon" type="submit" aria-label={`Add ${BUCKET_LABEL[bucket]} task`} disabled={!title.trim()}>
          <Icon name="plus" />
        </button>
      </div>
    </form>
  );
}

function TaskCard({ task, showPart, onPatch, onRemove }: { task: Task; showPart: boolean; onPatch: (p: Partial<Task>) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task);

  if (editing) {
    const save = () => {
      const clean = normalizeTask({ ...draft, title: draft.title.trim() });
      if (clean) onPatch({ title: clean.title, minutes: clean.minutes, part: clean.part });
      setEditing(false);
    };
    return (
      <li className="card editing">
        <label className="sr" htmlFor={`e-${task.id}-t`}>
          Task title
        </label>
        <input
          id={`e-${task.id}-t`}
          autoFocus
          value={draft.title}
          maxLength={200}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <div className="add-row">
          <label className="sr" htmlFor={`e-${task.id}-m`}>
            Minutes
          </label>
          <input id={`e-${task.id}-m`} type="number" min={0} max={1440} step={5} value={draft.minutes} onChange={(e) => setDraft({ ...draft, minutes: Number(e.target.value) })} />
          <label className="sr" htmlFor={`e-${task.id}-p`}>
            Day part
          </label>
          <select id={`e-${task.id}-p`} value={draft.part} onChange={(e) => setDraft({ ...draft, part: e.target.value as Part })}>
            {PARTS.map((p) => (
              <option key={p} value={p}>
                {PART_LABEL[p]}
              </option>
            ))}
          </select>
          <button className="btn primary small" onClick={save}>
            Save
          </button>
          <button className="btn small" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li
      className={`card${task.done ? " done" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <button className="check" role="checkbox" aria-checked={task.done} aria-label={`${task.title}, ${task.done ? "done" : "not done"}`} onClick={() => onPatch({ done: !task.done })}>
        {task.done && <Icon name="check" size={14} />}
      </button>
      <div className="card-body">
        <span className="card-title">{task.title}</span>
        <span className="card-meta">
          {showPart && (
            <span className={`chip p-${task.part}`}>
              <PartIcon part={task.part} size={12} /> {PART_LABEL[task.part]}
            </span>
          )}
          {task.minutes > 0 && <span className="chip">{formatMinutes(task.minutes)}</span>}
        </span>
      </div>
      <div className="card-tools">
        <span className="moves" role="group" aria-label="Move to">
          {BUCKETS.map((b) => (
            <button key={b} className={`mv b-${b}${b === task.bucket ? " cur" : ""}`} aria-label={`Move to ${BUCKET_LABEL[b]}`} aria-pressed={b === task.bucket} onClick={() => b !== task.bucket && onPatch({ bucket: b })}>
              {BUCKET_KEY[b]}
            </button>
          ))}
        </span>
        <button
          className="btn icon ghost"
          aria-label="Edit task"
          onClick={() => {
            setDraft(task);
            setEditing(true);
          }}
        >
          <Icon name="edit" size={14} />
        </button>
        <button className="btn icon ghost" aria-label="Delete task" onClick={onRemove}>
          <Icon name="trash" size={14} />
        </button>
      </div>
    </li>
  );
}

/* ====================================================================== */

function ConfirmButton({ label, confirmLabel, onConfirm }: { label: string; confirmLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(id);
  }, [armed]);
  return (
    <button
      className={`btn${armed ? " danger" : ""}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="set-row">{children}</div>;
}

function SettingsDialog({ settings, onClose, onSave }: { settings: Settings; onClose: () => void; onSave: (s: Settings) => void }) {
  const [draft, setDraft] = useState<Settings>(() => JSON.parse(JSON.stringify(settings)) as Settings);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="scrim" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="set-title" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2 id="set-title">Day parts and budgets</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close settings">
            <Icon name="x" />
          </button>
        </header>
        <p className="muted">Each part has a start time and an hours budget. Night runs until the morning start.</p>
        {PARTS.map((p) => (
          <Row key={p}>
            <span className="set-name">
              <PartIcon part={p} size={16} /> {PART_LABEL[p]}
            </span>
            <label className="sr" htmlFor={`s-${p}-start`}>
              {PART_LABEL[p]} start time
            </label>
            <input id={`s-${p}-start`} type="time" value={draft.starts[p]} onChange={(e) => e.target.value && setDraft({ ...draft, starts: { ...draft.starts, [p]: e.target.value } })} />
            <label className="sr" htmlFor={`s-${p}-hours`}>
              {PART_LABEL[p]} budget in hours
            </label>
            <span className="unit">
              <input
                id={`s-${p}-hours`}
                type="number"
                min={0}
                max={24}
                step={0.25}
                value={draft.budgets[p] / 60}
                onChange={(e) => setDraft({ ...draft, budgets: { ...draft.budgets, [p]: Math.max(0, Math.min(1440, Math.round(Number(e.target.value) * 60))) } })}
              />
              h
            </span>
          </Row>
        ))}
        <Row>
          <span className="set-name">Must share guide</span>
          <label className="sr" htmlFor="s-cap">
            Maximum Must share in percent
          </label>
          <span className="unit">
            <input id="s-cap" type="number" min={10} max={100} step={5} value={draft.mustCap} onChange={(e) => setDraft({ ...draft, mustCap: Math.max(10, Math.min(100, Math.round(Number(e.target.value)))) })} />%
          </span>
        </Row>
        <footer>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onSave(draft)}>
            Save settings
          </button>
        </footer>
      </div>
    </div>
  );
}
