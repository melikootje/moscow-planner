"""Sensors for the planner."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE, UnitOfTime
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, PARTS, SIGNAL_UPDATED
from .planner import PlannerManager


def device_info() -> DeviceInfo:
    """One device groups every entity."""
    return DeviceInfo(identifiers={(DOMAIN, "planner")}, name="MoSCoW Planner", manufacturer="MoSCoW Planner")


class PlannerEntity:
    """Mixin that refreshes an entity whenever the planner changes."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, manager: PlannerManager, key: str) -> None:
        self.manager = manager
        self._attr_unique_id = f"{DOMAIN}_{key}"
        self._attr_device_info = device_info()

    async def async_added_to_hass(self) -> None:
        """Listen for planner updates."""
        await super().async_added_to_hass()  # type: ignore[misc]
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_UPDATED, self._refresh))  # type: ignore[attr-defined]

    @callback
    def _refresh(self) -> None:
        self.async_write_ha_state()  # type: ignore[attr-defined]


class CurrentPartSensor(PlannerEntity, SensorEntity):
    """Which part of the day it is, using the start times from the planner settings."""

    _attr_translation_key = "current_part"
    _attr_icon = "mdi:weather-sunset"
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = PARTS

    def __init__(self, manager: PlannerManager) -> None:
        super().__init__(manager, "current_part")

    @property
    def native_value(self) -> str:
        return self.manager.current_part()

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"starts": self.manager.state["settings"]["starts"]}


class ProgressSensor(PlannerEntity, SensorEntity):
    """Share of today's planned work that is finished."""

    _attr_translation_key = "progress"
    _attr_icon = "mdi:progress-check"
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, manager: PlannerManager) -> None:
        super().__init__(manager, "progress")

    @property
    def native_value(self) -> int:
        return self.manager.stats()["progress"]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        s = self.manager.stats()
        return {
            "planned_minutes": s["planned"],
            "done_minutes": s["done"],
            "must_share": round(s["must_share"]),
            "must_level": s["must_level"],
            "counts": s["counts"],
            "parts": s["parts"],
        }


class MustRemainingSensor(PlannerEntity, SensorEntity):
    """Unfinished Must tasks today."""

    _attr_translation_key = "must_remaining"
    _attr_icon = "mdi:alert-circle-outline"
    _attr_native_unit_of_measurement = "tasks"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, manager: PlannerManager) -> None:
        super().__init__(manager, "must_remaining")

    @property
    def native_value(self) -> int:
        return self.manager.stats()["must_left"]


class NextMustSensor(PlannerEntity, SensorEntity):
    """Title of the next unfinished Must task."""

    _attr_translation_key = "next_must"
    _attr_icon = "mdi:flag-outline"

    def __init__(self, manager: PlannerManager) -> None:
        super().__init__(manager, "next_must")

    @property
    def native_value(self) -> str | None:
        task = self.manager.next_must()
        return task["title"] if task else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        task = self.manager.next_must()
        if not task:
            return {}
        return {"task_id": task["id"], "part": task["part"], "minutes": task["minutes"]}


class PartPlannedSensor(PlannerEntity, SensorEntity):
    """Planned minutes in one day part, with the budget as an attribute."""

    _attr_icon = "mdi:timer-outline"
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_entity_registry_enabled_default = False

    def __init__(self, manager: PlannerManager, part: str) -> None:
        super().__init__(manager, f"{part}_planned")
        self._part = part
        self._attr_translation_key = f"{part}_planned"

    @property
    def native_value(self) -> int:
        return self.manager.stats()["parts"][self._part]["planned"]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        p = self.manager.stats()["parts"][self._part]
        return {"budget_minutes": p["budget"], "done_minutes": p["done"], "over_budget": p["over"], "tasks": p["count"]}


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    """Add the sensors."""
    manager: PlannerManager = hass.data[DOMAIN]
    async_add_entities(
        [
            CurrentPartSensor(manager),
            ProgressSensor(manager),
            MustRemainingSensor(manager),
            NextMustSensor(manager),
            *[PartPlannedSensor(manager, part) for part in PARTS],
        ]
    )
