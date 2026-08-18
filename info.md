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
