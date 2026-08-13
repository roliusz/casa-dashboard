/**
 * Casa Layout — the shape of a dashboard.
 *
 *   header   the pills across the top
 *   sidebar  the left column: clock, date, greeting, any sensor pills
 *   tabs     the row of tabs; each holds sections, each section holds cards
 *
 * Every element carries `show` (mobile / desktop) and may carry `visibleWhen`, so a tab or card
 * can hide itself when nothing is playing, nobody is home, and so on.
 *
 * A tab is either `custom` (you place the cards) or `auto` (you pick entities and they are sorted
 * into sections by what they are). Both the renderer and the editor read this file.
 */

// One row is a light card. Everything else is a whole number of rows on top of that:
//   light 1 row = 74px · shade/speaker/TV 2 rows = 162px · climate 3 rows = 250px
export const GRID_ROW = 74;
export const GRID_GAP = 14;
export const DEFAULT_COLS = 4;   // four cards across a full-width section

export const CARD_TYPES = {
  small:   { label: "Small",   sub: "One line",  icon: "mdi:view-sequential", w: 1, h: 1, minW: 1, maxH: 2 },
  compact: { label: "Compact", sub: "Two lines", icon: "mdi:view-agenda",     w: 1, h: 2, minW: 1, maxH: 4 },
  tile:    { label: "Tile",    sub: "Square",    icon: "mdi:square-rounded",  w: 1, h: 2, minW: 1, square: true },
  full:    { label: "Full",    sub: "Media hero",icon: "mdi:view-dashboard",  w: 4, h: 5, minW: 2, minH: 4,
             domains: ["media_player"] },
};

/**
 * How many rows a square tile needs to actually come out square.
 * Columns are fluid (1fr) while rows are fixed, so the span has to be worked out from the measured
 * column width — otherwise "square" is only square at one window size.
 */
export function tileRows(colWidth, w = 1) {
  if (!colWidth) return CARD_TYPES.tile.h;
  const side = colWidth * w + GRID_GAP * (w - 1);
  return Math.max(1, Math.round((side + GRID_GAP) / (GRID_ROW + GRID_GAP)));
}

/** Sidebar pieces a user can add. */
export const SIDEBAR_TYPES = {
  clock:    { label: "Clock",    icon: "mdi:clock-outline" },
  date:     { label: "Date",     icon: "mdi:calendar" },
  greeting: { label: "Greeting", icon: "mdi:hand-wave" },
  sensor:   { label: "Sensor pill", icon: "mdi:gauge", needsEntity: true },
};

/** Header pills. */
export const PILL_TYPES = {
  weather:  { label: "Weather",  icon: "mdi:weather-partly-cloudy", needsEntity: true },
  people:   { label: "People",   icon: "mdi:account-group" },
  sensor:   { label: "Sensor",   icon: "mdi:gauge", needsEntity: true },
  entity:   { label: "Toggle",   icon: "mdi:toggle-switch", needsEntity: true },
};

/** Domain -> which section an auto tab files it under, and how it should look. */
export const CATEGORIES = [
  { key: "lights",  name: "Lights",     icon: "mdi:lightbulb",    domains: ["light"],                 card: "small", h: 1 },
  { key: "climate", name: "Climate",    icon: "mdi:thermostat",   domains: ["climate"],               card: "compact", h: 3 },
  { key: "media",   name: "Media",      icon: "mdi:play-circle",  domains: ["media_player"],          card: "compact", h: 2 },
  { key: "shades",  name: "Shades",     icon: "mdi:blinds",       domains: ["cover"],                 card: "compact", h: 2 },
  { key: "locks",   name: "Door locks", icon: "mdi:lock",         domains: ["lock"],                  card: "small", h: 1  },
  { key: "fans",    name: "Fans",       icon: "mdi:fan",          domains: ["fan"],                   card: "small", h: 1  },
  { key: "scenes",  name: "Scenes",     icon: "mdi:creation",     domains: ["scene", "script"],       card: "tile"   },
  { key: "power",   name: "Switches",   icon: "mdi:toggle-switch",domains: ["switch", "input_boolean"], card: "small", h: 1 },
  { key: "sensors", name: "Sensors",    icon: "mdi:gauge",        domains: ["sensor", "binary_sensor"], card: "small", h: 1 },
  { key: "other",   name: "Other",      icon: "mdi:shape-outline",domains: [],                        card: "small"  },
];

export const categoryFor = (entity) => {
  const d = String(entity || "").split(".")[0];
  return CATEGORIES.find((c) => c.domains.includes(d)) || CATEGORIES[CATEGORIES.length - 1];
};

let _seq = 0;
export const uid = (p = "c") => `${p}${Date.now().toString(36)}${(_seq++).toString(36)}`;

/** At least one of mobile/desktop must stay on — the editor enforces it, this is the default. */
export const bothShown = () => ({ mobile: true, desktop: true });

export const newCard = (type, entity = "") => {
  const t = CARD_TYPES[type] || CARD_TYPES.small;
  return { id: uid("c"), type, entity, w: t.w, h: t.square ? t.w : t.h, show: bothShown() };
};
export const newSection = (name = "Section") => ({ id: uid("s"), name, cols: DEFAULT_COLS, cards: [], show: bothShown() });
export const newTab = (name = "Tab", icon = "mdi:view-dashboard") =>
  ({ id: uid("t"), name, icon, kind: "custom", show: bothShown(), sections: [newSection("Main")] });
export const newAutoTab = (name = "All", icon = "mdi:apps") =>
  ({ id: uid("t"), name, icon, kind: "auto", show: bothShown(), entities: [] });
export const newPill = (type = "sensor", entity = "") => ({ id: uid("p"), type, entity, show: bothShown() });
export const newSidebarItem = (type = "clock", entity = "") => ({ id: uid("b"), type, entity, show: bothShown() });

export const typeAllowed = (type, entity) => {
  const t = CARD_TYPES[type];
  if (!t?.domains) return true;
  return t.domains.includes(String(entity || "").split(".")[0]);
};

/**
 * The shortest each design can be drawn without losing something. Rows are a fixed height — that is
 * what stops one card from resizing its neighbours — so a card given fewer rows than its design
 * needs has nowhere to put the overflow. The resize handle stops here instead.
 */
export const MIN_ROWS = {
  climate: 1,        // three rows or more switches to the full design with its stepper
  media_player: 1,
  cover: 1,
};

export function minRows(card) {
  const t = CARD_TYPES[card.type] || CARD_TYPES.small;
  if (t.square) return 1;                                   // tiles follow their width
  const byDesign = MIN_ROWS[String(card.entity || "").split(".")[0]] || 1;
  return Math.max(1, t.minH || 1, card.type === "full" ? 1 : byDesign);
}

/**
 * The tallest each design has anything to put. A light is one line whatever you do with it, so
 * dragging it to three rows only adds emptiness; climate, covers and media have a tall design and
 * can use three. Past this the handle simply stops.
 */
export const MAX_ROWS = { climate: 3, cover: 3, media_player: 3 };

export function maxRows(card) {
  const t = CARD_TYPES[card.type] || CARD_TYPES.small;
  if (t.square) return 99;                                  // a tile's height is its width
  if (card.type === "full") return t.maxH || 6;
  return MAX_ROWS[String(card.entity || "").split(".")[0]] || 1;
}

export function clampCard(card, cols) {
  const t = CARD_TYPES[card.type] || CARD_TYPES.small;
  card.w = Math.max(t.minW || 1, Math.min(cols, card.w || t.w));
  card.h = t.square ? card.w : Math.max(minRows(card), Math.min(maxRows(card), t.maxH || 6, card.h || t.h));
  return card;
}

/** Is this element shown on the current screen, and does its condition hold? */
export function isVisible(item, narrow, hass) {
  const show = item?.show;
  if (show && (narrow ? show.mobile === false : show.desktop === false)) return false;
  const c = item?.visibleWhen;
  if (!c?.entity) return true;
  const st = hass?.states?.[c.entity];
  if (!st) return false;
  if (c.notState) return st.state !== c.notState;
  if (c.state) return st.state === c.state;
  return !["off", "unavailable", "unknown", "idle"].includes(st.state);   // "is active"
}

/** Build the sections of an `auto` tab: chosen entities, grouped by what they are. */
export function autoSections(tab) {
  const groups = new Map();
  for (const e of tab.entities || []) {
    const cat = categoryFor(e);
    if (!groups.has(cat.key)) groups.set(cat.key, { cat, items: [] });
    groups.get(cat.key).items.push(e);
  }
  return CATEGORIES.filter((c) => groups.has(c.key)).map((c) => {
    const g = groups.get(c.key);
    return {
      id: `auto-${c.key}`, name: c.name, cols: DEFAULT_COLS, auto: true, show: bothShown(),
      cards: g.items.map((e) => {
        const card = newCard(c.card, e);
        if (c.h) card.h = c.h;                    // category knows how tall its design needs to be
        return clampCard(card, DEFAULT_COLS);
      }),
    };
  });
}

/** Sections to render for a tab, whichever kind it is. */
export const sectionsOf = (tab) => (tab.kind === "auto" ? autoSections(tab) : tab.sections || []);

/** A blank dashboard: nothing assumed about the home, one empty tab to build in. */
export const starterLayout = () => ({
  header: { pills: [] },
  sidebar: { items: [] },
  tabs: [newTab("Home", "mdi:home")],
});
