"""Sets the integration up in a real (test) Home Assistant instance."""

from unittest.mock import patch

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_capture_events

DOMAIN = "moscow_planner"

pytestmark = pytest.mark.usefixtures("enable_custom_integrations")


@pytest.fixture
async def setup(hass: HomeAssistant, enable_custom_integrations):
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    with patch("homeassistant.components.panel_custom.async_register_panel"), patch(
        "homeassistant.components.frontend.add_extra_js_url"
    ), patch("homeassistant.components.http.HomeAssistantHTTP.async_register_static_paths"):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        yield entry
        await hass.config_entries.async_unload(entry.entry_id)


async def test_entities_and_services(hass: HomeAssistant, setup):
    assert hass.states.get("sensor.moscow_planner_current_day_part").state in ("morning", "afternoon", "evening", "night")
    assert hass.states.get("sensor.moscow_planner_musts_remaining").state == "0"
    assert hass.states.get("sensor.moscow_planner_next_must").state == "unknown"

    events = async_capture_events(hass, f"{DOMAIN}_task_completed")

    res = await hass.services.async_call(
        DOMAIN, "add_task", {"title": "Call plumber", "bucket": "must", "part": "evening", "minutes": 20}, blocking=True, return_response=True
    )
    task_id = res["task"]["id"]
    await hass.async_block_till_done()
    assert hass.states.get("sensor.moscow_planner_musts_remaining").state == "1"
    assert hass.states.get("sensor.moscow_planner_progress_today").state == "0"

    await hass.services.async_call(DOMAIN, "set_task_done", {"title": "call PLUMBER"}, blocking=True)
    await hass.async_block_till_done()
    assert hass.states.get("sensor.moscow_planner_musts_remaining").state == "0"
    assert hass.states.get("sensor.moscow_planner_progress_today").state == "100"
    assert len(events) == 1 and events[0].data["task_id"] == task_id

    await hass.services.async_call(DOMAIN, "move_task", {"task_id": task_id, "bucket": "should", "part": "night"}, blocking=True)
    day = await hass.services.async_call(DOMAIN, "get_day", {}, blocking=True, return_response=True)
    assert day["tasks"][0]["bucket"] == "should" and day["tasks"][0]["part"] == "night"

    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(DOMAIN, "set_task_done", {"title": "nope"}, blocking=True)
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(DOMAIN, "remove_task", {}, blocking=True)

    await hass.services.async_call(DOMAIN, "clear_day", {}, blocking=True)
    day = await hass.services.async_call(DOMAIN, "get_day", {}, blocking=True, return_response=True)
    assert day["tasks"] == []


async def test_over_budget_binary_sensor(hass: HomeAssistant, setup):
    await hass.services.async_call(DOMAIN, "add_task", {"title": "Marathon", "bucket": "must", "part": "night", "minutes": 300}, blocking=True)
    await hass.async_block_till_done()
    assert hass.states.get("binary_sensor.moscow_planner_day_part_over_budget").state == "on"
    assert hass.states.get("binary_sensor.moscow_planner_too_many_musts").state == "on"


async def test_websocket_roundtrip(hass: HomeAssistant, hass_ws_client, setup):
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/get_state"})
    msg = await client.receive_json()
    assert msg["success"] and msg["result"]["settings"]["mustCap"] == 60

    await client.send_json({"id": 2, "type": f"{DOMAIN}/subscribe"})
    assert (await client.receive_json())["success"]
    first = await client.receive_json()
    assert first["type"] == "event" and first["event"]["state"]["days"] == {}

    task = {"id": "t1", "title": "Write update", "bucket": "must", "part": "morning", "minutes": 90, "done": False, "created": 1}
    await client.send_json({"id": 3, "type": f"{DOMAIN}/set_day", "date": "2026-11-25", "tasks": [task, {"title": ""}]})
    # the subscription pushes the new state, then the command result arrives
    seen = {}
    for _ in range(2):
        m = await client.receive_json()
        seen[m["type"]] = m
    assert seen["result"]["success"]
    assert [t["title"] for t in seen["event"]["event"]["state"]["days"]["2026-11-25"]] == ["Write update"]

    await client.send_json({"id": 4, "type": f"{DOMAIN}/set_settings", "settings": {"mustCap": 40, "budgets": {"night": 15}}})
    assert (await client.receive_json())["type"] in ("event", "result")
    await client.send_json({"id": 5, "type": f"{DOMAIN}/get_state"})
    while True:
        m = await client.receive_json()
        if m["id"] == 5:
            break
    assert m["result"]["settings"]["mustCap"] == 40 and m["result"]["settings"]["budgets"]["night"] == 15

    await client.send_json({"id": 6, "type": f"{DOMAIN}/set_day", "date": "not-a-date", "tasks": []})
    while True:
        m = await client.receive_json()
        if m["id"] == 6:
            break
    assert not m["success"]


async def test_carry_over_service(hass: HomeAssistant, setup):
    await hass.services.async_call(DOMAIN, "add_task", {"title": "Unfinished", "bucket": "must", "date": "2026-11-24"}, blocking=True)
    res = await hass.services.async_call(DOMAIN, "carry_over", {"to_date": "2026-11-25"}, blocking=True, return_response=True)
    assert res == {"moved": 1}
    res = await hass.services.async_call(DOMAIN, "carry_over", {"to_date": "2026-11-25"}, blocking=True, return_response=True)
    assert res == {"moved": 0}
