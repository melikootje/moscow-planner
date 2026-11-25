"""MoSCoW Planner: a day planner that sorts tasks into Must, Should, Could and Won't and into day parts."""

from __future__ import annotations

import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import ServiceValidationError
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import BUCKETS, DOMAIN, MODULE_FILE, PANEL_URL_PATH, PARTS, URL_BASE, VERSION
from .planner import PlannerManager
from .websocket_api import async_register_commands

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
PLATFORMS = [Platform.SENSOR, Platform.BINARY_SENSOR]

_DATE = vol.Match(r"^\d{4}-\d{2}-\d{2}$")
_MODULE_URL = f"{URL_BASE}/{MODULE_FILE}?v={VERSION}"

_TARGET = {
    vol.Optional("task_id"): cv.string,
    vol.Optional("title"): cv.string,
    vol.Optional("date"): _DATE,
}

SERVICE_SCHEMAS: dict[str, vol.Schema] = {
    "add_task": vol.Schema(
        {
            vol.Required("title"): vol.All(cv.string, vol.Length(min=1, max=200)),
            vol.Optional("bucket", default="should"): vol.In(BUCKETS),
            vol.Optional("part"): vol.In(PARTS),
            vol.Optional("minutes", default=30): vol.All(vol.Coerce(int), vol.Range(min=0, max=1440)),
            vol.Optional("date"): _DATE,
        }
    ),
    "set_task_done": vol.Schema({**_TARGET, vol.Optional("done", default=True): cv.boolean}),
    "move_task": vol.Schema(
        {**_TARGET, vol.Optional("bucket"): vol.In(BUCKETS), vol.Optional("part"): vol.In(PARTS)}
    ),
    "remove_task": vol.Schema(_TARGET),
    "clear_day": vol.Schema({vol.Optional("date"): _DATE, vol.Optional("only_done", default=False): cv.boolean}),
    "carry_over": vol.Schema(
        {
            vol.Optional("to_date"): _DATE,
            vol.Optional("from_date"): _DATE,
            vol.Optional("buckets", default=["must"]): vol.All(cv.ensure_list, [vol.In(BUCKETS)]),
        }
    ),
    "get_day": vol.Schema({vol.Optional("date"): _DATE}),
}


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register things that exist once per Home Assistant instance."""
    async_register_commands(hass)
    frontend_dir = Path(__file__).parent / "frontend"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(URL_BASE, str(frontend_dir), cache_headers=False)]
    )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the planner from a config entry."""
    manager = PlannerManager(hass)
    await manager.async_load()
    hass.data[DOMAIN] = manager

    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="moscow-planner-panel",
        frontend_url_path=PANEL_URL_PATH,
        module_url=_MODULE_URL,
        sidebar_title="MoSCoW",
        sidebar_icon="mdi:calendar-check",
        require_admin=False,
        config={},
    )
    # Makes the custom card available on every dashboard without adding a resource by hand.
    frontend.add_extra_js_url(hass, _MODULE_URL)

    _register_services(hass, manager)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the planner."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if not unloaded:
        return False
    manager: PlannerManager = hass.data.pop(DOMAIN)
    await manager.async_unload()
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    frontend.remove_extra_js_url(hass, _MODULE_URL)
    for name in SERVICE_SCHEMAS:
        hass.services.async_remove(DOMAIN, name)
    return True


def _register_services(hass: HomeAssistant, manager: PlannerManager) -> None:
    def _date(call: ServiceCall) -> str:
        return call.data.get("date") or manager.today()

    def _guard(fn):  # type: ignore[no-untyped-def]
        try:
            return fn()
        except ValueError as err:
            raise ServiceValidationError(str(err)) from err

    def _require_target(call: ServiceCall) -> None:
        if not call.data.get("task_id") and not call.data.get("title"):
            raise ServiceValidationError("Provide task_id or title")

    async def add_task(call: ServiceCall) -> ServiceResponse:
        task = _guard(
            lambda: manager.add_task(
                call.data["title"], call.data["bucket"], call.data.get("part"), call.data["minutes"], call.data.get("date")
            )
        )
        return {"task": task}

    async def set_task_done(call: ServiceCall) -> None:
        _require_target(call)
        _guard(lambda: manager.patch_task(_date(call), call.data.get("task_id"), call.data.get("title"), {"done": call.data["done"]}))

    async def move_task(call: ServiceCall) -> None:
        _require_target(call)
        patch = {k: call.data[k] for k in ("bucket", "part") if k in call.data}
        if not patch:
            raise ServiceValidationError("Provide bucket and/or part")
        _guard(lambda: manager.patch_task(_date(call), call.data.get("task_id"), call.data.get("title"), patch))

    async def remove_task(call: ServiceCall) -> None:
        _require_target(call)
        _guard(lambda: manager.remove_task(_date(call), call.data.get("task_id"), call.data.get("title")))

    async def clear_day(call: ServiceCall) -> None:
        manager.clear_day(_date(call), call.data["only_done"])

    async def carry_over(call: ServiceCall) -> ServiceResponse:
        moved = manager.carry_over(call.data.get("to_date") or manager.today(), call.data.get("from_date"), call.data["buckets"])
        return {"moved": moved}

    async def get_day(call: ServiceCall) -> ServiceResponse:
        date = _date(call)
        return {"date": date, "tasks": manager.day(date), "stats": manager.stats(date)}

    handlers = {
        "add_task": (add_task, SupportsResponse.OPTIONAL),
        "set_task_done": (set_task_done, SupportsResponse.NONE),
        "move_task": (move_task, SupportsResponse.NONE),
        "remove_task": (remove_task, SupportsResponse.NONE),
        "clear_day": (clear_day, SupportsResponse.NONE),
        "carry_over": (carry_over, SupportsResponse.OPTIONAL),
        "get_day": (get_day, SupportsResponse.ONLY),
    }
    for name, (handler, supports) in handlers.items():
        hass.services.async_register(DOMAIN, name, handler, schema=SERVICE_SCHEMAS[name], supports_response=supports)
