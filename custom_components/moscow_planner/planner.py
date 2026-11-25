"""Runtime store and operations for the planner."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    EVENT_PART_CHANGED,
    EVENT_TASK_COMPLETED,
    SIGNAL_UPDATED,
    STORAGE_KEY,
    STORAGE_VERSION,
)
from .logic import (
    carry_over,
    day_stats,
    empty_state,
    new_id,
    next_must,
    normalize_settings,
    normalize_state,
    normalize_task,
    part_at,
)


class PlannerManager:
    """Owns the planner state, persists it and notifies listeners."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.state: dict[str, Any] = empty_state()
        self._unsub_clock: CALLBACK_TYPE | None = None
        self._last_part: str | None = None
        self._listeners: list[Callable[[dict[str, Any]], None]] = []

    # -- lifecycle ----------------------------------------------------------

    async def async_load(self) -> None:
        """Load stored state and start the minute clock used for day part changes."""
        self.state = normalize_state(await self._store.async_load())
        self._last_part = self.current_part()
        self._unsub_clock = async_track_time_change(self.hass, self._tick, second=0)

    async def async_unload(self) -> None:
        """Stop the clock and write pending changes."""
        if self._unsub_clock:
            self._unsub_clock()
            self._unsub_clock = None
        await self._store.async_save(self.state)

    # -- helpers ------------------------------------------------------------

    @staticmethod
    def today() -> str:
        """Today's date in the Home Assistant time zone."""
        return dt_util.now().date().isoformat()

    def now(self) -> datetime:
        """Current local time."""
        return dt_util.now()

    def current_part(self) -> str:
        """Day part right now."""
        return part_at(self.now(), self.state["settings"]["starts"])

    def day(self, date: str | None = None) -> list[dict[str, Any]]:
        """Tasks for a date (today by default)."""
        return self.state["days"].get(date or self.today(), [])

    def stats(self, date: str | None = None) -> dict[str, Any]:
        """Statistics for a date (today by default)."""
        return day_stats(self.day(date), self.state["settings"])

    def next_must(self) -> dict[str, Any] | None:
        """Next unfinished Must for today."""
        return next_must(self.day(), self.current_part())

    def add_listener(self, cb: Callable[[dict[str, Any]], None]) -> CALLBACK_TYPE:
        """Register a websocket listener that receives the full state on change."""
        self._listeners.append(cb)

        def _remove() -> None:
            if cb in self._listeners:
                self._listeners.remove(cb)

        return _remove

    # -- change plumbing ----------------------------------------------------

    @callback
    def _changed(self) -> None:
        self._store.async_delay_save(lambda: self.state, 1)
        async_dispatcher_send(self.hass, SIGNAL_UPDATED)
        for cb in list(self._listeners):
            cb(self.state)

    @callback
    def _tick(self, _now: datetime) -> None:
        part = self.current_part()
        if part != self._last_part:
            self._last_part = part
            self.hass.bus.async_fire(EVENT_PART_CHANGED, {"part": part})
            async_dispatcher_send(self.hass, SIGNAL_UPDATED)

    # -- operations used by websocket commands and services ------------------

    @callback
    def set_day(self, date: str, tasks: list[Any]) -> None:
        """Replace a day's tasks, firing an event for each task that was just completed."""
        old = {t["id"]: t for t in self.day(date)}
        clean = [t for t in (normalize_task(raw) for raw in tasks) if t]
        for task in clean:
            before = old.get(task["id"])
            if task["done"] and not (before and before["done"]):
                self.hass.bus.async_fire(
                    EVENT_TASK_COMPLETED,
                    {"date": date, "task_id": task["id"], "title": task["title"], "bucket": task["bucket"], "part": task["part"]},
                )
        if clean:
            self.state["days"][date] = clean
        else:
            self.state["days"].pop(date, None)
        self._changed()

    @callback
    def set_settings(self, settings: Any) -> None:
        """Replace settings."""
        self.state["settings"] = normalize_settings(settings)
        self._last_part = self.current_part()
        self._changed()

    @callback
    def add_task(self, title: str, bucket: str, part: str | None, minutes: int, date: str | None) -> dict[str, Any]:
        """Add one task and return it."""
        key = date or self.today()
        task = normalize_task(
            {"id": new_id(), "title": title, "bucket": bucket, "part": part or self.current_part(), "minutes": minutes, "done": False}
        )
        if task is None:
            raise ValueError("Task title is empty")
        self.set_day(key, [*self.day(key), task])
        return task

    def find(self, date: str, task_id: str | None, title: str | None) -> dict[str, Any]:
        """Locate a task by id, or by case-insensitive title."""
        tasks = self.day(date)
        for task in tasks:
            if task_id and task["id"] == task_id:
                return task
        if title:
            for task in tasks:
                if task["title"].lower() == title.strip().lower():
                    return task
        raise ValueError("No matching task on that day")

    @callback
    def patch_task(self, date: str, task_id: str | None, title: str | None, patch: dict[str, Any]) -> dict[str, Any]:
        """Change fields on a task."""
        target = self.find(date, task_id, title)
        updated = [{**t, **patch} if t["id"] == target["id"] else t for t in self.day(date)]
        self.set_day(date, updated)
        return {**target, **patch}

    @callback
    def remove_task(self, date: str, task_id: str | None, title: str | None) -> None:
        """Delete a task."""
        target = self.find(date, task_id, title)
        self.set_day(date, [t for t in self.day(date) if t["id"] != target["id"]])

    @callback
    def clear_day(self, date: str, only_done: bool) -> None:
        """Remove all tasks (or just finished ones) from a day."""
        tasks = self.day(date)
        self.set_day(date, [t for t in tasks if not t["done"]] if only_done else [])

    @callback
    def carry_over(self, to_date: str, from_date: str | None, buckets: list[str] | None) -> int:
        """Copy unfinished tasks forward."""
        moved = carry_over(self.state, to_date, from_date, buckets)
        if moved:
            self._changed()
        return moved
