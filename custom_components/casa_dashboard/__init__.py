"""Casa Dashboard — a self-contained dashboard panel for Home Assistant.

Everything a user needs arrives with the integration: it serves its own frontend bundle, adds
its own sidebar entry, and keeps the dashboard configuration in HA's .storage. There is nothing
to add to configuration.yaml and nothing to copy into /www — install it, add it from the UI,
and the panel appears.

WebSocket API used by the panel:
  casa_dashboard/get  -> the stored configuration ({} means "use the built-in defaults")
  casa_dashboard/set  -> replace it (admin only; it defines the whole dashboard)
"""

from __future__ import annotations

from pathlib import Path

import voluptuous as vol

from homeassistant.components import panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store

from .const import (
    DOMAIN,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    STORAGE_KEY,
    STORAGE_VERSION,
    URL_BASE,
)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Serve the bundled frontend, register the panel, expose the config API."""
    store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    hass.data[DOMAIN] = {"store": store, "config": await store.async_load() or {}}

    # serve <integration>/frontend as /casa_dashboard/... so no files need copying to /www
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                URL_BASE, str(Path(__file__).parent / "frontend"), cache_headers=False
            )
        ]
    )

    # add the sidebar entry ourselves — no panel_custom: block in configuration.yaml
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name="casa-panel",
        module_url=f"{URL_BASE}/casa-panel.js",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        require_admin=False,
        config={"casa": hass.data[DOMAIN]["config"]},
    )

    websocket_api.async_register_command(hass, websocket_get_config)
    websocket_api.async_register_command(hass, websocket_set_config)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Remove the sidebar entry again when the integration is removed."""
    from homeassistant.components import frontend

    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    hass.data.pop(DOMAIN, None)
    return True


@callback
@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get"})
def websocket_get_config(hass: HomeAssistant, connection, msg: dict) -> None:
    """Return the stored configuration; {} means the panel should use its defaults."""
    connection.send_result(msg["id"], hass.data[DOMAIN]["config"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/set", vol.Required("config"): dict}
)
@websocket_api.async_response
async def websocket_set_config(hass: HomeAssistant, connection, msg: dict) -> None:
    """Replace the stored configuration. Admin only — it defines the whole dashboard."""
    hass.data[DOMAIN]["config"] = msg["config"]
    await hass.data[DOMAIN]["store"].async_save(msg["config"])
    connection.send_result(msg["id"], {"saved": True})
