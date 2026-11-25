"""Pure planner logic with no Home Assistant imports, mirrored from the web UI."""

from __future__ import annotations

import copy
import re
import uuid
from datetime import date as date_cls, datetime, timedelta
from typing import Any

from .const import BUCKETS, PARTS

DEFAULT_SETTINGS: dict[str, Any] = {
    "budgets": {"morning": 240, "afternoon": 300, "evening": 180, "night": 60},
    "starts": {"morning": "06:00", "afternoon": "12:00", "evening": "18:00", "night": "22:00"},
    "must_cap": 60,
}

_TIME_RE = re.compile(r"^\d{1,2}:\d{2}")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def new_id() -> str:
    """Short unique task id."""
    return uuid.uuid4().hex[:10]


def empty_state() -> dict[str, Any]:
    """Return a fresh planner state."""
    return {"version": 1, "settings": copy.deepcopy(DEFAULT_SETTINGS), "days": {}}


def _to_minutes(hhmm: str) -> int:
    hours, minutes = hhmm.split(":")[:2]
    return int(hours) * 60 + int(minutes)


def part_at(now: datetime, starts: dict[str, str]) -> str:
    """Day part containing a clock time. Night wraps past midnight."""
    minute = now.hour * 60 + now.minute
    ordered = sorted(PARTS, key=lambda p: _to_minutes(starts[p]))
    current = ordered[-1]
    for part in ordered:
        if _to_minutes(starts[part]) <= minute:
            current = part
    return current


def weight(task: dict[str, Any]) -> int:
    """Weight of a task when computing progress."""
    return max(int(task.get("minutes", 0)), 5)


def day_stats(tasks: list[dict[str, Any]], settings: dict[str, Any]) -> dict[str, Any]:
    """Summarise one day: planned and done minutes, progress, Must share, per-part numbers."""
    parts = {
        p: {"planned": 0, "done": 0, "budget": settings["budgets"][p], "over": False, "count": 0}
        for p in PARTS
    }
    counts = {b: {"total": 0, "done": 0} for b in BUCKETS}
    planned = done = must_minutes = must_left = weighted = weighted_done = 0

    for task in tasks:
        bucket = task["bucket"]
        counts[bucket]["total"] += 1
        if task["done"]:
            counts[bucket]["done"] += 1
        if bucket == "wont":
            continue
        minutes = int(task["minutes"])
        planned += minutes
        parts[task["part"]]["planned"] += minutes
        parts[task["part"]]["count"] += 1
        weighted += weight(task)
        if task["done"]:
            done += minutes
            parts[task["part"]]["done"] += minutes
            weighted_done += weight(task)
        if bucket == "must":
            must_minutes += minutes
            if not task["done"]:
                must_left += 1

    for p in PARTS:
        parts[p]["over"] = parts[p]["planned"] > parts[p]["budget"]

    cap = settings["must_cap"]
    must_share = must_minutes / planned * 100 if planned else 0.0
    if must_share <= cap:
        level = "ok"
    elif must_share <= cap + 10:
        level = "warn"
    else:
        level = "over"
    progress = round(weighted_done / weighted * 100) if weighted else 0
    return {
        "planned": planned,
        "done": done,
        "progress": progress,
        "must_share": must_share,
        "must_level": level,
        "must_left": must_left,
        "over_budget": any(parts[p]["over"] for p in PARTS),
        "parts": parts,
        "counts": counts,
    }


def next_must(tasks: list[dict[str, Any]], from_part: str) -> dict[str, Any] | None:
    """First unfinished Must, starting at a day part and wrapping through the day."""
    start = PARTS.index(from_part)
    for i in range(len(PARTS)):
        part = PARTS[(start + i) % len(PARTS)]
        for task in tasks:
            if task["bucket"] == "must" and not task["done"] and task["part"] == part:
                return task
    return None


def normalize_task(raw: Any) -> dict[str, Any] | None:
    """Validate and clean one task. Returns None when unusable."""
    if not isinstance(raw, dict):
        return None
    title = raw.get("title")
    if not isinstance(title, str) or not title.strip():
        return None
    minutes = raw.get("minutes", 0)
    if isinstance(minutes, bool) or not isinstance(minutes, (int, float)):
        minutes = 0
    return {
        "id": raw["id"] if isinstance(raw.get("id"), str) and raw["id"] else new_id(),
        "title": title.strip()[:200],
        "bucket": raw.get("bucket") if raw.get("bucket") in BUCKETS else "should",
        "part": raw.get("part") if raw.get("part") in PARTS else "morning",
        "minutes": max(0, min(1440, int(round(minutes)))),
        "done": raw.get("done") is True,
        "created": raw["created"] if isinstance(raw.get("created"), (int, float)) else int(datetime.now().timestamp() * 1000),
    }


def normalize_settings(raw: Any) -> dict[str, Any]:
    """Merge user settings over the defaults, dropping invalid values."""
    out = copy.deepcopy(DEFAULT_SETTINGS)
    if not isinstance(raw, dict):
        return out
    budgets = raw.get("budgets") if isinstance(raw.get("budgets"), dict) else {}
    starts = raw.get("starts") if isinstance(raw.get("starts"), dict) else {}
    for part in PARTS:
        budget = budgets.get(part)
        if isinstance(budget, (int, float)) and not isinstance(budget, bool) and 0 <= budget <= 1440:
            out["budgets"][part] = int(round(budget))
        start = starts.get(part)
        if isinstance(start, str) and _TIME_RE.match(start):
            hh, mm = start.split(":")[:2]
            if 0 <= int(hh) < 24 and 0 <= int(mm[:2]) < 60:
                out["starts"][part] = f"{int(hh):02d}:{int(mm[:2]):02d}"
    cap = raw.get("mustCap", raw.get("must_cap"))
    if isinstance(cap, (int, float)) and not isinstance(cap, bool) and 10 <= cap <= 100:
        out["must_cap"] = int(round(cap))
    return out


def normalize_state(raw: Any) -> dict[str, Any]:
    """Validate a whole stored or received state."""
    state = empty_state()
    if not isinstance(raw, dict):
        return state
    state["settings"] = normalize_settings(raw.get("settings"))
    days = raw.get("days")
    if isinstance(days, dict):
        for key, items in days.items():
            if not isinstance(key, str) or not _DATE_RE.match(key) or not isinstance(items, list):
                continue
            tasks = [t for t in (normalize_task(i) for i in items) if t]
            if tasks:
                state["days"][key] = tasks
    return state


def add_days(key: str, n: int) -> str:
    """Shift an ISO date by n days."""
    return (date_cls.fromisoformat(key) + timedelta(days=n)).isoformat()


def carry_over(
    state: dict[str, Any], to_date: str, from_date: str | None = None, buckets: list[str] | None = None
) -> int:
    """Copy unfinished tasks from an earlier day into `to_date`. Returns how many were added."""
    buckets = buckets or ["must"]
    source_date = from_date or add_days(to_date, -1)
    source = [t for t in state["days"].get(source_date, []) if not t["done"] and t["bucket"] in buckets]
    existing = state["days"].get(to_date, [])
    have = {(t["title"].lower(), t["part"]) for t in existing}
    fresh = [
        {**t, "id": new_id(), "created": int(datetime.now().timestamp() * 1000)}
        for t in source
        if (t["title"].lower(), t["part"]) not in have
    ]
    if fresh:
        state["days"][to_date] = [*existing, *fresh]
    return len(fresh)


def ui_state(state: dict[str, Any]) -> dict[str, Any]:
    """State in the shape the web UI expects (camelCase settings)."""
    settings = state["settings"]
    return {
        "version": 1,
        "settings": {
            "budgets": dict(settings["budgets"]),
            "starts": dict(settings["starts"]),
            "mustCap": settings["must_cap"],
        },
        "days": state["days"],
    }
