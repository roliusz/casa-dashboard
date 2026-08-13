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

from aiohttp import web

from homeassistant.components import panel_custom, websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store
from homeassistant.loader import async_get_integration

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
    served = hass.data.get(DOMAIN, {}).get("view", False)
    hass.data[DOMAIN] = {"store": store, "config": await store.async_load() or {}, "view": served}

    # serve <integration>/frontend as /casa_dashboard/... so no files need copying to /www
    if not hass.data[DOMAIN].get("view"):
        hass.http.register_view(CasaFrontendView())
        hass.data[DOMAIN]["view"] = True

    # The version is carried in the URL and the panel propagates it to its own imports, so an
    # update is picked up instead of a stale module being served from the browser cache.
    version = (await async_get_integration(hass, DOMAIN)).version

    # add the sidebar entry ourselves — no panel_custom: block in configuration.yaml
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name="casa-panel",
        module_url=f"{URL_BASE}/casa-panel.js?v={version}",
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
    hass.data[DOMAIN] = {"view": hass.data.get(DOMAIN, {}).get("view", False)}
    return True


class CasaFrontendView(HomeAssistantView):
    """Serve the bundled frontend, always revalidated.

    The default static handler lets a browser decide for itself how long a file stays fresh, which
    is how an edited panel can keep loading an old module. `no-cache` does not mean "do not cache":
    the browser keeps the file but asks every time, so an unchanged file costs a 304 and a changed
    one arrives immediately. No restart, no version bump — just reload the page.
    """

    url = URL_BASE + "/{filename:.+}"
    name = f"{DOMAIN}:frontend"
    requires_auth = False

    async def get(self, request: web.Request, filename: str) -> web.StreamResponse:
        root = (Path(__file__).parent / "frontend").resolve()
        target = (root / filename).resolve()
        if not target.is_relative_to(root) or not target.is_file():   # no escaping frontend/
            return web.Response(status=404)
        return web.FileResponse(target, headers={"Cache-Control": "no-cache"})


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
