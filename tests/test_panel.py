"""Real (unmocked) panel, extra JS and static path registration."""

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

DOMAIN = "moscow_planner"


async def test_panel_registered_and_removed(hass: HomeAssistant, enable_custom_integrations, hass_client_no_auth):
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    panels = hass.data["frontend_panels"]
    assert "moscow-planner" in panels
    assert panels["moscow-planner"].sidebar_title == "MoSCoW"
    assert panels["moscow-planner"].config["_panel_custom"]["name"] == "moscow-planner-panel"

    client = await hass_client_no_auth()
    resp = await client.get("/moscow_planner_static/moscow-planner.js")
    assert resp.status == 200
    body = await resp.text()
    assert "moscow-planner-panel" in body and "moscow-planner-card" in body

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert "moscow-planner" not in hass.data["frontend_panels"]
