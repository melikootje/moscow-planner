from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType

DOMAIN = "moscow_planner"


async def test_single_instance_flow(hass, enable_custom_integrations):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] == FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] == FlowResultType.CREATE_ENTRY and result["title"] == "MoSCoW Planner"
    again = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert again["type"] == FlowResultType.ABORT
