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
export const GRID_ROW = 58;
export const GRID_GAP = 11;
export const COL_W = 228;        // px per column — what one card's width actually is
export const TAB_COLS = 6;       // a tab is six columns wide; a section takes some of them, so
                                 // two three-column sections sit side by side
export const DEFAULT_COLS = 6;   // a new section is full width until it is narrowed

export const CARD_TYPES = {
  small:   { label: "Small",   sub: "One line",  icon: "mdi:view-sequential", w: 1, h: 1, minW: 1, maxH: 2 },
  compact: { label: "Compact", sub: "Two lines", icon: "mdi:view-agenda",     w: 1, h: 2, minW: 1, maxH: 4 },
  tile:    { label: "Expanded", sub: "Square",   icon: "mdi:square-rounded",  w: 1, h: 2, minW: 1, square: true },
  full:    { label: "Full",    sub: "Media hero",icon: "mdi:view-dashboard",  w: 4, h: 5, minW: 2, minH: 4,
             domains: ["media_player"] },
  // The escape hatch: the other types decide their own size, this one hands it to the user.
  custom:  { label: "Custom",  sub: "Any size",  icon: "mdi:resize",          w: 2, h: 2, minW: 1, maxH: 6, free: true },
};

/**
 * How many rows a square tile needs to actually come out square.
 * Columns are fluid (1fr) while rows are fixed, so the span has to be worked out from the measured
 * column width — otherwise "square" is only square at one window size.
 */
export function tileRows(colWidth, w = 1) {
  if (!colWidth) return CARD_TYPES.tile.h;
  const side = colWidth * w + GRID_GAP * (w - 1);
  // Nearest whole row: a tile fills the rows it reserves, so every card height composes with
  // every other. That makes a tile approximately square rather than exactly square — the price
  // of a three-row card being the same height as a two-row and a one-row stacked beside it.
  // Never fewer than two rows: in a narrow column — sections sitting side by side, say — a square
  // would resolve to a single row and stand shorter than every compact card beside it.
  return Math.max(2, Math.round((side + GRID_GAP) / (GRID_ROW + GRID_GAP)));
}

/** Sidebar pieces a user can add. */
export const SIDEBAR_TYPES = {
  clock:    { label: "Clock",    icon: "mdi:clock-outline", size: 44 },
  date:     { label: "Date",     icon: "mdi:calendar", size: 13 },
  greeting: { label: "Greeting", icon: "mdi:hand-wave", size: 26 },
  sensor:   { label: "Sensor pill", icon: "mdi:gauge", needsEntity: true },
  gap:      { label: "Gap",      icon: "mdi:arrow-expand-vertical", size: 24 },
};

/** Type faces offered for the clock — families every browser has, so nothing is downloaded. */
export const FONTS = {
  "":         { label: "Dashboard", stack: "inherit" },
  system:     { label: "System",    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  rounded:    { label: "Rounded",   stack: "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif" },
  serif:      { label: "Serif",     stack: "ui-serif, Georgia, 'Times New Roman', serif" },
  mono:       { label: "Mono",      stack: "ui-monospace, SFMono-Regular, Menlo, monospace" },
};

/**
 * Cards that are not about one entity — the dashboard's own furniture. They sit on a custom tab
 * alongside entity cards and are sized by the same grid.
 */
export const WIDGET_TYPES = {
  clock:    { label: "Clock",    icon: "mdi:clock-outline",         w: 2, h: 1 },
  date:     { label: "Date",     icon: "mdi:calendar",              w: 2, h: 1 },
  greeting: { label: "Greeting", icon: "mdi:hand-wave",             w: 2, h: 1 },
  people:   { label: "People",   icon: "mdi:account-group",         w: 1, h: 1 },
  weather:  { label: "Weather",  icon: "mdi:weather-partly-cloudy", w: 2, h: 3, needsEntity: true },
  heading:  { label: "Heading",  icon: "mdi:format-title",          w: 3, h: 1 },
  spacer:   { label: "Spacer",   icon: "mdi:arrow-expand-vertical", w: 1, h: 1 },

  // These take a list of entities the user picks, rather than one.
  rooms:    { label: "Room switch", icon: "mdi:lightbulb-group",  w: 3, h: 1, needsEntities: true },
  counter:  { label: "Counter",     icon: "mdi:counter",          w: 2, h: 2, needsEntities: true },
  climate:  { label: "Climate",     icon: "mdi:thermostat",       w: 4, h: 4, needsEntities: true },
  energy:   { label: "Energy",      icon: "mdi:lightning-bolt",   w: 4, h: 4, needsEntity: true },
};

export const newWidget = (widget, entity = "") => {
  const w = WIDGET_TYPES[widget] || WIDGET_TYPES.clock;
  return { id: uid("c"), type: "compact", widget, entity, entities: [], x: 0, y: 0, w: w.w, h: w.h, show: bothShown() };
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
  { key: "climate", name: "Climate",    icon: "mdi:thermostat",   domains: ["climate"],               card: "tile" },
  { key: "media",   name: "Media",      icon: "mdi:play-circle",  domains: ["media_player"],          card: "compact", h: 2 },
  { key: "shades",  name: "Shades",     icon: "mdi:blinds",       domains: ["cover"],                 card: "compact", h: 2 },
  { key: "locks",   name: "Door locks", icon: "mdi:lock",         domains: ["lock"],                  card: "compact", h: 2 },
  { key: "fans",    name: "Fans",       icon: "mdi:fan",          domains: ["fan"],                   card: "compact", h: 2 },
  { key: "security",name: "Security",   icon: "mdi:shield-home",  domains: ["alarm_control_panel"],   card: "compact", h: 2 },
  { key: "cleaning",name: "Cleaning",   icon: "mdi:robot-vacuum", domains: ["vacuum"],                card: "compact", h: 2 },
  { key: "scenes",  name: "Scenes",     icon: "mdi:creation",     domains: ["scene", "script", "automation"], card: "small", h: 1 },
  { key: "power",   name: "Switches",   icon: "mdi:toggle-switch",domains: ["switch", "input_boolean"], card: "small", h: 1 },
  { key: "sensors", name: "Sensors",    icon: "mdi:gauge",        domains: ["sensor", "binary_sensor"], card: "small", h: 1 },
  { key: "other",   name: "Other",      icon: "mdi:shape-outline",domains: [],                        card: "small"  },
];

/**
 * The room an entity sits in, via its own area or its device's. Returns null when Home Assistant
 * has no area for it — a home that has never assigned areas groups by kind instead.
 */
export function areaOf(hass, entity, areas) {
  if (areas && areas[entity]) return areas[entity];          // resolved from the registries
  const ent = hass?.entities?.[entity];
  if (!ent) return null;
  const id = ent.area_id || (ent.device_id ? hass?.devices?.[ent.device_id]?.area_id : null);
  return id ? hass?.areas?.[id]?.name || id : null;
}

/** Entity -> room name, from the three registries. What `hass` carries is not always populated. */
export function areaMap(areaList, deviceList, entityList) {
  const areaName = {};
  for (const a of areaList || []) areaName[a.area_id] = a.name;
  const deviceArea = {};
  for (const d of deviceList || []) if (d.area_id) deviceArea[d.id] = d.area_id;
  const out = {};
  for (const e of entityList || []) {
    const id = e.area_id || (e.device_id ? deviceArea[e.device_id] : null);
    if (id && areaName[id]) out[e.entity_id] = areaName[id];
  }
  return out;
}

/**
 * The states a domain realistically sits in, for the "only show when" picker. Home Assistant does
 * not publish a domain's possible states, so this is the practical list; the entity's own current
 * state is always offered alongside, and anything can still be typed by hand.
 */
export const DOMAIN_STATES = {
  light: ["on", "off"],
  switch: ["on", "off"],
  input_boolean: ["on", "off"],
  fan: ["on", "off"],
  binary_sensor: ["on", "off"],
  media_player: ["playing", "paused", "idle", "off", "on", "standby", "buffering"],
  cover: ["open", "closed", "opening", "closing"],
  climate: ["off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only"],
  lock: ["locked", "unlocked", "locking", "unlocking", "jammed"],
  person: ["home", "not_home"],
  device_tracker: ["home", "not_home"],
  alarm_control_panel: ["disarmed", "armed_home", "armed_away", "arming", "pending", "triggered"],
  vacuum: ["cleaning", "docked", "paused", "idle", "returning", "error"],
  update: ["on", "off"],
  timer: ["idle", "active", "paused"],
  weather: ["sunny", "cloudy", "partlycloudy", "rainy", "pouring", "snowy", "fog", "windy"],
};

/** Every state worth offering for an entity: its domain's list, plus whatever it is right now. */
export function statesFor(hass, entity) {
  const st = hass?.states?.[entity];
  const list = [...(DOMAIN_STATES[String(entity || "").split(".")[0]] || [])];
  if (st?.state && !list.includes(st.state)) list.unshift(st.state);
  if (Array.isArray(st?.attributes?.options)) for (const o of st.attributes.options)
    if (!list.includes(o)) list.push(o);              // select / input_select publish their own
  return list;
}

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
  // A design that needs more room than its type's default gets it — the same height an auto tab
  // would give it, so a card added by hand matches one generated for you.
  const cat = entity ? categoryFor(entity) : null;
  const h = t.square ? t.w : (type === "full" ? t.h : Math.max(t.h, cat?.h || 0));
  return { id: uid("c"), type, entity, x: 0, y: 0, w: t.w, h, show: bothShown() };
};
/** `cols` is the section's width in tab columns *and* the number of card columns inside it. */
export const newSection = (name = "Section") => ({ id: uid("s"), name, cols: DEFAULT_COLS, cards: [], show: bothShown() });
export const newTab = (name = "Tab", icon = "mdi:view-dashboard") =>
  ({ id: uid("t"), name, icon, kind: "custom", show: bothShown(), sections: [newSection("Main")] });
export const newAutoTab = (name = "All", icon = "mdi:apps") =>
  ({ id: uid("t"), name, icon, kind: "auto", show: bothShown(), entities: [] });
export const newPill = (type = "sensor", entity = "") => ({ id: uid("p"), type, entity, show: bothShown() });
export const newSidebarItem = (type = "clock", entity = "") =>
  ({ id: uid("b"), type, entity, size: SIDEBAR_TYPES[type]?.size, show: bothShown() });

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

/* ---------------------------------------------------------------- placement */

const rectOf = (c, rowsOf) => ({ x: c.x | 0, y: c.y | 0, w: c.w, h: rowsOf ? rowsOf(c) : c.h });
const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Is (x,y) free for `card` — ignoring the card itself? */
export function slotFree(cards, card, x, y, cols, rowsOf) {
  const h = rowsOf ? rowsOf(card) : card.h;
  if (x < 0 || y < 0 || x + card.w > cols) return false;
  const me = { x, y, w: card.w, h };
  return !cards.some((o) => o !== card && hits(rectOf(o, rowsOf), me));
}

/**
 * Where a card should actually land. A drop is honoured wherever it is dropped; only if that
 * overlaps something does it look for the closest free slot instead, so a drag never fails
 * silently and never buries one card under another.
 */
/**
 * Settle a section so nothing overlaps: take the cards in the order they should win their space,
 * and drop each one down the grid until it lands clear of everything already placed. Gravity, not
 * a free-for-all — a card can be put anywhere, including directly under another, and whatever it
 * lands on moves down instead of being painted over.
 *
 * `first` is the card being dragged: it keeps the cell it was dropped on and the rest give way.
 */
export const cardRows = (c) => (c.type === "tile" ? tileRows(COL_W, c.w || 1) : c.h);

export function compactCards(cards, cols, rowsOf = cardRows, first = null) {
  const hits = (a, ay, b) => {
    const ah = rowsOf(a), bh = rowsOf(b);
    return a.x < b.x + b.w && b.x < a.x + a.w && ay < b.y + bh && b.y < ay + ah;
  };
  // Order by where each card currently sits — that is the arrangement the user can see — with the
  // card being dragged winning any tie, so dropping it on an occupied cell takes that cell.
  const order = [...cards].sort((p, q) =>
    (p.y - q.y) || (p.x - q.x) || (p === first ? -1 : q === first ? 1 : 0));
  const placed = [];
  for (const c of order) {
    c.w = Math.max(1, Math.min(cols, c.w | 0 || 1));
    c.x = Math.max(0, Math.min(cols - c.w, c.x | 0));
    // Gravity: every card falls to the first row that will hold it. Nothing floats, so a card
    // dropped near the bottom settles under its neighbour rather than leaving rows of empty space.
    let y = 0;
    while (placed.some((p) => hits(c, y, p))) y++;
    c.y = y;
    placed.push(c);
  }
  return cards;
}

export function placeNear(cards, card, wantX, wantY, cols, rowsOf) {
  const x0 = Math.max(0, Math.min(cols - card.w, Math.round(wantX)));
  const y0 = Math.max(0, Math.round(wantY));
  if (slotFree(cards, card, x0, y0, cols, rowsOf)) return { x: x0, y: y0 };
  let best = null;
  for (let y = 0; y <= y0 + 12; y++)
    for (let x = 0; x + card.w <= cols; x++) {
      if (!slotFree(cards, card, x, y, cols, rowsOf)) continue;
      const d = Math.abs(x - x0) + Math.abs(y - y0) * 1.4;   // a nudge sideways beats a jump down
      if (!best || d < best.d) best = { x, y, d };
    }
  return best ? { x: best.x, y: best.y } : { x: x0, y: y0 };
}

/** How many rows a section needs. */
export const sectionRows = (section, rowsOf) =>
  (section.cards || []).reduce((m, c) => Math.max(m, (c.y | 0) + (rowsOf ? rowsOf(c) : c.h)), 0);

export function clampCard(card, cols) {
  if (card.widget) {
    const t = WIDGET_TYPES[card.widget];
    card.w = Math.max(1, Math.min(cols, card.w | 0 || 1));
    card.h = Math.max(t?.minH || 1, Math.min(6, card.h | 0 || 1));
    return card;
  }
  const t = CARD_TYPES[card.type] || CARD_TYPES.small;
  card.w = Math.max(t.minW || 1, Math.min(cols, card.w || t.w));
  // A tile's height is the rows it actually occupies, not its column span — placing it by the
  // span stacked tiles on top of each other.
  card.h = t.square ? tileRows(COL_W, card.w)
    : Math.max(minRows(card), Math.min(t.maxH || 6, card.h || t.h));
  card.x = Math.max(0, Math.min(cols - card.w, card.x | 0));
  card.y = Math.max(0, card.y | 0);
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
  // `state` may be one state or several — any of them counts as a match.
  if (c.state) return (Array.isArray(c.state) ? c.state : [c.state]).includes(st.state);
  return !["off", "unavailable", "unknown", "idle"].includes(st.state);   // "is active"
}

/** Build the sections of an `auto` tab: chosen entities, grouped by what they are. */
export function autoSections(tab, hass, filter, areas, extraRooms = [], sizes = {}) {
  const only = filter || tab.filter;
  const entities = (tab.entities || []).filter((e) => !only || categoryFor(e).key === only);

  const build = (name, id, items) => ({
    id, name, room: name, cols: DEFAULT_COLS, auto: true, show: bothShown(),
    cards: items.reduce((acc, e) => {
      const cat = categoryFor(e);
      const card = newCard(cat.card, e);
      if (cat.h) card.h = cat.h;
      const size = sizes[e];                       // size and position the user set for this entity
      if (size?.type) card.type = size.type;
      if (size?.w) card.w = size.w;
      if (size?.h) card.h = size.h;
      clampCard(card, DEFAULT_COLS);
      // Stored positions belong to the unfiltered view. A filter shows a subset, so keeping them
      // would leave a hole wherever a hidden card used to sit — pack instead.
      if (!only && size?.x != null) card.x = size.x;
      if (!only && size?.y != null) card.y = size.y;
      if (only || size?.x == null) Object.assign(card, placeNear(acc, card, 0, 0, DEFAULT_COLS));
      acc.push(card);
      return acc;
    }, []),
  });

  const settle = (sec) => (compactCards(sec.cards, sec.cols), sec);

  // Sections are rooms, always. The chips above already do the sorting by kind, so doing it
  // again here would just repeat them.
  const rooms = new Map();
  const loose = [];
  for (const e of entities) {
    const room = areaOf(hass, e, areas);
    if (!room) { loose.push(e); continue; }
    if (!rooms.has(room)) rooms.set(room, []);
    rooms.get(room).push(e);
  }
  // Rooms added here that nothing lives in yet still get a section, so there is somewhere to drag
  // cards to. The view drops the empty ones once editing stops.
  for (const r of extraRooms) if (!rooms.has(r)) rooms.set(r, []);
  if (!rooms.size) return [settle(build("", "auto-all", loose))];      // no rooms anywhere: one plain list
  return [
    ...[...rooms.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([room, items]) => settle(build(room, `auto-room-${room}`, items))),
    ...(loose.length ? [{ ...settle(build("Other", "auto-room-other", loose)), room: "" }] : []),
  ];
}

/** The kinds present in an auto tab's selection — the filter chips shown above it. */
export function autoCategories(tab) {
  const present = new Set((tab.entities || []).map((e) => categoryFor(e).key));
  return CATEGORIES.filter((c) => present.has(c.key));
}

/** Sections to render for a tab, whichever kind it is. */
export const sectionsOf = (tab, hass, filter, areas, extraRooms, sizes) =>
  (tab.kind === "auto" ? autoSections(tab, hass, filter, areas, extraRooms, sizes) : tab.sections || []);

/** Bring a stored layout in line with the current limits — sizes saved before they existed. */
export function normalizeLayout(layout, rowsOf) {
  for (const tab of layout?.tabs || [])
    for (const sec of tab.sections || []) {
      sec.cols = Math.max(1, Math.min(TAB_COLS, sec.cols || DEFAULT_COLS));
      const placed = [];
      for (const card of sec.cards || []) {
        // ask before clamping — clampCard defaults a missing position to 0,0, which would look
        // like a card that had genuinely been placed in the corner
        const placedAlready = card.x != null && card.y != null;
        clampCard(card, sec.cols);
        if (!placedAlready) {                            // saved before cards had a position
          const at = placeNear(placed, card, 0, 0, sec.cols, rowsOf);
          card.x = at.x; card.y = at.y;
        }
        placed.push(card);
      }
    }
  return layout;
}

/** A blank dashboard: nothing assumed about the home, one empty tab to build in. */
export const starterLayout = () => ({
  header: { pills: [] },
  sidebar: { items: [] },
  tabs: [newTab("Home", "mdi:home")],
});
