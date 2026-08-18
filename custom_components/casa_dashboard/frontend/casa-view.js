/**
 * Casa View — renders a dashboard from its layout and edits it in place.
 *
 * Edit mode (the pencil in the header) keeps you on the page: a "+" appears beside the header pills,
 * the sidebar and the tab row whether or not anything is there yet, and every element grows a pencil
 * that opens an inspector for just that item. Each inspector carries the mobile / desktop toggles,
 * and refuses to let you switch both off.
 */
// The panel is loaded with a ?v=<integration version> query. Propagating that query to every
// import means a HACS update can never leave a stale module cached in someone's browser.
const V = new URL(import.meta.url).search;
const { LitElement, html, css, unsafeCSS } = await import(`./lit-all.min.js${V}`);
const {
  CARD_TYPES, CATEGORIES, COL_W, FONTS, GRID_GAP, GRID_ROW, PILL_TYPES, SIDEBAR_TYPES, TAB_COLS,
  areaOf, cardRows, statesFor, tileRows,
  WIDGET_TYPES, autoCategories, bothShown, categoryFor, clampCard, isVisible, newAutoTab, newCard, newPill, newSection,
  newWidget,
  compactCards, newSidebarItem, newTab, sectionsOf, starterLayout, typeAllowed,
} = await import(`./casa-layout.js${V}`);
const { renderCard, cardStyles, stateIcon } = await import(`./casa-cards.js${V}`);

/** How far a tab may lift off the row. The row reserves exactly this much, so nothing is clipped. */
const TAB_LIFT_Y = 8;

/** Below this the layout stacks: one section to a row, and no more than this many card columns. */
const STACK_W = 760;
const STACK_COLS = 2;

const DOMAIN_ICON = {
  light: "mdi:lightbulb", switch: "mdi:toggle-switch", media_player: "mdi:speaker", cover: "mdi:blinds",
  climate: "mdi:thermostat", sensor: "mdi:eye", binary_sensor: "mdi:radiobox-marked",
  scene: "mdi:creation", script: "mdi:play", fan: "mdi:fan", lock: "mdi:lock", weather: "mdi:weather-partly-cloudy",
};
const iconFor = (e) => DOMAIN_ICON[String(e || "").split(".")[0]] || "mdi:card-outline";

export class CasaView extends LitElement {
  static properties = {
    hass: { attribute: false },
    layout: { attribute: false },
    editing: { type: Boolean, reflect: true },
    narrow: { type: Boolean },
    areas: { attribute: false },      // entity_id -> room name, from Home Assistant
    areaNames: { attribute: false },  // every room Home Assistant knows
    _tab: { state: true },
    _insp: { state: true },     // {kind:'pill'|'side'|'card'|'tab', …ids}
    _drag: { state: true },
    _pick: { state: true },
    _pickKind: { state: true },
    _picks: { state: true },
    _climT: { state: true },
    _climMenu: { state: true },     // {mode:'card'|'auto'|'pill'|'side', si?}
    _q: { state: true },
    _af: { state: true },       // active filter chip, per auto tab
    _anim: { state: true },     // flips so the entry animation replays
    _roomOver: { state: true }, // section a card is being dragged onto
    _lift: { state: true },     // the card currently under the pointer
    _sideLift: { state: true }, // the sidebar item currently under the pointer
    _tabLift: { state: true },  // the tab currently under the pointer
    _ac: { state: true },       // which entity field is completing
    _acq: { state: true },      // what has been typed into it
  };

  constructor() { super(); this._tab = 0; this._q = ""; this._af = {}; this._anim = 0; }

  // handed to casa-cards so the real cards can act
  get _ctx() {
    return {
      hass: this.hass,
      call: (d, sv, data) => this.hass.callService(d, sv, data),
      more: (entityId) => this.dispatchEvent(new CustomEvent("hass-more-info",
        { detail: { entityId }, bubbles: true, composed: true })),
      // Which room a climate picker is showing. Kept here rather than in the layout: it is where
      // you happen to be looking, not something worth saving.
      energy: (id) => this._energy(id),
      forecast: (id) => this._forecast(id),
      // climate: the previewed target, the scale drag, and which picker menu is open
      target: (entity) => this._climT?.[entity],
      setTarget: (entity, t) => this._setTarget(entity, t),
      scaleDown: (e, entity) => this._scaleDown(e, entity),
      menu: (key) => (this._climMenu?.key === key ? this._climMenu : null),
      openMenu: (key, ev) => {
        if (this._climMenu?.key === key) { this._climMenu = null; return; }
        const r = ev.currentTarget.getBoundingClientRect();
        this._climMenu = { key, up: r.bottom + 240 > window.innerHeight, left: r.right - 180 < 8 };
      },
      closeMenu: () => { this._climMenu = null; },
      pick: (id) => this._picks?.[id],
      setPick: (id, i) => { this._picks = { ...(this._picks || {}), [id]: i }; },
    };
  }

  get _l() {
    if (!this.layout?.tabs?.length) this.layout = starterLayout();
    if (!this.layout.header) this.layout.header = { pills: [] };
    if (!this.layout.sidebar) this.layout.sidebar = { items: [] };
    return this.layout;
  }
  get _tabs() { return this._l.tabs; }
  /**
   * The tab actually on screen. A tab whose condition fails loses its chip but used to keep
   * rendering its sections, so the page showed a tab that was not there — and every card on it
   * looked like it was ignoring the condition. Fall through to the first tab that is showing.
   */
  get _curIdx() {
    const tabs = this._tabs;
    const at = Math.max(0, Math.min(this._tab, tabs.length - 1));
    if (this.editing || !tabs[at] || this._vis(tabs[at])) return at;
    const first = tabs.findIndex((t) => this._vis(t));
    return first < 0 ? at : first;
  }

  get _cur() { return this._tabs[this._curIdx]; }
  /**
   * Cards move by changing grid position, which normally jumps. Measuring before the change and
   * again after, then animating from the old place to the new one, makes the rest of the grid
   * visibly step aside as a card is dragged over it. No library — two measurements and a frame.
   */
  _flipBefore() {
    this._flip = new Map();
    for (const el of this.renderRoot.querySelectorAll(".card, .sit, .tab")) {
      // The "+ Tab" buttons are .tab but carry no key. Keying them all as undefined made them
      // share one entry, so each was animated from whichever one measured last.
      if (!el.dataset.key) continue;
      this._flip.set(el.dataset.key, el.getBoundingClientRect());
    }
  }

  async _flipAfter() {
    const before = this._flip;
    if (!before) return;
    this._flip = null;
    await this.updateComplete;
    if (matchMedia("(prefers-reduced-motion:reduce)").matches) return;
    for (const el of this.renderRoot.querySelectorAll(".card, .sit, .tab")) {
      if (el.classList.contains("lifted")) continue;          // that one follows the pointer
      if (!el.dataset.key) continue;                          // keyless chrome never moves
      const was = before.get(el.dataset.key);
      if (!was) continue;
      const carry = el._spring;                               // keep the velocity it already had
      el.style.transform = "";                                // measure where it has actually landed
      const now = el.getBoundingClientRect();
      const dx = was.left - now.left, dy = was.top - now.top;
      if (!dx && !dy && !carry) continue;
      el._spring = { x: dx, y: dy, vx: carry?.vx || 0, vy: carry?.vy || 0 };
      this._springs.add(el);
    }
    if (this._springs.size && !this._springRaf)
      this._springRaf = requestAnimationFrame(this._springStep);
  }

  /**
   * A spring, not a fixed-length ease. Interrupting one mid-flight keeps its velocity, which is
   * what makes a card being dragged past several others read as one continuous motion instead of
   * a sequence of restarts. Stiffness and damping match the feel of a spring at 350/30.
   */
  _springs = new Set();
  _springRaf = 0;
  _springLast = 0;

  _springStep = (now) => {
    const dt = Math.min(0.032, this._springLast ? (now - this._springLast) / 1000 : 0.016);
    this._springLast = now;
    const k = 350, c = 30;
    for (const el of this._springs) {
      const sp = el._spring;
      sp.vx += (-k * sp.x - c * sp.vx) * dt;
      sp.vy += (-k * sp.y - c * sp.vy) * dt;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      const settled = Math.abs(sp.x) < 0.3 && Math.abs(sp.y) < 0.3
        && Math.abs(sp.vx) < 3 && Math.abs(sp.vy) < 3;
      if (settled) {
        el.style.transform = "";
        el._spring = null;
        this._springs.delete(el);
      } else {
        el.style.transform = `translate(${sp.x.toFixed(2)}px,${sp.y.toFixed(2)}px)`;
      }
    }
    this._springRaf = this._springs.size ? requestAnimationFrame(this._springStep) : 0;
    if (!this._springRaf) this._springLast = 0;
  };

  _emit() {
    this.dispatchEvent(new CustomEvent("layout-changed", { detail: this.layout, bubbles: true, composed: true }));
    this.requestUpdate();
  }
  /** Rooms as this dashboard sees them: Home Assistant's, overridden by anything set here. */
  get _rooms() { return { ...(this.areas || {}), ...(this.layout?.rooms || {}) }; }

  _setRoom(entity, room) {
    this.layout.rooms = { ...(this.layout.rooms || {}) };
    if (room) this.layout.rooms[entity] = room; else delete this.layout.rooms[entity];
    this._emit();
  }

  /** What a widget calls itself when the user has not named it. */
  _widgetName(c) {
    const s = this._st(c.entity);
    return c.entity ? (s?.attributes?.friendly_name || c.entity) : WIDGET_TYPES[c.widget]?.label || "Card";
  }

  /** The zoom the panel is drawing at — rects come back multiplied by it, the constants do not. */
  get _zoom() { return Number(getComputedStyle(this).zoom) || 1; }

  _vis(item) { return this.editing || isVisible(item, this.narrow, this.hass); }

  /**
   * The cards a section actually shows. A card whose condition is not met is left out entirely
   * rather than rendered and dimmed — and the survivors are settled into a copy of the layout, so
   * a hidden card does not leave a hole where it used to sit. The stored positions are untouched:
   * this is only what gets drawn.
   */
/**
   * Daily totals for an energy statistic. Home Assistant keeps long-term statistics, so the past
   * week is one recorder query — but it is a query, not a state, so it is fetched once per entity
   * and held. Refreshed hourly, because today's bar is still growing.
   */
/**
   * Setting a thermostat and holding the value until it is reported back. Without the hold, a
   * stepper press straight after a drag reads the entity's stale target and undoes it.
   */
  _setTarget(entity, temp) {
    const t = Math.round(Math.max(5, Math.min(35, temp)) * 2) / 2;
    this._climT = { ...(this._climT || {}), [entity]: { temp: t } };
    this.hass.callService("climate", "set_temperature", { entity_id: entity, temperature: t });
    clearTimeout(this._climTT);
    this._climTT = setTimeout(() => {
      const held = this._climT?.[entity];
      if (held && held.temp === t) { this._climT = { ...this._climT, [entity]: undefined }; this.requestUpdate(); }
    }, 5000);
    this.requestUpdate();
  }

  /**
   * Dragging the scale. The handle must follow the finger without calling the thermostat on every
   * pixel, so the previewed target drives the render and the call waits for release. A deliberate
   * horizontal movement is required, or the page could not be scrolled from the card.
   */
  _scaleDown(e, entity) {
    const scale = e.currentTarget;
    const box = scale.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false;
    const tempAt = (x) => {
      const p = Math.max(0, Math.min(1, (x - box.left) / box.width));
      return Math.round((17 + p * 11) * 2) / 2;                 // the scale runs 17..28
    };
    const move = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!dragging) {
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 5) { done(); return; }
        if (Math.abs(dx) < 5) return;
        dragging = true;
        try { scale.setPointerCapture(ev.pointerId); } catch (_) {}
      }
      ev.preventDefault();
      const t = tempAt(ev.clientX);
      if (this._climT?.[entity]?.temp !== t) {
        this._climT = { ...(this._climT || {}), [entity]: { temp: t, live: true } };
        this.requestUpdate();
      }
    };
    const up = (ev) => {
      if (dragging) this._setTarget(entity, tempAt(ev.clientX));
      else { this._climT = { ...(this._climT || {}), [entity]: undefined }; this.requestUpdate(); }
      done();
    };
    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

/**
   * The daily forecast — today's high and low, and the days after it. Home Assistant stopped
   * putting forecasts in attributes, so it takes a service call: once per entity, held, refreshed
   * hourly.
   */
  _forecast(id) {
    if (!id || !this.hass) return null;
    this._fc = this._fc || {};
    if (!(id in this._fc)) { this._fc[id] = null; this._fetchForecast(id); }
    return this._fc[id];
  }

  async _fetchForecast(id) {
    try {
      const res = await this.hass.callWS({
        type: "call_service", domain: "weather", service: "get_forecasts",
        service_data: { type: "daily" }, target: { entity_id: id }, return_response: true,
      });
      this._fc = { ...this._fc, [id]: res?.response?.[id]?.forecast || [] };
    } catch (err) {
      console.warn("Casa Dashboard: could not read a forecast for", id, err);
      this._fc = { ...this._fc, [id]: {} };
    }
    this.requestUpdate();
    clearTimeout(this._fcT);
    this._fcT = setTimeout(() => this._fetchForecast(id), 3600000);
  }

  _energy(id) {
    if (!id || !this.hass) return null;
    this._nrg = this._nrg || {};
    if (!(id in this._nrg)) {
      this._nrg[id] = null;                                  // asked for, nothing back yet
      this._fetchEnergy(id);
    }
    return this._nrg[id];
  }

  async _fetchEnergy(id) {
    const start = new Date();
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    try {
      const res = await this.hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        end_time: new Date().toISOString(),
        statistic_ids: [id],
        period: "day",
        types: ["change"],
      });
      this._nrg = { ...this._nrg, [id]: (res[id] || []).slice(-7)
        .map((e) => ({ ts: e.start, val: Math.round((e.change ?? 0) * 10) / 10 })) };
    } catch (err) {
      console.warn("Casa Dashboard: could not read energy statistics for", id, err);
      this._nrg = { ...this._nrg, [id]: [] };
    }
    this.requestUpdate();
    clearTimeout(this._nrgT);
    this._nrgT = setTimeout(() => this._fetchEnergy(id), 3600000);
  }

  _shown(sec) {
    const visible = (sec.cards || []).filter((c) => isVisible(c, this.narrow, this.hass));
    const cols = this._cols(sec);
    if (cols === sec.cols && visible.length === (sec.cards || []).length) return sec.cards;
    // Copies: a card narrowed to fit a phone must not have that written back to the layout.
    const fitted = visible.map((c) => clampCard({ ...c }, cols));
    return compactCards(fitted, cols, (k) => this._rows(k, cols));
  }

  /* -------------------------------------------------------- live values */
  _st(e) { return this.hass?.states?.[e]; }
  _nameOf(c) {
    if (c.name) return c.name;
    return this._st(c.entity)?.attributes?.friendly_name || c.entity || "Not set";
  }
  _iconOf(c) { return c.icon || this._st(c.entity)?.attributes?.icon || iconFor(c.entity); }
  _isOn(c) {
    const s = this._st(c.entity);
    if (!s) return false;
    // A cover reads the other way round: open is its resting state, closed is the one worth
    // showing, so a closed blind is the one that lights up.
    const d = String(c.entity).split(".")[0];
    if (d === "cover") return s.state === "closed" || s.attributes.current_position === 0;
    if (d === "lock") return s.state === "locked" || s.state === "jammed";
    if (d === "vacuum") return !["docked", "off", "unavailable", "unknown"].includes(s.state);
    if (d === "alarm_control_panel") return s.state !== "disarmed";
    return !["off", "unavailable", "unknown", "idle", "closed"].includes(s.state);
  }
  _sub(c) {
    const s = this._st(c.entity);
    if (!s) return "not set";
    const a = s.attributes, d = String(c.entity).split(".")[0];
    if (d === "light" && s.state === "on" && a.brightness != null) return `On · ${Math.round(a.brightness / 2.55)}%`;
    if (d === "climate") return `${a.current_temperature ?? "–"}° · ${s.state}`;
    if (d === "media_player") return a.media_title || a.app_name || s.state;
    if (d === "cover") return a.current_position != null ? `${a.current_position}% open` : s.state;
    if (d === "sensor") return `${s.state}${a.unit_of_measurement ? " " + a.unit_of_measurement : ""}`;
    return s.state;
  }

  /* ------------------------------------------------------------- mutate */
  _patch(obj, patch) { Object.assign(obj, patch); this._emit(); }
  _removeFrom(arr, i) { arr.splice(i, 1); this._insp = null; this._emit(); }

  /* ------------------------------------------------------------ header */
  /**
   * Stacked, the sidebar comes before main — and the pills live inside main, so they landed below
   * it. The row is rendered in both places and the breakpoint shows one, which keeps the pills
   * first on a phone without moving them out of the main column on a desktop.
   */
  _headerBar(cls = "") {
    const pills = this._l.header.pills || [];
    return html`<div class="pills ${cls}">
      ${pills.map((p, i) => this._vis(p) ? html`
        <div class="pill ${this.editing ? "editable" : ""} ${!isVisible(p, this.narrow, this.hass) ? "ghost" : ""}"
             @click=${() => this.editing && (this._insp = { kind: "pill", i })}>
          ${this._pillBody(p)}
          ${this.editing ? html`<ha-icon class="mini-pencil" icon="mdi:pencil"></ha-icon>` : ""}
        </div>` : "")}
      ${this.editing ? html`<button class="pill add" title="Add a pill"
        @click=${() => this._pick = { mode: "pill" }}><ha-icon icon="mdi:plus"></ha-icon></button>` : ""}
      <button class="pill round ${this.editing ? "on" : ""}" title=${this.editing ? "Done" : "Edit dashboard"}
        @click=${() => this.dispatchEvent(new CustomEvent("toggle-edit", { bubbles: true, composed: true }))}>
        <ha-icon icon=${this.editing ? "mdi:check" : "mdi:pencil-outline"}></ha-icon></button>
      <button class="pill round" title="Settings"
        @click=${() => this.dispatchEvent(new CustomEvent("open-settings", { bubbles: true, composed: true }))}>
        <ha-icon icon="mdi:cog-outline"></ha-icon></button>
    </div>`;
  }
  _pillBody(p) {
    if (p.type === "people") {
      const n = Object.keys(this.hass?.states || {}).filter((e) => e.startsWith("person.") && this._st(e).state === "home").length;
      return html`<ha-icon icon="mdi:account-group"></ha-icon><span>${n ? `${n} home` : "Away"}</span>`;
    }
    const s = this._st(p.entity);
    if (p.type === "weather")
      return html`<ha-icon icon=${s?.state ? DOMAIN_ICON.weather : "mdi:weather-cloudy-alert"}></ha-icon>
        <span>${s ? Math.round(s.attributes.temperature) + "°" : "–"}</span>
        <span class="dim">${s?.state || "no entity"}</span>`;
    return html`<ha-icon icon=${this._iconOf(p)}></ha-icon><span>${this._sub(p)}</span>`;
  }

  /* ----------------------------------------------------------- sidebar */
  _sidebar() {
    const items = this._l.sidebar.items || [];
    const now = new Date();
    return html`<aside class="side">
      ${items.map((it, i) => this._vis(it) ? html`
        <div class="sit ${this.editing ? "editable" : ""} ${!isVisible(it, this.narrow, this.hass) ? "ghost" : ""} ${this._sideLift?.i === i ? "lifted" : ""}"
             data-i=${i} data-key=${it.id}
             style=${(this._sideLift?.i === i ? `--lx:${this._sideLift.dx}px;--ly:${this._sideLift.dy}px;` : "")
               + `margin:${it.padTop ?? 0}px 0 ${it.padBottom ?? 0}px;`}
             @pointerdown=${(e) => this._dragSide(e, i)}
             @click=${() => { if (this._sideMoved) { this._sideMoved = false; return; } this.editing && (this._insp = { kind: "side", i }); }}>
          ${it.type === "clock" ? html`<div class="clock" style=${this._sideStyle(it)}>${
              now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(it.hour12 == null ? {} : { hour12: !!it.hour12 }) })}</div>`
            : it.type === "date" ? html`<div class="date" style=${this._sideStyle(it)}>${
              now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}</div>`
            : it.type === "greeting" ? html`<div class="greet" style=${this._sideStyle(it)}>${this._greeting()}</div>`
            : it.type === "media" ? this._sideMedia(it)
            : it.type === "heading" ? html`<div class="shead" style=${this._sideStyle(it)}>${it.name || "Heading"}</div>`
            : it.type === "gap" ? html`<div class="sgap" style="height:${it.size ?? 24}px"></div>`
            : html`<div class="spill"><ha-icon icon=${this._iconOf(it)}></ha-icon><span>${this._sub(it)}</span></div>`}
          ${this.editing ? html`<ha-icon class="mini-pencil" icon="mdi:pencil"></ha-icon>` : ""}
        </div>` : "")}
      ${this.editing ? html`<button class="mini add" @click=${() => this._pick = { mode: "side" }}>+ Add to sidebar</button>` : ""}
    </aside>`;
  }
  /**
   * The now playing card from the casa app, in its two shapes: compact is the small row with the
   * art at the left, extended is the large one with the art above the title and controls.
   */
  _sideMedia(it) {
    const s = it.entity && this._st(it.entity);
    if (!s) return html`<div class="spill"><ha-icon icon="mdi:music"></ha-icon><span>Pick a media player</span></div>`;
    const a = s.attributes || {};
    const art = a.entity_picture;
    const playing = s.state === "playing";
    const big = it.variant === "extended";
    const call = (sv) => (e) => { e.stopPropagation(); this.hass.callService("media_player", sv, { entity_id: it.entity }); };

    // The position only updates when it changes, so carry it forward from the timestamp HA sent.
    const dur = a.media_duration || 0;
    let at = a.media_position || 0;
    if (playing && a.media_position_updated_at)
      at += (Date.now() - new Date(a.media_position_updated_at).getTime()) / 1000;
    const pct = dur ? Math.min(100, (at / dur) * 100) : 0;

    return html`<div class="np ${big ? "" : "np-mini"}">
      <div class="np-art ${art ? "" : "noart"}" style=${art ? `background-image:url('${art}')` : ""}>
        ${art ? "" : stateIcon(this._ctx, it.entity, "", it.icon, "mdi:music")}</div>
      <div class="np-body">
        <div class="np-txt">
          <div class="kick">${a.friendly_name || this._sub(it)}</div>
          <div class="np-t">${a.media_title || (playing ? "Playing" : s.state)}</div>
          <div class="np-a">${a.media_artist || a.app_name || ""}</div>
        </div>
        ${big && dur ? html`<div class="np-prog"><div class="np-fill" style="width:${pct}%"></div></div>` : ""}
        <div class="np-ctrls">
          ${big ? html`<ha-icon class="ic" icon="mdi:skip-previous" @click=${call("media_previous_track")}></ha-icon>` : ""}
          <ha-icon class="play" icon=${playing ? "mdi:pause-circle" : "mdi:play-circle"}
            @click=${call("media_play_pause")}></ha-icon>
          ${big ? html`<ha-icon class="ic" icon="mdi:skip-next" @click=${call("media_next_track")}></ha-icon>` : ""}
        </div>
      </div>
    </div>`;
  }

  /** Tabs reorder by dragging along the bar, the same gesture as cards and sidebar items. */
  /**
   * Reordering can add or drop a row, which changes the page height; the browser then clamps the
   * scroll position and everything above the change — the tab row included — jumps. Hold the
   * scrollable content at the height it started at for the length of a drag. Returns the release.
   */
  _pinHeights() {
    const els = [...this.renderRoot.querySelectorAll("[data-grid], .side")];
    for (const g of els) g.style.minHeight = `${g.offsetHeight}px`;
    return () => setTimeout(() => { for (const g of els) g.style.minHeight = ""; }, 340);
  }

  _dragTab(e, i) {
    if (!this.editing || e.target.closest(".mini-pencil")) return;
    e.preventDefault();
    const tabs = this._tabs, tab = tabs[i];
    if (!tab) return;
    const start = e.currentTarget.getBoundingClientRect();
    const grabX = e.clientX - start.left, grabY = e.clientY - start.top;
    const x0 = e.clientX, y0 = e.clientY;
    let idx = i, moved = false;
    const wasActive = this._tab === i;
    const unpin = this._pinHeights();

    const follow = (ev) => {
      const el = this.renderRoot.querySelector(`.tab[data-ti="${idx}"]`);
      if (!el) return;
      const held = el.style.transform;
      el.style.transform = "none";
      const r = el.getBoundingClientRect();
      el.style.transform = held;
      // Tabs reorder along the row, so vertical travel earns nothing — and the row is a scroll
      // container, which clips whatever leaves it. Hold the lift to what the row has room for.
      const dy = ev.clientY - r.top - grabY;
      this._tabLift = { i: idx, dx: ev.clientX - r.left - grabX, dy: Math.max(-TAB_LIFT_Y, Math.min(TAB_LIFT_Y, dy)) };
    };

    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      moved = true; this._tabMoved = true;
      follow(ev);
      const over = this.renderRoot.elementFromPoint?.(ev.clientX, ev.clientY)?.closest?.(".tab");
      const to = over?.dataset.ti != null ? Number(over.dataset.ti) : -1;
      if (to >= 0 && to !== idx) {
        this._flipBefore();
        tabs.splice(idx, 1);
        tabs.splice(to, 0, tab);
        idx = to;
        if (wasActive) this._tab = to;              // keep looking at the tab being moved
        this._emit();
        this._flipAfter().then(() => follow(ev));
      } else {
        this.requestUpdate();
      }
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this._tabLift = null;
      if (moved) this._emit(); else this.requestUpdate();
      unpin();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /**
   * Sidebar items reorder by dragging, the same way cards do: the item lifts and follows the
   * pointer while the ones it passes spring out of its way.
   */
  _dragSide(e, i) {
    if (!this.editing || e.target.closest(".mini-pencil")) return;
    e.preventDefault();
    const items = this._l.sidebar.items;
    const item = items[i];
    if (!item) return;
    const start = e.currentTarget.getBoundingClientRect();
    const grabX = e.clientX - start.left, grabY = e.clientY - start.top;
    const x0 = e.clientX, y0 = e.clientY;
    let idx = i, moved = false;
    const unpin = this._pinHeights();

    const follow = (ev) => {
      const el = this.renderRoot.querySelector(`.sit[data-i="${idx}"]`);
      if (!el) return;
      const held = el.style.transform;
      el.style.transform = "none";
      const r = el.getBoundingClientRect();
      el.style.transform = held;
      this._sideLift = { i: idx, dx: ev.clientX - r.left - grabX, dy: ev.clientY - r.top - grabY };
    };

    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      moved = true; this._sideMoved = true;
      follow(ev);
      const over = this.renderRoot.elementFromPoint?.(ev.clientX, ev.clientY)?.closest?.(".sit");
      const to = over ? Number(over.dataset.i) : -1;
      if (to >= 0 && to !== idx) {
        this._flipBefore();
        items.splice(idx, 1);
        items.splice(to, 0, item);
        idx = to;
        this._emit();
        this._flipAfter().then(() => follow(ev));
      } else {
        this.requestUpdate();
      }
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this._sideLift = null;
      if (moved) this._emit(); else this.requestUpdate();
      unpin();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Font size and family for a sidebar item, when it has been given either. */
  _sideStyle(it) {
    const size = it.size ?? SIDEBAR_TYPES[it.type]?.size;
    const font = FONTS[it.font || ""]?.stack;
    return `${size ? `font-size:${size}px;` : ""}${font && font !== "inherit" ? `font-family:${font};` : ""}`;
  }

  _greeting() {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }

  /* -------------------------------------------------------------- tabs */
  _tabBar() {
    return html`<div class="tabs">
      ${this._tabs.map((t, i) => this._vis(t) ? html`
        <button class="tab ${i === this._curIdx ? "on" : ""} ${!isVisible(t, this.narrow, this.hass) ? "ghost" : ""} ${this._tabLift?.i === i ? "lifted" : ""}"
                data-ti=${i} data-key=${t.id}
                style=${this._tabLift?.i === i ? `--lx:${this._tabLift.dx}px;--ly:${this._tabLift.dy}px` : ""}
                @pointerdown=${(e) => this._dragTab(e, i)}
                @click=${() => {
                  if (this._tabMoved) { this._tabMoved = false; return; }
                  if (i !== this._tab) this._anim ^= 1;      // replay the entry animation
                  this._tab = i;
                }}>
          <ha-icon icon=${t.icon}></ha-icon><span>${t.name}</span>
          ${this.editing ? html`<ha-icon class="mini-pencil" icon="mdi:pencil"
            @click=${(e) => { e.stopPropagation(); this._insp = { kind: "tab", i }; }}></ha-icon>` : ""}
        </button>` : "")}
      ${this.editing ? html`
        <button class="tab add" @click=${() => { this._tabs.push(newTab(`Tab ${this._tabs.length + 1}`)); this._tab = this._tabs.length - 1; this._emit(); }}>+ Tab</button>
        <button class="tab add" title="A tab that sorts chosen entities into sections automatically"
          @click=${() => { this._tabs.push(newAutoTab()); this._tab = this._tabs.length - 1; this._emit(); }}>+ Auto tab</button>` : ""}
    </div>`;
  }

  /** Columns are fluid, so watch the real width — tiles size themselves from it. */
  connectedCallback() {
    super.connectedCallback();
    // The same query the stylesheet uses, so the columns the cards are packed into and the ones
    // the grid draws can never disagree.
    this._mq = window.matchMedia(`(max-width:${STACK_W}px)`);
    this._onMq = () => this.requestUpdate();
    this._mq.addEventListener("change", this._onMq);
  }

  get _stacked() { return !!this._mq?.matches; }

  /** Columns a section is drawn in — its own, or the stacked cap. */
  _cols(sec) {
    const own = Math.max(1, sec?.cols | 0 || 1);
    return this._stacked ? Math.min(STACK_COLS, own) : own;
  }

  firstUpdated() {
    this._ro = new ResizeObserver(() => {
      const g = this.renderRoot.querySelector(".grid");
      if (g?.clientWidth && g.clientWidth !== this._gw) { this._gw = g.clientWidth; this.requestUpdate(); }
    });
    this._ro.observe(this);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._ro?.disconnect();
    this._mq?.removeEventListener("change", this._onMq);
  }

  /** Width of one column in the given section, in px (0 until measured). */
  _colw(cols) { return this._gw ? (this._gw - GRID_GAP * (cols - 1)) / cols : 0; }

  /* ------------------------------------------------------------- cards */
  _card(si, ci, c, auto, cols = 4) {
    if (!this._vis(c)) return "";
    // A square card can't use its stored height: rows are fixed, columns aren't.
    const rows = c.h;
    const on = this._isOn(c), t = c.type;
    const dragging = this._drag?.si === si && this._drag?.ci === ci;
    const art = t === "full" ? this._st(c.entity)?.attributes?.entity_picture : null;
    return html`
      <div class="card in${this._anim} t-${t} ${String(this._climMenu?.key || "").startsWith(`${c.id}:`) ? "menuopen" : ""} ${on ? "on" : ""} ${this._lift?.si === si && this._lift?.ci === ci ? "lifted" : ""} ${this.editing ? "editing" : ""} ${!isVisible(c, this.narrow, this.hass) ? "ghost" : ""}"
           data-ci=${ci} data-key=${c.id || `${si}:${c.entity}`}
           style="--x:${c.x | 0};--y:${c.y | 0};--w:${c.w};--h:${rows};--i:${ci}${
             this._lift?.si === si && this._lift?.ci === ci
               ? `;--lx:${this._lift.dx}px;--ly:${this._lift.dy}px` : ""}"
           @pointerdown=${(e) => this._dragCard(e, si, ci, c, auto)}>
        ${renderCard(this._ctx, c)}
        ${this.editing ? html`<div class="edit-veil"></div>` : ""}
        ${this.editing ? html`
          <button class="pencil" @click=${(e) => { e.stopPropagation(); this._insp = { kind: "card", si, ci }; }}>
            <ha-icon icon="mdi:pencil"></ha-icon></button>` : ""}
      </div>`;
  }

  /**
   * One drag for the whole app. A card follows the pointer; dropping it inside its own section
   * puts it in that cell, and dropping it on another section moves it there — which for an auto
   * tab means changing the entity's room. Sections settle after every move, so a card can be
   * stacked directly under another and the one below simply gives way.
   */
  _dragCard(e, si, ci, card0, auto) {
    if (!this.editing || e.target.closest(".pencil")) return;
    if (auto && this._af[this._cur.id]) return;      // filtered view: a filter shows, it does not arrange
    e.preventDefault();
    const start = e.currentTarget.getBoundingClientRect();
    const grabX = e.clientX - start.left, grabY = e.clientY - start.top;
    const x0 = e.clientX, y0 = e.clientY;
    const entity = card0.entity;
    let idx = ci, host = si, moved = false;

    const unpin = this._pinHeights();

    const secAt = (i) => (auto ? this._secs?.[i] : this._cur.sections?.[i]);

    // An auto tab's cards are rebuilt from the entity list on every render, so the object this
    // drag started with is thrown away the moment anything is saved. Look the card up again each
    // time instead of holding a reference that quietly goes stale.
    const live = () => {
      const sec = secAt(host);
      if (!sec) return null;
      if (!auto) return sec.cards.includes(card0) ? card0 : null;
      return sec.cards.find((k) => k.entity === entity) || null;
    };

    const cellOf = (ev, sec, i, card) => {
      const grid = this.renderRoot.querySelector(`[data-grid="${i}"]`);
      if (!grid) return null;
      const r = grid.getBoundingClientRect();
      const z = this._zoom;
      const colW = (r.width - GRID_GAP * z * (sec.cols - 1)) / sec.cols;
      return {
        x: Math.max(0, Math.min(sec.cols - card.w,
          Math.round((ev.clientX - grabX - r.left) / (colW + GRID_GAP * z)))),
        y: Math.max(0, Math.round((ev.clientY - grabY - r.top) / ((GRID_ROW + GRID_GAP) * z))),
      };
    };

    const follow = (ev) => {
      const el = this.renderRoot.querySelector(`[data-grid="${host}"] [data-ci="${idx}"]`);
      if (!el) { this._lift = { si: host, ci: idx, dx: ev.clientX - x0, dy: ev.clientY - y0 }; return; }
      const held = el.style.transform;
      el.style.transform = "none";
      const r = el.getBoundingClientRect();
      el.style.transform = held;
      this._lift = { si: host, ci: idx, dx: ev.clientX - r.left - grabX, dy: ev.clientY - r.top - grabY };
    };

    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      moved = true;
      follow(ev);
      const card = live();
      if (!card) return;

      const overSec = this.renderRoot.elementFromPoint?.(ev.clientX, ev.clientY)?.closest?.(".sec");
      const target = overSec ? Number(overSec.dataset.si) : host;
      this._roomOver = target !== host ? target : null;

      if (target !== host && target >= 0) {                       // into another section
        const dest = secAt(target);
        if (!dest) return;
        this._flipBefore();
        if (auto) {
          this._setRoom(entity, dest.room ?? "");
          host = target;
        } else {
          const from = secAt(host);
          from.cards.splice(from.cards.indexOf(card), 1);
          card.y = Math.max(0, ...dest.cards.map((k) => (k.y | 0) + this._rows(k, dest.cols)));
          dest.cards.push(card);
          host = target;
          compactCards(dest.cards, dest.cols, (k) => this._rows(k, dest.cols));
          this._emit();
        }
        idx = Math.max(0, (secAt(host)?.cards || []).findIndex((k) => k.entity === entity));
        this._flipAfter().then(() => follow(ev));
        return;
      }

      const sec = secAt(host);
      const at = sec && cellOf(ev, sec, host, card);
      if (!at || (at.x === card.x && at.y === card.y)) { this.requestUpdate(); return; }
      this._flipBefore();
      card.x = at.x; card.y = at.y;
      compactCards(sec.cards, sec.cols, (k) => this._rows(k, sec.cols), card);
      if (auto) {
        const sizes = { ...(this.layout.cardSizes || {}) };
        for (const k of sec.cards)
          sizes[k.entity] = { ...(sizes[k.entity] || {}), w: k.w, h: k.h, x: k.x, y: k.y };
        this.layout.cardSizes = sizes;
      }
      idx = sec.cards.indexOf(card);
      this._emit();
      this._flipAfter().then(() => follow(ev));
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this._lift = null; this._roomOver = null;
      if (moved) this._emit(); else this.requestUpdate();
      unpin();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /**
   * How many of the tab's columns its sections actually occupy. A tab is TAB_COLS wide, but a lone
   * four column section left the last two tracks empty and that read as dead space at the right of
   * the page. Sizing the grid to what is used lets the sidebar take the rest.
   */
  _usedCols(sections) {
    let cursor = 0, used = 1;
    for (const sec of sections) {
      if (!this._vis(sec)) continue;
      const span = Math.max(1, Math.min(TAB_COLS, sec.cols | 0 || 1));
      if (cursor + span > TAB_COLS) cursor = 0;
      cursor += span;
      used = Math.max(used, cursor);
    }
    return used;
  }

  /**
   * The cards a section draws. Editing works on the real ones so a drag writes where it should —
   * except when stacked, where they would not fit the narrower grid and are packed into copies.
   */
  _laid(sec) {
    return this.editing && !this._stacked ? sec.cards : this._shown(sec);
  }

  /** Rows a card occupies — a tile's height follows its width, so it can't use the stored value. */
  _rows(c) { return c.h; }

  _showChips(item) {
    const set = (k, v) => {
      const other = k === "mobile" ? "desktop" : "mobile";
      if (!v && item.show?.[other] === false) return;      // never allow both off
      item.show = { ...(item.show || bothShown()), [k]: v };
      this._emit();
    };
    const s = item.show || bothShown();
    return html`<div class="f"><label>Show on</label><div class="chips">
      <button class="chip ${s.mobile !== false ? "on" : ""}" @click=${() => set("mobile", s.mobile === false)}>
        <ha-icon icon="mdi:cellphone"></ha-icon> Mobile</button>
      <button class="chip ${s.desktop !== false ? "on" : ""}" @click=${() => set("desktop", s.desktop === false)}>
        <ha-icon icon="mdi:monitor"></ha-icon> Desktop</button>
    </div><div class="hint">At least one has to stay selected.</div></div>`;
  }
/**
   * An entity field that completes as it is typed. Matches on the entity id, its friendly name and
   * its room, so "kitchen" finds light.spotlights if that is where it lives. Typing something that
   * matches nothing is still accepted — an entity may not exist yet.
   */
  _entityField(value, onPick, key, domain) {
    const q = (this._acq?.[key] ?? value ?? "").toLowerCase().trim();
    const open = this._ac === key && q.length > 0;
    // A field that only makes sense for one domain offers nothing else — a media card cannot play
    // a light.
    const inDomain = (id) => !domain || id.startsWith(`${domain}.`);
    const matches = !open ? [] : Object.keys(this.hass?.states || {})
      .filter(inDomain)
      .map((id) => ({ id, name: this._st(id)?.attributes?.friendly_name || "", room: areaOf(this.hass, id, this._rooms) || "" }))
      .filter((e) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q) || e.room.toLowerCase().includes(q))
      .sort((a, b) => (a.id.toLowerCase().startsWith(q) ? -1 : 0) - (b.id.toLowerCase().startsWith(q) ? -1 : 0))
      .slice(0, 8);
    // The sheet scrolls, so a list positioned inside it is clipped at the sheet's edge, and one in
    // the sheet's flow shoves the rest of the form down. Anchor it to the viewport instead: it
    // floats over everything and nothing below it moves.
    const set = (v, input) => {
      this._acq = { ...(this._acq || {}), [key]: v };
      this._ac = key;
      if (!input) return;
      const r = input.getBoundingClientRect();
      const vw = window.innerWidth || 360, vh = window.innerHeight || 640;
      const room = vh - r.bottom - 12;
      const up = room < 160 && r.top > room;
      // Clamped to the viewport: a measurement taken while the panel is hidden or mid-transition
      // would otherwise place the list somewhere off-screen.
      const width = Math.min(vw - 16, Math.max(200, Math.round(r.width)));
      this._acRect = {
        width, up,
        left: Math.round(Math.max(8, Math.min(r.left, vw - width - 8))),
        y: Math.round(Math.max(8, up ? vh - r.top + 4 : r.bottom + 4)),
        max: Math.round(Math.max(120, Math.min(240, up ? r.top - 16 : room))),
      };
    };
    return html`<div class="acwrap">
      <input placeholder=${domain ? `${domain}.…` : "entity id"} .value=${value || ""}
        @focus=${(e) => set(e.target.value, e.target)}
        @input=${(e) => set(e.target.value, e.target)}
        @change=${(e) => { onPick(e.target.value); this._ac = null; }}
        @blur=${() => setTimeout(() => { if (this._ac === key) this._ac = null; }, 150)}>
      ${open && matches.length ? html`<div class="aclist" style=${this._acRect
        ? `left:${this._acRect.left}px;width:${this._acRect.width}px;max-height:${this._acRect.max}px;` +
          (this._acRect.up ? `bottom:${this._acRect.y}px;` : `top:${this._acRect.y}px;`)
        : ""}>
        ${matches.map((m) => html`<button class="acrow" @mousedown=${(e) => e.preventDefault()}
          @click=${() => { onPick(m.id); this._acq = { ...(this._acq || {}), [key]: m.id }; this._ac = null; }}>
          <ha-icon icon=${iconFor(m.id)}></ha-icon>
          <span class="acname">${m.name || m.id}</span>
          ${m.room ? html`<span class="acroom">${m.room}</span>` : ""}
          <span class="acid">${m.id}</span>
        </button>`)}
      </div>` : ""}
    </div>`;
  }

  _condition(item) {
    const c = item.visibleWhen || {};
    const put = (patch) => {
      const next = { ...c, ...patch };
      item.visibleWhen = next.entity ? next : undefined;
      this._emit();
    };
    const states = c.entity ? statesFor(this.hass, c.entity) : [];
    const picked = c.state == null ? [] : Array.isArray(c.state) ? c.state : [c.state];
    return html`<div class="f"><label>Only show when (optional)</label>
      ${this._entityField(c.entity, (v) => put({ entity: v }), `cond:${item.id}`)}
      ${c.entity ? html`
        <div class="chips tight">
          <button class="chip ${!c.state ? "on" : ""}" @click=${() => put({ state: undefined })}>Active</button>
          ${states.map((v) => html`
            <button class="chip ${picked.includes(v) ? "on" : ""}" @click=${() => {
              const next = picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v];
              put({ state: next.length ? next : undefined });
            }}>${v}</button>`)}
        </div>
        <div class="hint">${picked.length
          ? `Shown while it is ${picked.map((v) => `"${v}"`).join(" or ")}.`
          : "Shown whenever it is anything other than off, idle, unknown or unavailable."}</div>`
        : html`<div class="hint">Left blank it's always shown.</div>`}
    </div>`;
  }

  _inspector() {
    if (!this._insp) return "";
    const k = this._insp.kind;
    const close = () => (this._insp = null);
    let title = "", body = "", onDelete = null;

    if (k === "section") {
      const sec = this._cur.sections?.[this._insp.si];
      if (!sec) return "";
      title = "Section";
      onDelete = () => this._removeFrom(this._cur.sections, this._insp.si);
      const move = (d) => {
        const list = this._cur.sections, i = this._insp.si, j = i + d;
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        this._insp = { kind: "section", si: j };
        this._emit();
      };
      body = html`
        <div class="f"><label>Name</label>
          <input .value=${sec.name || ""} @change=${(e) => this._patch(sec, { name: e.target.value })}></div>
        <div class="f"><label>Width</label><div class="chips">
          ${[1, 2, 3, 4, 5, 6].map((n) => html`
            <button class="chip ${sec.cols === n ? "on" : ""}" @click=${() => {
              sec.cols = n;
              for (const c of sec.cards) clampCard(c, n);
              this._emit();
            }}>${n}</button>`)}
        </div><div class="hint">Columns out of ${TAB_COLS}. Two sections of three sit side by side.</div></div>
        <div class="f"><label>Order</label><div class="chips">
          <button class="chip" @click=${() => move(-1)}>← Earlier</button>
          <button class="chip" @click=${() => move(1)}>Later →</button>
        </div></div>
        ${this._showChips(sec)}${this._condition(sec)}`;
    }

    if (k === "pill") {
      const p = this._l.header.pills[this._insp.i];
      if (!p) return "";
      title = PILL_TYPES[p.type]?.label || "Pill";
      onDelete = () => this._removeFrom(this._l.header.pills, this._insp.i);
      body = html`
        <div class="f"><label>Type</label><div class="chips">
          ${Object.entries(PILL_TYPES).map(([key, v]) => html`
            <button class="chip ${p.type === key ? "on" : ""}" @click=${() => this._patch(p, { type: key })}>${v.label}</button>`)}
        </div></div>
        ${PILL_TYPES[p.type]?.needsEntity ? html`<div class="f"><label>Entity</label>
          ${this._entityField(p.entity, (v) => this._patch(p, { entity: v }), `pill:${p.id}`)}</div>` : ""}
        ${this._showChips(p)}${this._condition(p)}`;
    }

    if (k === "side") {
      const it = this._l.sidebar.items[this._insp.i];
      if (!it) return "";
      title = SIDEBAR_TYPES[it.type]?.label || "Sidebar item";
      onDelete = () => this._removeFrom(this._l.sidebar.items, this._insp.i);
      body = html`
        <div class="f"><label>Type</label><div class="chips">
          ${Object.entries(SIDEBAR_TYPES).map(([key, v]) => html`
            <button class="chip ${it.type === key ? "on" : ""}" @click=${() => this._patch(it, { type: key })}>${v.label}</button>`)}
        </div></div>
        ${SIDEBAR_TYPES[it.type]?.needsEntity ? html`<div class="f"><label>Entity</label>
          ${this._entityField(it.entity, (v) => this._patch(it, { entity: v }), `side:${it.id}`,
            SIDEBAR_TYPES[it.type].domain)}
          ${SIDEBAR_TYPES[it.type].domain && it.entity && !it.entity.startsWith(`${SIDEBAR_TYPES[it.type].domain}.`)
            ? html`<div class="hint">Needs a ${SIDEBAR_TYPES[it.type].domain} entity.</div>` : ""}</div>` : ""}
        ${SIDEBAR_TYPES[it.type]?.size != null ? html`
          <div class="f"><label>${it.type === "gap" ? "Height" : "Text size"}</label>
            <div class="stp">
              <button class="mini" @click=${() => this._patch(it, { size: Math.max(4, (it.size ?? SIDEBAR_TYPES[it.type].size) - 2) })}>−</button>
              <span>${it.size ?? SIDEBAR_TYPES[it.type].size}px</span>
              <button class="mini" @click=${() => this._patch(it, { size: Math.min(160, (it.size ?? SIDEBAR_TYPES[it.type].size) + 2) })}>+</button>
            </div></div>` : ""}
        ${it.type === "clock" ? html`
          <div class="f"><label>Type face</label><div class="chips">
            ${Object.entries(FONTS).map(([key, v]) => html`
              <button class="chip ${(it.font || "") === key ? "on" : ""}" style=${v.stack === "inherit" ? "" : `font-family:${v.stack}`}
                @click=${() => this._patch(it, { font: key || undefined })}>${v.label}</button>`)}
          </div></div>
          <div class="f"><label>Clock</label><div class="chips">
            <button class="chip ${it.hour12 == null ? "on" : ""}" @click=${() => this._patch(it, { hour12: undefined })}>Regional</button>
            <button class="chip ${it.hour12 === false ? "on" : ""}" @click=${() => this._patch(it, { hour12: false })}>24 hour</button>
            <button class="chip ${it.hour12 === true ? "on" : ""}" @click=${() => this._patch(it, { hour12: true })}>12 hour</button>
          </div></div>` : ""}
        ${it.type === "media" ? html`
          <div class="f"><label>Size</label><div class="chips">
            ${[["compact", "Compact"], ["extended", "Extended"]].map(([key, label]) => html`
              <button class="chip ${(it.variant || "compact") === key ? "on" : ""}"
                @click=${() => this._patch(it, { variant: key })}>${label}</button>`)}
          </div></div>` : ""}
        ${it.type === "heading" ? html`
          <div class="f"><label>Text</label><input .value=${it.name || ""} placeholder="Heading"
            @change=${(e) => this._patch(it, { name: e.target.value || undefined })}></div>` : ""}
        ${it.type === "gap" ? "" : html`
          <div class="two">
            ${[["padTop", "Space above"], ["padBottom", "Space below"]].map(([key, label]) => html`
              <div class="f"><label>${label}</label><div class="stp">
                <button class="mini" @click=${() => this._patch(it, { [key]: Math.max(0, (it[key] ?? 0) - 4) })}>−</button>
                <span>${it[key] ?? 0}px</span>
                <button class="mini" @click=${() => this._patch(it, { [key]: Math.min(60, (it[key] ?? 0) + 4) })}>+</button>
              </div></div>`)}
          </div>`}
        ${it.type === "gap" ? "" : html`${this._showChips(it)}${this._condition(it)}`}`;
    }

    if (k === "tab") {
      const t = this._tabs[this._insp.i];
      if (!t) return "";
      title = `Tab · ${t.name}`;
      onDelete = this._tabs.length > 1 ? () => this._removeFrom(this._tabs, this._insp.i) : null;
      body = html`
        <div class="two">
          <div class="f"><label>Name</label><input .value=${t.name} @change=${(e) => this._patch(t, { name: e.target.value })}></div>
          <div class="f"><label>Icon</label><input .value=${t.icon} @change=${(e) => this._patch(t, { icon: e.target.value })}></div>
        </div>
        ${t.kind === "auto" ? html`
          <div class="f"><label>Entities (sorted into sections automatically)</label>
            <div class="chosen">${(t.entities || []).map((e, n) => html`
              <span class="tagx">${e}<button @click=${() => { t.entities.splice(n, 1); this._emit(); }}>✕</button></span>`)}</div>
            <button class="mini" @click=${() => this._pick = { mode: "auto" }}>+ Choose entities</button>
            <div class="hint">Lights, Climate, Media, Shades, Door locks… each gets its own section.</div></div>` : ""}
        ${this._showChips(t)}${this._condition(t)}`;
    }

    if (k === "card") {
      // An auto tab's cards are generated, so its inspector edits the entity's stored size and can
      // drop the entity from the tab — but not swap what the card points at.
      const auto = this._cur.kind === "auto";
      const s = auto ? this._secs?.[this._insp.si] : this._cur.sections?.[this._insp.si];
      const c = s?.cards[this._insp.ci];
      if (!c) return "";
      const ct = CARD_TYPES[c.type];
      title = this._nameOf(c);
      onDelete = auto
        ? () => {
            const list = this._cur.entities || [];
            const at = list.indexOf(c.entity);
            if (at >= 0) list.splice(at, 1);
            this._insp = null; this._emit();
          }
        : () => this._removeFrom(s.cards, this._insp.ci);
      const patchCard = (patch) => {
        if (auto) {
          const sizes = { ...(this.layout.cardSizes || {}) };
          const next = { ...(sizes[c.entity] || {}), ...patch };
          sizes[c.entity] = { type: next.type ?? c.type, w: next.w ?? c.w, h: next.h ?? c.h };
          this.layout.cardSizes = sizes;
          this._emit();
          return;
        }
        Object.assign(c, patch);
        clampCard(c, s.cols);
        // Growing a card has to push its neighbours aside, exactly as dragging one does — the
        // edited card keeps the cell it is in and the rest give way.
        compactCards(s.cards, s.cols, (k) => this._rows(k, s.cols), c);
        this._emit();
      };
      body = html`
        ${c.widget ? "" : html`
          <div class="f"><label>Card type</label><div class="chips">
            ${Object.entries(CARD_TYPES).map(([key, v]) => html`
              <button class="chip ${c.type === key ? "on" : ""}" ?disabled=${!typeAllowed(key, c.entity)}
                title=${typeAllowed(key, c.entity) ? v.sub : "Media players only"}
                @click=${() => patchCard({ type: key, w: v.w, h: v.square ? v.w : v.h })}>${v.label}</button>`)}
          </div></div>`}
        ${c.widget && WIDGET_TYPES[c.widget]?.sizes ? html`
          <div class="f"><label>Size (rows × columns)</label><div class="chips">
            ${WIDGET_TYPES[c.widget].sizes.map(([h, w]) => html`
              <button class="chip ${c.h === h && c.w === w ? "on" : ""}"
                @click=${() => patchCard({ h, w })}>${h}×${w}</button>`)}
          </div></div>` : ""}
        ${(() => {
          // Every type but Custom decides its own size, so the steppers are only live there. A
          // widget with a fixed set of shapes picks from those instead.
          if (c.widget && WIDGET_TYPES[c.widget]?.sizes) return "";
          const free = c.type === "custom" || !!c.widget;
          return html`<div class="two ${free ? "" : "locked"}">
            <div class="f"><label>Width</label><div class="stp">
              <button class="mini" ?disabled=${!free} @click=${() => patchCard({ w: c.w - 1 })}>−</button><span>${c.w}</span>
              <button class="mini" ?disabled=${!free} @click=${() => patchCard({ w: c.w + 1 })}>+</button></div></div>
            <div class="f"><label>Height</label><div class="stp">
              <button class="mini" ?disabled=${!free || ct?.square} @click=${() => patchCard({ h: c.h - 1 })}>−</button>
              <span>${c.h}${ct?.square ? " ·sq" : ""}</span>
              <button class="mini" ?disabled=${!free || ct?.square} @click=${() => patchCard({ h: c.h + 1 })}>+</button></div></div>
          </div>
          ${free ? "" : html`<div class="hint">Choose <b>Custom</b> to set the size yourself.</div>`}`;
        })()}
        ${c.widget && WIDGET_TYPES[c.widget]?.needsEntities ? html`
          <div class="f"><label>Entities</label>
            <button class="mini wide" @click=${() => (this._pick = { mode: "cardents", card: c })}>
              ${(c.entities || []).length ? `${c.entities.length} chosen — change` : "Choose entities"}</button>
            ${(c.entities || []).length ? html`<div class="hint">${(c.entities || []).join(", ")}</div>` : ""}
          </div>` : ""}
        ${c.widget && WIDGET_TYPES[c.widget]?.needsEntity ? html`
          <div class="f"><label>Entity</label>
            ${this._entityField(c.entity, (v) => patchCard({ entity: v }), `wcard:${c.id}`,
              WIDGET_TYPES[c.widget].domain)}</div>` : ""}
        ${c.widget === "energy" ? html`
          <div class="f"><label>Shows</label><div class="chips">
            ${[["week", "Last 7 days"], ["today", "Today"]].map(([key, label]) => html`
              <button class="chip ${(c.period || "week") === key ? "on" : ""}"
                @click=${() => patchCard({ period: key })}>${label}</button>`)}
          </div></div>` : ""}
        ${c.widget ? html`
          <div class="two">
            <div class="f"><label>Name (optional)</label><input .value=${c.name || ""}
              placeholder=${this._widgetName(c)}
              @change=${(e) => patchCard({ name: e.target.value || undefined })}></div>
            <div class="f"><label>Icon (optional)</label><input .value=${c.icon || ""}
              placeholder=${WIDGET_TYPES[c.widget]?.icon || "mdi:shape-outline"}
              @change=${(e) => patchCard({ icon: e.target.value.trim() || undefined })}></div>
          </div>` : ""}
        ${auto ? html`<div class="hint">${c.entity}</div>`
          : c.widget ? html`${this._showChips(c)}${this._condition(c)}`
          : html`
          <div class="f"><label>Entity</label>
            ${this._entityField(c.entity, (v) => patchCard({ entity: v }), `card:${c.id}`)}</div>
          <div class="f"><label>Name (optional)</label><input .value=${c.name || ""} placeholder=${this._nameOf(c)}
            @change=${(e) => patchCard({ name: e.target.value || undefined })}></div>
          ${this._showChips(c)}${this._condition(c)}`}`;
    }

    return html`<div class="scrim" @click=${close}><div class="sheet" @click=${(e) => e.stopPropagation()}>
      <div class="sh-h"><div class="grow"><div class="sh-t">${title}</div></div>
        <button class="x" @click=${close}><ha-icon icon="mdi:close"></ha-icon></button></div>
      ${body}
      ${onDelete ? html`<button class="mini del wide" @click=${onDelete}>Remove</button>` : ""}
    </div></div>`;
  }

  /* ------------------------------------------------------------ picker */
  /** Entity or widget — the two things a custom tab can hold. */
  _pickTabs() {
    const set = (k) => { this._pickKind = k; this._q = ""; };
    return html`<div class="chips seg2">
      <button class="chip ${this._pickKind !== "widget" ? "on" : ""}" @click=${() => set("entity")}>
        <ha-icon icon="mdi:shape-outline"></ha-icon> Entity</button>
      <button class="chip ${this._pickKind === "widget" ? "on" : ""}" @click=${() => set("widget")}>
        <ha-icon icon="mdi:view-dashboard-outline"></ha-icon> Widget</button>
    </div>`;
  }

  /**
   * Pick an entity on or off. Picking one off also unpins it, so it stays where it fell instead of
   * springing back to the top the moment it is picked again.
   */
  _togglePicked(list, id) {
    const at = list.indexOf(id);
    if (at >= 0) {
      list.splice(at, 1);
      this._pinned = (this._pinned || []).filter((x) => x !== id);
    } else {
      list.push(id);
    }
    this._emit();
  }

  _pickerSheet() {
    if (!this._pick) return "";
    const { mode, si } = this._pick;
    const close = () => {
      this._pick = null; this._q = ""; this._pickKind = "entity";
      this._pinnedFor = null; this._pinned = null;
    };
    if (mode === "cardents") {
      // fall through to the entity list below, but Done returns to the card's own settings
    }
    if (mode === "pill" || mode === "side") {
      const types = mode === "pill" ? PILL_TYPES : SIDEBAR_TYPES;
      const arr = mode === "pill" ? this._l.header.pills : this._l.sidebar.items;
      const mk = mode === "pill" ? newPill : newSidebarItem;
      return html`<div class="scrim" @click=${close}><div class="sheet" @click=${(e) => e.stopPropagation()}>
        <div class="sh-t">Add ${mode === "pill" ? "a header pill" : "to the sidebar"}</div>
        <div class="chips wrap">${Object.entries(types).map(([k, v]) => html`
          <button class="chip" @click=${() => { arr.push(mk(k)); close(); this._emit(); }}>
            <ha-icon icon=${v.icon}></ha-icon> ${v.label}</button>`)}</div>
      </div></div>`;
    }
    // entity pickers: one entity for a card, or a multi-select for an auto tab or a list widget
    const target = mode === "cardents" ? this._pick.card : null;
    const tab = this._cur;
    const q = this._q.toLowerCase();
    // A widget that only works with one domain is not offered anything else.
    const only = target?.widget ? WIDGET_TYPES[target.widget]?.domain : null;
    const matches = Object.keys(this.hass?.states || {})
      .filter((id) => !only || id.startsWith(`${only}.`))
      .filter((id) => !q || id.includes(q) || (this._st(id).attributes.friendly_name || "").toLowerCase().includes(q));

    // Whatever was already chosen sits at the top of the list, so it can be found among hundreds
    // of entities — and so it survives the cut below. The order is taken once, when the picker
    // opens: unpicking an entity drops it straight back to its usual place, and picking a new one
    // leaves it where it is rather than making the list jump under the pointer.
    const chosenList = target ? target.entities : mode === "auto" ? tab?.entities : null;
    if (chosenList) {
      const key = `${mode}:${target?.id || tab?.id || ""}`;
      if (this._pinnedFor !== key) { this._pinnedFor = key; this._pinned = [...chosenList]; }
    }
    let ids;
    if (chosenList) {
      const shown = new Set(matches);
      const still = new Set(chosenList);
      const top = (this._pinned || []).filter((id) => still.has(id) && shown.has(id));
      const onTop = new Set(top);
      ids = [...top, ...matches.filter((id) => !onTop.has(id))].slice(0, 60);
    } else {
      ids = matches.slice(0, 60);
    }
    if (mode === "card" && this._pickKind === "widget")
      return html`<div class="scrim" @click=${close}><div class="sheet" @click=${(e) => e.stopPropagation()}>
        <div class="sh-t">Add a card</div>
        ${this._pickTabs()}
        <div class="chips wrap">${Object.entries(WIDGET_TYPES).map(([k, v]) => html`
          <button class="chip" @click=${() => {
            const sec = this._cur.sections?.[si];
            if (!sec) return;
            const card = clampCard(newWidget(k), sec.cols);
            card.x = 0;
            card.y = Math.max(0, ...sec.cards.map((n) => (n.y | 0) + this._rows(n, sec.cols)));
            sec.cards.push(card);
            compactCards(sec.cards, sec.cols, (n) => this._rows(n, sec.cols));
            close(); this._emit();
          }}><ha-icon icon=${v.icon}></ha-icon> ${v.label}</button>`)}</div>
        <div class="hint">A widget that needs an entity asks for it in its own settings.</div>
      </div></div>`;
    return html`<div class="scrim" @click=${close}><div class="sheet tall" @click=${(e) => e.stopPropagation()}>
      <div class="sh-t">${mode === "auto" ? "Choose entities — they'll be grouped automatically"
        : target ? "Choose the entities this card covers" : "Add a card"}</div>
      ${mode === "card" ? this._pickTabs() : ""}
      <input class="search" placeholder="Search…" .value=${this._q} @input=${(e) => (this._q = e.target.value)}>
      <div class="pl">${ids.map((id) => {
        const chosen = target ? (target.entities || []).includes(id) : mode === "auto" && (tab.entities || []).includes(id);
        return html`<div class="pr">
          <ha-icon icon=${iconFor(id)}></ha-icon>
          <div class="grow">
            <div class="pr-t">
              <span class="pr-n">${this._st(id).attributes.friendly_name || id}</span>
              ${mode === "auto"
                ? html`<select class="pr-room" @click=${(ev) => ev.stopPropagation()}
                    @change=${(ev) => this._setRoom(id, ev.target.value)}>
                    <option value="" ?selected=${!areaOf(this.hass, id, this._rooms)}>No room</option>
                    ${[...new Set([...(this.areaNames || []), ...Object.values(this.layout?.rooms || {})])]
                      .sort((a, b) => a.localeCompare(b)).map((r) => html`
                        <option value=${r} ?selected=${areaOf(this.hass, id, this._rooms) === r}>${r}</option>`)}
                  </select>`
                : areaOf(this.hass, id, this._rooms)
                  ? html`<span class="pr-room">${areaOf(this.hass, id, this._rooms)}</span>` : ""}
            </div>
            <div class="pr-id">${id}</div>
          </div>
          ${target
            ? html`<button class="mini ${chosen ? "on" : ""}" @click=${() => {
                  target.entities = target.entities || [];
                  this._togglePicked(target.entities, id);
                }}>${chosen ? "✓" : "+"}</button>`
            : mode === "auto"
            ? html`<span class="cat">${categoryFor(id).name}</span>
                <button class="mini ${chosen ? "on" : ""}" @click=${() => {
                  tab.entities = tab.entities || [];
                  this._togglePicked(tab.entities, id);
                }}>${chosen ? "✓" : "+"}</button>`
            : Object.keys(CARD_TYPES).filter((t) => typeAllowed(t, id)).map((t) => html`
                <button class="mini" @click=${() => {
                  const s = this._cur.sections?.[si];
                  if (!s) return;
                  const card = clampCard(newCard(t, id), s.cols);
                  card.x = 0;
                  card.y = Math.max(0, ...s.cards.map((k) => (k.y | 0) + this._rows(k, s.cols)));
                  s.cards.push(card);
                  compactCards(s.cards, s.cols, (k) => this._rows(k, s.cols));
                  close(); this._emit();
                }}>${CARD_TYPES[t].label}</button>`)}
        </div>`;
      })}</div>
      <button class="mini wide" @click=${close}>Done</button>
    </div></div>`;
  }

  render() {
    if (!this.hass) return html``;
    const tab = this._cur;
    const auto = tab.kind === "auto";
    const cats = auto ? autoCategories(tab) : [];
    const af = this._af[tab.id] || "";
    const all = sectionsOf(tab, this.hass, af, this._rooms, this.layout?.roomNames || [],
      this.layout?.cardSizes || {});
    const sections = this.editing ? all : all.filter((sec) => this._shown(sec).length);
    this._secs = sections;
    return html`
      <div class="cols">
        ${this._headerBar("mob")}
        ${this._sidebar()}
        <main class="main">
          ${this._headerBar()}
          ${this._tabBar()}
          ${auto && cats.length > 1 ? html`<div class="subtabs">
            ${[{ key: "", name: "All", icon: "mdi:apps" }, ...cats].map((c) => html`
              <button class="sub ${af === c.key ? "on" : ""}" @click=${() => {
                this._af = { ...this._af, [tab.id]: c.key };
                this._anim = this._anim ^ 1;                 // replay the entry animation
              }}><ha-icon icon=${c.icon}></ha-icon>${c.name}</button>`)}
          </div>` : ""}
          <div class="secs" style="--tabcols:${this._usedCols(sections)};--gap:${GRID_GAP}px;--colw:${COL_W}px">
          ${sections.map((sec, si) => this._vis(sec) ? html`
            <div class="sec ${this._roomOver === si ? "drop" : ""}" data-si=${si}
                 style="--span:${this._stacked ? 1 : sec.cols}">
              ${sec.name || this.editing ? html`<div class="sec-t">${sec.name}
                ${this.editing && !auto ? html`<button class="sec-pen" @click=${(e) => { e.stopPropagation(); this._insp = { kind: "section", si }; }}>
                  <ha-icon icon="mdi:pencil"></ha-icon></button>` : ""}</div>` : ""}
              <div class="grid" data-grid=${si}
                   style="--cols:${this._cols(sec)};--row:${GRID_ROW}px;--gap:${GRID_GAP}px;--colw:${COL_W}px;--rows:${
                     Math.max(1, ...this._laid(sec).map((k) => (k.y | 0) + this._rows(k, this._cols(sec))))}">
                ${this._laid(sec).map((c, ci) => this._card(si, ci, c, auto, this._cols(sec)))}
                ${this._drag?.si === si ? html`<div class="ph"
                  style="--x:${this._drag.x};--y:${this._drag.y};--w:${this._drag.w};--h:${this._drag.h}"></div>` : ""}
              </div>
              ${this.editing && !auto ? html`<button class="mini add" @click=${() => this._pick = { mode: "card", si }}>+ Add card</button>` : ""}
            </div>` : "")}
          </div>
          ${auto && !sections.length ? html`<div class="empty">Open this tab's pencil and choose some entities.</div>` : ""}
          ${this.editing && auto ? html`<button class="mini add wide" @click=${() => {
            const name = prompt("Room name");
            if (!name) return;
            const list = this.layout.roomNames || [];
            if (!list.includes(name)) this.layout.roomNames = [...list, name];
            this._emit();
          }}>+ Add room</button>` : ""}
          ${this.editing && !auto ? html`<button class="mini add wide"
            @click=${() => { tab.sections.push(newSection(`Section ${tab.sections.length + 1}`)); this._emit(); }}>+ Add section</button>` : ""}
        </main>
      </div>
      ${this._inspector()}${this._pickerSheet()}`;
  }

  static styles = css`
    /* The cards are ported from the bedroom panel, so they carry its glass with them rather than
       inheriting the host's. casa-panel defines a flat dark --card and a 34px blur, which is why
       they came out looking washed out — these are the values the design was drawn against. */
    /* The panels this design comes from set this globally; without it every card renders its
       own padding and border *on top of* its grid cell and spills out the bottom. */
    *,*::before,*::after{box-sizing:border-box;}
    /* Chrome scrolls the page to compensate when content shifts; while cards re-pack that reads
       as the whole dashboard bouncing. Opt the dashboard out of scroll anchoring. */
    :host{display:block;overflow-anchor:none;
      --text:#fff;--dim:rgba(235,235,245,.6);
      --card:linear-gradient(150deg,rgba(255,255,255,.12),rgba(255,255,255,.03) 62%),rgba(255,255,255,.04);
      --cardBorder:rgba(255,255,255,.12);
      --chip:rgba(255,255,255,.09);--track:rgba(255,255,255,.15);
      --shadow:inset 0 1px 0 rgba(255,255,255,.14),0 14px 34px rgba(0,0,0,.34);
      --blur:blur(9px) saturate(120%) brightness(1.06);
      --green:#62D621;--orange:#FB6E1D;--yellow:#F8DE6F;
      color:var(--text);}
    ${unsafeCSS(cardStyles)}
    .dim{color:var(--dim,rgba(235,235,245,.6));}
    .acwrap{position:relative;}
    /* Fixed to the viewport, measured from the input each keystroke — inside the sheet it would
       either be clipped by the sheet's scrolling or push the rest of the form down. */
    .aclist{position:fixed;z-index:800;overflow:auto;padding:4px;border-radius:12px;
      background:rgba(18,24,30,.98);border:1px solid var(--cardBorder);
      box-shadow:0 18px 40px rgba(0,0,0,.55);display:flex;flex-direction:column;gap:2px;}
    .acrow{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;border-radius:8px;
      background:transparent;color:inherit;font:inherit;font-size:12.5px;text-align:left;cursor:pointer;}
    .acrow:hover{background:rgba(255,255,255,.08);}
    .acrow ha-icon{--mdc-icon-size:16px;color:var(--dim,rgba(235,235,245,.6));flex:none;}
    .acname{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .acroom{font-size:10.5px;color:var(--dim,rgba(235,235,245,.6));opacity:.7;flex:none;}
    .acid{margin-left:auto;font-size:10.5px;color:var(--dim,rgba(235,235,245,.6));opacity:.6;flex:none;
      font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
    .chips.tight{margin-top:8px;}
    .hint{font-size:11px;color:var(--dim,rgba(235,235,245,.5));margin-top:5px;}
    .pills{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:flex-end;margin-bottom:18px;}
    .pills.mob{display:none;}
    .pill{position:relative;display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 15px;border-radius:22px;
      border:1px solid var(--cardBorder,rgba(255,255,255,.12));background:var(--chip,rgba(255,255,255,.09));
      font-size:14px;font-weight:500;color:inherit;}
    .pill.editable{cursor:pointer;}
    /* the edit and settings buttons are pills too, just round ones */
    /* Square, so the 22px radius is a true circle — at 38px wide the browser scaled it down to
       19px and the button read as a rounded rectangle next to the fully rounded + pill. */
    .pill.round{width:44px;padding:0;justify-content:center;flex:none;}
    .pill.round.on{background:#fff;color:#0e1620;border-color:transparent;}
    .pill.round.on ha-icon{color:#0e1620;}
    .pill.add{cursor:pointer;padding:0 14px;}
    .pill ha-icon{--mdc-icon-size:19px;}
    .ghost{opacity:.4;outline:1px dashed rgba(255,255,255,.3);}
    .mini-pencil{--mdc-icon-size:13px;margin-left:4px;opacity:.7;}
    .cols{display:flex;gap:26px;align-items:flex-start;}
    /* Columns are a fixed width, so the main column ends wherever its last column does and the
       leftover used to sit as dead space on the right. Let the sidebar take that up instead, so
       the dashboard finishes at the edge of the page. */
    .side{flex:1 1 240px;min-width:240px;max-width:480px;display:flex;flex-direction:column;gap:6px;}
    .sgap{width:100%;}
    .sit{position:relative;border-radius:12px;padding:2px 4px;}
    /* the clock, date and greeting are block elements, so an inline pencil wraps below them —
       pin it to the item's top corner instead */
    .sit .mini-pencil{position:absolute;top:4px;right:4px;margin-left:0;}
    .sit.editable{cursor:pointer;}
    .sit.editable:hover{background:rgba(255,255,255,.05);}
    .clock{font-size:44px;font-weight:300;letter-spacing:-1px;line-height:1.05;}
    .date{font-size:13px;color:var(--dim,rgba(235,235,245,.6));}
    .shead{font-size:13px;color:var(--dim,rgba(235,235,245,.6));line-height:1.3;}

    /* Now playing, carried over from the casa app. Extended puts the art above the text; compact
       is the small row with the art beside it. */
    .np{position:relative;border-radius:26px;background:var(--card,rgba(255,255,255,.07));
      border:1px solid var(--cardBorder,rgba(255,255,255,.12));overflow:hidden;width:100%;box-sizing:border-box;}
    .np-art{position:relative;width:100%;aspect-ratio:1;background:linear-gradient(135deg,#8a5bff,#d06bff);
      background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;color:#fff;}
    .np-art ha-icon,.np-art ha-state-icon{--mdc-icon-size:40px;}
    .np-body{padding:16px 20px 20px;min-width:0;}
    .kick{font-size:11px;font-weight:600;letter-spacing:.6px;color:var(--dim,rgba(235,235,245,.6));
      text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .np-t{font-size:18px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px;}
    .np-a{font-size:13.5px;color:var(--dim,rgba(235,235,245,.6));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .np-prog{margin-top:14px;height:5px;border-radius:3px;background:var(--track);overflow:hidden;}
    .np-fill{height:100%;border-radius:3px;background:#fff;transition:width .25s linear;}
    .np-ctrls{display:flex;align-items:center;justify-content:center;gap:30px;margin-top:16px;}
    .np-ctrls .ic{--mdc-icon-size:30px;color:inherit;opacity:.9;cursor:pointer;}
    .np-ctrls .play{--mdc-icon-size:48px;color:var(--green);cursor:pointer;}

    .np.np-mini{display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:20px;}
    .np-mini .np-art{width:56px;height:56px;aspect-ratio:auto;border-radius:12px;flex:none;}
    .np-mini .np-art ha-icon,.np-mini .np-art ha-state-icon{--mdc-icon-size:26px;}
    .np-mini .np-body{flex:1;min-width:0;display:flex;align-items:center;gap:12px;padding:0;}
    .np-mini .np-txt{flex:1;min-width:0;}
    .np-mini .kick{font-size:10.5px;}
    .np-mini .np-t{font-size:14.5px;margin-top:0;}
    .np-mini .np-a{font-size:12.5px;}
    .np-mini .np-ctrls{margin-top:0;gap:16px;flex:none;}
    .np-mini .np-ctrls .ic{--mdc-icon-size:24px;}
    .np-mini .np-ctrls .play{--mdc-icon-size:36px;}

    /* Nothing to show: the entity's own icon on a plain ground, rather than a stand-in cover. */
    .np-art.noart{background:rgba(255,255,255,.06);}
    .np-art.noart ha-icon,.np-art.noart ha-state-icon{color:var(--dim,rgba(235,235,245,.6));}
    .greet{font-size:26px;font-weight:600;line-height:1.2;}
    .spill{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 13px;border-radius:19px;
      background:var(--chip,rgba(255,255,255,.09));border:1px solid var(--cardBorder,rgba(255,255,255,.12));font-size:13px;}
    .main{flex:0 1 auto;min-width:0;}
    /* overflow-x makes this a scroll container, and a scroll container clips the other axis too.
       Pad it by the lift allowance and pull the padding back out of the margins, so a lifted tab
       has somewhere to go and nothing around it moves. */
    .tabs{display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;
      padding:10px 0;margin:-10px 0 6px;}
    /* Never let a tab squeeze: the row scrolls instead. A shrinking tab would move every tab
       after it whenever anything changed the row's width. */
    .tab{flex:none;display:inline-flex;align-items:center;gap:7px;padding:9px 15px;border-radius:19px;
      border:1px solid var(--cardBorder,rgba(255,255,255,.12));background:var(--chip,rgba(255,255,255,.09));
      color:inherit;font:inherit;font-size:13.5px;cursor:pointer;}
    .tab.on{background:#fff;color:#0e1620;font-weight:600;}
    .tab ha-icon{--mdc-icon-size:17px;}
    /* A tab is TAB_COLS columns wide and a section takes some of them, so two three-column
       sections sit side by side and a six-column one is full width. */
    .secs{display:grid;grid-template-columns:repeat(var(--tabcols),minmax(0,var(--colw)));
      gap:22px var(--gap);align-items:start;justify-content:start;width:max-content;max-width:100%;}
    .sec{grid-column:span var(--span);min-width:0;}
    .sec-pen{width:24px;height:24px;border-radius:50%;border:none;background:var(--chip);color:var(--dim);
      cursor:pointer;display:inline-flex;align-items:center;justify-content:center;margin-left:8px;vertical-align:middle;}
    .sec-pen ha-icon{--mdc-icon-size:14px;}
    .sec-t{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dim,rgba(235,235,245,.6));margin:0 2px 10px;}
    /* A column is a fixed width, not a share of the screen. Stretching the columns to fill made a
       four column section 600px per card on a wide monitor; now the section is as wide as its
       columns need and no wider, and still shrinks below that on a narrow screen. */
    .grid{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));
      grid-template-rows:repeat(var(--rows,1),var(--row));grid-auto-rows:var(--row);
      gap:var(--gap);max-width:calc(var(--cols) * var(--colw) + (var(--cols) - 1) * var(--gap));}
    /* A card stops growing at a readable width — a section with few columns would otherwise
       stretch a two-line card across half the screen. The media hero is exempt: it is meant
       to be wide. */
    /* A card stops growing at a readable size. A section with few columns would otherwise stretch
       a two-line card across half the screen, and extra rows would stretch it down the page —
       none of these designs has anything to put in the space. Tiles are square by definition and
       the media hero is meant to be big, so both are exempt. */
    /* A card sits where it was put. Overlap is prevented by settling the section after every
       move — whatever a card lands on gives way downwards — not by taking the choice away. */
    .card{position:relative;grid-column:calc(var(--x) + 1) / span var(--w);
      grid-row:calc(var(--y) + 1) / span var(--h);min-width:0;min-height:0;border-radius:18px;}
    /* No overflow clip here: the inner card fills the cell exactly, so clipping would cut off the
       drop shadow and leave a hard edge. Only the hero needs it — its artwork can outgrow the cell. */
    .card.t-full{overflow:hidden;}
    /* A card clips its contents, which would cut a picker's menu in half. While one is open the
       card lets it through and lifts above its neighbours. */
    .card.menuopen{z-index:60;}
    .card.menuopen,.card.menuopen .gcard{overflow:visible;}
    .sec.drop{outline:2px dashed rgba(255,255,255,.35);outline-offset:6px;border-radius:14px;}
    /* An empty room would be zero pixels tall and impossible to drop onto. */
    :host([editing]) .sec .grid:empty{min-height:64px;border:1px dashed rgba(255,255,255,.16);border-radius:14px;}
    .subtabs{display:flex;flex-wrap:wrap;gap:8px;margin:-4px 0 14px;}
    .sub{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;cursor:pointer;
      border:1px solid var(--cardBorder);background:var(--chip);color:var(--dim);font:inherit;font-size:12.5px;
      transition:background .2s,color .2s,border-color .2s;}
    .sub.on{background:#fff;color:#0e1620;border-color:transparent;}
    .sub ha-icon{--mdc-icon-size:15px;}
    /* Two identical animations under different names: alternating them restarts the entry
       stagger when the filter changes, which a single name would not do. */
    @keyframes cardIn0{from{opacity:0;transform:translateY(8px) scale(.985);}to{opacity:1;transform:none;}}
    @keyframes cardIn1{from{opacity:0;transform:translateY(8px) scale(.985);}to{opacity:1;transform:none;}}
    .card.in0{animation:cardIn0 .3s cubic-bezier(.2,.7,.3,1) both;animation-delay:calc(var(--i,0) * 22ms);}
    .card.in1{animation:cardIn1 .3s cubic-bezier(.2,.7,.3,1) both;animation-delay:calc(var(--i,0) * 22ms);}
    @media (prefers-reduced-motion:reduce){ .card.in0,.card.in1{animation:none;} }

    /* Last on purpose: the entry animation also sets transform, and this has to win over it.
       The lifted card must not swallow the hit-test either, or it would always be the element
       under the cursor and there would be nothing to drop onto. */
    /* Dragging a card must not paint a text selection across everything it passes over. */
    :host([editing]) .card,:host([editing]) .sit,:host([editing]) .tab{cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;}
    .tab.lifted{z-index:40;pointer-events:none;
      transform:translate(var(--lx,0),var(--ly,0)) scale(1.06);
      filter:drop-shadow(0 14px 24px rgba(0,0,0,.5));cursor:grabbing;}
    .sit.lifted{z-index:40;position:relative;pointer-events:none;
      transform:translate(var(--lx,0),var(--ly,0)) scale(1.04);
      filter:drop-shadow(0 18px 30px rgba(0,0,0,.5));cursor:grabbing;}
    :host([editing]) .card *{user-select:none;-webkit-user-select:none;}
    .card.lifted{z-index:40;pointer-events:none;animation:none;
      transform:translate(var(--lx,0),var(--ly,0)) scale(1.08);
      filter:drop-shadow(0 22px 34px rgba(0,0,0,.55));cursor:grabbing;}
    .edit-veil{position:absolute;inset:0;border-radius:24px;z-index:2;}
    .card.editing{cursor:grab;touch-action:none;}
    .card.dragging{opacity:.35;}
    .nm{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .sb{font-size:12px;color:var(--dim,rgba(235,235,245,.6));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .sb.end{flex:none;margin-left:auto;}
    .pencil{position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:50%;border:none;
      background:rgba(0,0,0,.55);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:3;}
    .pencil ha-icon{--mdc-icon-size:15px;}
    .ph{grid-column:calc(var(--x) + 1) / span var(--w);grid-row:calc(var(--y) + 1) / span var(--h);
      pointer-events:none;grid-column:span 2;border:2px dashed rgba(94,155,255,.75);border-radius:20px;background:rgba(94,155,255,.08);}
    .empty{padding:26px;text-align:center;color:var(--dim,rgba(235,235,245,.6));font-size:13px;}
    .mini{padding:8px 13px;border-radius:11px;border:1px solid var(--cardBorder,rgba(255,255,255,.14));
      background:var(--chip,rgba(255,255,255,.09));color:inherit;font:inherit;font-size:12.5px;cursor:pointer;}
    .mini.on{background:#fff;color:#0e1620;font-weight:600;}
    .mini.del{color:#ff8a80;} .mini.add{margin-top:10px;} .mini.wide{width:100%;margin-top:12px;}
    .scrim{position:fixed;inset:0;z-index:500;background:rgba(6,9,12,.72);backdrop-filter:blur(14px);
      display:flex;align-items:center;justify-content:center;padding:18px;}
    .sheet{width:min(94vw,540px);max-height:88vh;overflow-y:auto;border-radius:24px;padding:18px;
      background:rgba(20,25,31,.97);border:1px solid var(--cardBorder,rgba(255,255,255,.14));
      box-shadow:0 24px 60px rgba(0,0,0,.55);}
    .sheet.tall{height:80vh;display:flex;flex-direction:column;}
    .sh-h{display:flex;align-items:center;gap:11px;margin-bottom:14px;}
    .sh-t{font-size:16px;font-weight:600;margin-bottom:10px;}
    .sh-h .grow{flex:1;min-width:0;} .sh-h .sh-t{margin:0;}
    .x{width:32px;height:32px;border-radius:50%;border:none;background:var(--chip,rgba(255,255,255,.09));
      color:inherit;cursor:pointer;padding:0;display:inline-flex;align-items:center;justify-content:center;
      line-height:0;}
    .f{margin-bottom:13px;}
    .f label{display:block;font-size:11.5px;color:var(--dim,rgba(235,235,245,.6));margin-bottom:5px;}
    .f input,.search{width:100%;box-sizing:border-box;padding:9px 11px;border-radius:10px;
      border:1px solid var(--cardBorder,rgba(255,255,255,.14));background:rgba(0,0,0,.25);color:inherit;font:inherit;font-size:13px;}
    .chips{display:flex;gap:6px;flex-wrap:wrap;}
    .chip{display:inline-flex;align-items:center;gap:6px;padding:8px 13px;border-radius:11px;
      border:1px solid var(--cardBorder,rgba(255,255,255,.14));background:var(--chip,rgba(255,255,255,.09));
      color:inherit;font:inherit;font-size:12.5px;cursor:pointer;}
    .chip.on{background:#fff;color:#0e1620;font-weight:600;}
    .chip[disabled]{opacity:.35;cursor:not-allowed;}
    .chip ha-icon{--mdc-icon-size:16px;}
    .two{display:flex;gap:12px;} .two .f{flex:1;}
    .two.locked{opacity:.45;}
    .stp{display:flex;align-items:center;gap:10px;} .stp span{font-size:13px;min-width:46px;text-align:center;}
    .pl{flex:1;overflow-y:auto;margin:10px 0;}
    .seg2{margin-bottom:12px;}
    .pr{display:flex;align-items:center;gap:8px;padding:7px 2px;font-size:13px;border-bottom:1px solid rgba(255,255,255,.06);}
    .pr .grow{flex:1;min-width:0;}
    .pr-t{display:flex;align-items:baseline;gap:7px;min-width:0;}
    .pr-n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .pr-room{flex:none;font-size:10.5px;color:var(--dim,rgba(235,235,245,.6));opacity:.65;white-space:nowrap;}
    select.pr-room{opacity:1;border:1px solid var(--cardBorder);background:rgba(0,0,0,.25);color:inherit;
      border-radius:7px;padding:1px 4px;font:inherit;font-size:10.5px;max-width:150px;cursor:pointer;}
    .pr-id{font-size:10.5px;color:var(--dim,rgba(235,235,245,.6));opacity:.6;white-space:nowrap;
      overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
    .pr ha-icon{--mdc-icon-size:18px;color:var(--dim,rgba(235,235,245,.6));}
    .cat{font-size:10.5px;color:var(--dim,rgba(235,235,245,.5));}
    .chosen{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;}
    .tagx{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:9px;font-size:11.5px;
      background:rgba(255,255,255,.08);}
    .tagx button{border:none;background:none;color:#ff8a80;cursor:pointer;font-size:11px;padding:0;}
    @media (max-width:760px){ .cols{flex-direction:column;}
      .side{flex:1 1 auto;width:100%;min-width:0;max-width:none;}
      /* Stacked, .cols runs as a column and its flex-start alignment sizes children to their
         content — main has to be told to take the width. */
      .main{width:100%;}
      /* Full width, or the row shrinks to its pills and flex-end has nothing to push against. */
      .pills.mob{display:flex;width:100%;} .main > .pills{display:none;}
      /* One section to a row, and its cards stretch the width rather than holding a column width
         meant for a desktop. */
      .secs{width:auto;grid-template-columns:1fr;}
      .sec{grid-column:1 / -1;}
      .grid{max-width:none;} }
  `;
}

if (!customElements.get("casa-view")) customElements.define("casa-view", CasaView);
