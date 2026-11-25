"""Binary sensors for automations."""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .planner import PlannerManager
from .sensor import PlannerEntity


class OverBudgetSensor(PlannerEntity, BinarySensorEntity):
    """On when any day part holds more planned time than its budget."""

    _attr_translation_key = "over_budget"
    _attr_device_class = BinarySensorDeviceClass.PROBLEM

    def __init__(self, manager: PlannerManager) -> None:
        super().__init__(manager, "over_budget")

    @property
    def is_on(self) -> bool:
        return self.manager.stats()["over_budget"]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        parts = self.manager.stats()["parts"]
        return {"over_parts": [p for p, v in parts.items() if v["over"]]}


class MustOverloadSensor(PlannerEntity, BinarySensorEntity):
    """On when Musts take more than the recommended share of planned time."""

    _attr_translation_key = "must_overload"
    _attr_device_class = BinarySensorDeviceClass.PROBLEM

    def __init__(self, manager: PlannerManager) -> None:
        super().__init__(manager, "must_overload")

    @property
    def is_on(self) -> bool:
        return self.manager.stats()["must_level"] != "ok"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        s = self.manager.stats()
        return {"must_share": round(s["must_share"]), "limit": self.manager.state["settings"]["must_cap"]}


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    """Add the binary sensors."""
    manager: PlannerManager = hass.data[DOMAIN]
    async_add_entities([OverBudgetSensor(manager), MustOverloadSensor(manager)])
