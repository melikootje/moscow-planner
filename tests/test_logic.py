"""Tests for the pure planner logic. Loads logic.py without importing Home Assistant."""

import importlib.util
import sys
import types
from datetime import datetime
from pathlib import Path

PKG = Path(__file__).resolve().parents[1] / "custom_components" / "moscow_planner"


def _load():
    pkg = types.ModuleType("mp")
    pkg.__path__ = [str(PKG)]
    sys.modules["mp"] = pkg
    for name in ("const", "logic"):
        spec = importlib.util.spec_from_file_location(f"mp.{name}", PKG / f"{name}.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[f"mp.{name}"] = mod
        spec.loader.exec_module(mod)
    return sys.modules["mp.logic"]


L = _load()
S = L.DEFAULT_SETTINGS


def t(title, bucket="must", part="morning", minutes=30, done=False):
    return L.normalize_task({"id": title, "title": title, "bucket": bucket, "part": part, "minutes": minutes, "done": done, "created": 1})


def test_part_at_boundaries_and_night_wrap():
    at = lambda h, m=0: L.part_at(datetime(2026, 11, 25, h, m), S["starts"])
    assert at(5, 59) == "night"
    assert at(6) == "morning"
    assert at(11, 59) == "morning"
    assert at(12) == "afternoon"
    assert at(18) == "evening"
    assert at(21, 59) == "evening"
    assert at(22) == "night"
    assert at(0, 30) == "night"


def test_part_at_custom_starts():
    starts = {"morning": "05:00", "afternoon": "11:30", "evening": "17:00", "night": "23:00"}
    assert L.part_at(datetime(2026, 1, 1, 11, 29), starts) == "morning"
    assert L.part_at(datetime(2026, 1, 1, 11, 30), starts) == "afternoon"
    assert L.part_at(datetime(2026, 1, 1, 4, 0), starts) == "night"


def test_day_stats_progress_and_budgets():
    tasks = [
        t("a", "must", "morning", 60, True),
        t("b", "must", "morning", 60),
        t("c", "should", "afternoon", 120),
        t("d", "wont", "evening", 600),
    ]
    s = L.day_stats(tasks, S)
    assert s["planned"] == 240  # wont excluded
    assert s["done"] == 60
    assert s["progress"] == 25
    assert s["must_left"] == 1
    assert round(s["must_share"]) == 50
    assert s["must_level"] == "ok"
    assert s["parts"]["morning"]["planned"] == 120
    assert not s["over_budget"]
    assert s["parts"]["evening"]["planned"] == 0
    assert s["counts"]["wont"]["total"] == 1


def test_over_budget_and_must_levels():
    s = L.day_stats([t("x", "must", "night", 90)], S)
    assert s["parts"]["night"]["over"] and s["over_budget"]
    assert s["must_level"] == "over"  # 100% of planned time
    s = L.day_stats([t("m", "must", "morning", 75), t("s", "should", "morning", 25)], S)
    assert s["must_level"] == "over"  # 75%
    s = L.day_stats([t("m", "must", "morning", 70), t("s", "should", "morning", 30)], S)
    assert s["must_level"] == "warn"  # exactly cap + 10
    s = L.day_stats([t("m", "must", "morning", 63), t("s", "should", "morning", 37)], S)
    assert s["must_level"] == "warn"  # 63%


def test_empty_day():
    s = L.day_stats([], S)
    assert s["progress"] == 0 and s["must_share"] == 0 and s["must_level"] == "ok"


def test_next_must_wraps_from_current_part():
    tasks = [t("m", "must", "morning"), t("e", "must", "evening"), t("x", "should", "afternoon")]
    assert L.next_must(tasks, "afternoon")["title"] == "e"
    assert L.next_must(tasks, "night")["title"] == "m"
    assert L.next_must([t("d", "must", "morning", done=True)], "morning") is None


def test_normalize_task_rejects_and_clamps():
    assert L.normalize_task({"title": "  "}) is None
    assert L.normalize_task("nope") is None
    n = L.normalize_task({"title": " Hi ", "bucket": "bad", "part": "bad", "minutes": 99999})
    assert n["title"] == "Hi" and n["bucket"] == "should" and n["part"] == "morning" and n["minutes"] == 1440
    assert L.normalize_task({"title": "x", "minutes": True})["minutes"] == 0


def test_normalize_state_accepts_ui_settings_shape():
    raw = {"settings": {"mustCap": 50, "budgets": {"morning": 90}, "starts": {"night": "23:15", "evening": "bad"}}, "days": {"2026-11-25": [{"title": "a"}], "bad": [{"title": "b"}]}}
    st = L.normalize_state(raw)
    assert st["settings"]["must_cap"] == 50
    assert st["settings"]["budgets"]["morning"] == 90 and st["settings"]["budgets"]["night"] == 60
    assert st["settings"]["starts"]["night"] == "23:15" and st["settings"]["starts"]["evening"] == "18:00"
    assert list(st["days"]) == ["2026-11-25"]
    ui = L.ui_state(st)
    assert ui["settings"]["mustCap"] == 50 and "must_cap" not in ui["settings"]


def test_carry_over_skips_done_duplicates_and_other_buckets():
    st = L.empty_state()
    st["days"]["2026-11-24"] = [t("a", "must", "morning"), t("b", "must", "evening", done=True), t("c", "should", "morning")]
    st["days"]["2026-11-25"] = [t("A", "must", "morning")]  # same title+part, different case
    assert L.carry_over(st, "2026-11-25") == 0
    st["days"]["2026-11-25"] = []
    assert L.carry_over(st, "2026-11-25") == 1
    assert [x["title"] for x in st["days"]["2026-11-25"]] == ["a"]
    assert st["days"]["2026-11-25"][0]["id"] != "a"
    assert L.carry_over(st, "2026-11-25", buckets=["must", "should"]) == 1  # "c" now; "a" already present


def test_add_days_across_month_boundary():
    assert L.add_days("2026-12-01", -1) == "2026-11-30"
    assert L.add_days("2026-12-31", 1) == "2027-01-01"
