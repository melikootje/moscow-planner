"""Websocket commands used by the panel and card."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
import homeassistant.helpers.config_validation as cv

from .const import DOMAIN
from .logic import ui_state
from .planner import PlannerManager

_DATE = vol.Match(r"^\d{4}-\d{2}-\d{2}$")


def _manager(hass: HomeAssistant) -> PlannerManager | None:
    return hass.data.get(DOMAIN)


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register all websocket commands."""
    websocket_api.async_register_command(hass, ws_get_state)
    websocket_api.async_register_command(hass, ws_set_day)
    websocket_api.async_register_command(hass, ws_set_settings)
    websocket_api.async_register_command(hass, ws_subscribe)


def _not_ready(connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_error(msg["id"], "not_ready", "MoSCoW Planner is not set up")


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get_state"})
@callback
def ws_get_state(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Return the whole planner state."""
    manager = _manager(hass)
    if manager is None:
        _not_ready(connection, msg)
        return
    connection.send_result(msg["id"], ui_state(manager.state))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/set_day",
        vol.Required("date"): _DATE,
        vol.Required("tasks"): vol.All(list, vol.Length(max=500)),
    }
)
@callback
def ws_set_day(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Replace one day's tasks."""
    manager = _manager(hass)
    if manager is None:
        _not_ready(connection, msg)
        return
    manager.set_day(msg["date"], msg["tasks"])
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/set_settings", vol.Required("settings"): dict}
)
@callback
def ws_set_settings(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Replace the settings."""
    manager = _manager(hass)
    if manager is None:
        _not_ready(connection, msg)
        return
    manager.set_settings(msg["settings"])
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Send the state now and again after every change."""
    manager = _manager(hass)
    if manager is None:
        _not_ready(connection, msg)
        return

    @callback
    def _forward(state: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], {"state": ui_state(state)}))

    connection.subscriptions[msg["id"]] = manager.add_listener(_forward)
    connection.send_result(msg["id"])
    _forward(manager.state)
