# Casa Dashboard

A glass-styled dashboard for Home Assistant that you build by dragging, not by writing YAML.

Install the integration, open **Casa** in the sidebar, press the pencil, and lay out your home.
Nothing is assumed about your setup — you start with an empty dashboard and add what you have.

## Features

- **In-place visual editor.** Press the pencil and the dashboard you are looking at becomes
  editable. Drag cards to reorder, drag a corner to resize, tap a card to open its inspector.
- **Four card shapes**, each matching a design rather than a generic template: *Small* (one line),
  *Compact* (two lines), *Expanded* (square), and *Full* — a media hero, which only accepts
  `media_player` entities.
- **Widgets.** Cards that are not about one entity — clock, date, greeting, people,
  weather, energy, a room switch, a counter, a climate panel, a heading or a spacer.
- **Tabs and sections.** Group cards however you like, or add an **automatic tab**: pick entities
  and they are sorted into Lights, Climate, Media, Shades, Locks, Fans, Scenes, Switches and
  Sensors for you.
- **Per-screen visibility.** Every pill, tab, section and card can be shown on mobile, on desktop,
  or both — at least one must stay on.
- **Conditional cards.** Hide a card or a whole tab unless an entity is in a given state, so the
  media tab only appears when something is playing.
- **Header pills and a sidebar** for the clock, the date, a greeting, weather, people and sensors.
- **Your own wallpaper**, or the built-in gradient.

Your layout is stored in Home Assistant's own `.storage`. Nothing leaves your instance and the
integration makes no outbound connections.

## Requirements

Home Assistant **2024.11** or newer.

## Installation

### HACS

1. HACS → ⋮ → **Custom repositories** → add this repository, category **Integration**.
2. Install **Casa Dashboard**, then restart Home Assistant.
3. **Settings → Devices & Services → Add Integration → Casa Dashboard**.

### Manual

1. Copy `custom_components/casa_dashboard` into your Home Assistant `custom_components` folder.
2. Restart Home Assistant.
3. **Settings → Devices & Services → Add Integration → Casa Dashboard**.

**Casa** appears in the sidebar. There is nothing to add to `configuration.yaml` and nothing to
copy into `www/`.

## Opening Casa by default

Home Assistant's default-dashboard setting only offers *dashboards*, and Casa is a *panel* — a
sidebar entry — so it will not appear in that list. To land on Casa when you open Home Assistant
or the companion app, wrap it in a dashboard of its own. It takes a minute, once.

1. **Settings → Dashboards → + Add dashboard → New dashboard from scratch.** Call it `Casa`, and
   turn **Show in sidebar** off — the integration already puts Casa there.
2. Open the new dashboard, then **✏️ → ⋮ → Raw configuration editor**.
3. Replace everything in it with:

   ```yaml
   views:
     - type: panel
       title: Casa
       cards:
         - type: custom:casa-panel
   ```

4. **Save**, then **Settings → Dashboards → ⋮** on that row → **Set as default**.

The default is stored per user, so everyone in the house sets their own — and each can choose
something different.

### Which one to point at

|  | Home Assistant's toolbar | Can be the default dashboard |
|---|---|---|
| **`/casa`** — the sidebar entry | none, the panel fills the screen | no |
| **the wrapper dashboard** | shown | yes |

On a wall display, point the browser straight at `/casa` and there is no toolbar to hide. The
wrapper only earns its place if you want Home Assistant to *open* on Casa.

### Hiding the toolbar and sidebar

Home Assistant has no setting for this, and Casa cannot do it from inside a card — the toolbar is
not ours to remove. If you already use [kiosk-mode](https://github.com/NemesisRE/kiosk-mode), it
can, either in the dashboard's raw configuration:

```yaml
kiosk_mode:
  hide_header: true
  hide_sidebar: true
views:
  - type: panel
    title: Casa
    cards:
      - type: custom:casa-panel
```

…or per URL, which needs no configuration at all — useful for a Fully Kiosk start URL, a bookmark
or a homescreen shortcut:

```
/dashboard-casa?hide_header&hide_sidebar
```

`?kiosk` is shorthand for both. Separate several with `&`, and only the first takes the `?`. Adding
`&cache` makes the choice stick across dashboards on that device.

Note that the default-dashboard setting stores a path and not a URL, so it cannot carry a query
string — open the app that way and the toolbar returns. `kiosk_mode:` in the config is the one that
survives, and it also takes `admin_settings`, `non_admin_settings`, `user_settings` and
`mobile_settings` if you want the toolbar gone on the tablets but kept on your desktop.

## Using the editor

| | |
|---|---|
| ✏️ | Enter edit mode — every element gains a handle and an edit button |
| ➕ | Add a pill, sidebar item, tab, section or card |
| drag | Reorder cards within a section |
| corner | Resize a card; the grid is 4 columns wide by default |
| ⚙️ | Dashboard name, wallpaper, and *Start over* |

Editing requires an administrator account. Everyone else sees the dashboard read-only.

## Development

Deploy to a real Home Assistant:

```bash
HA_CONFIG=/path/to/your/homeassistant ./scripts/deploy.sh
```

Restart Home Assistant after the first copy. After that, only Python changes need a restart —
the frontend is served with `Cache-Control: no-cache`, so editing a `.js` file and reloading the
page is enough.

There is also a standalone harness in `dev/` that runs the dashboard against a fake home, with no
Home Assistant involved — useful for working on layout and for taking screenshots:

```bash
python3 -m http.server 8777
# then open http://localhost:8777/dev/
```

## Third-party code

`custom_components/casa_dashboard/frontend/lit-all.min.js` is [Lit](https://lit.dev),
© Google LLC, BSD-3-Clause. Its license header is preserved in the file.

## License

MIT — see [LICENSE](LICENSE).
