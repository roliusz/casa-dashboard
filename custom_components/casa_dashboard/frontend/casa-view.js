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
  CARD_TYPES, CATEGORIES, COL_W, GRID_GAP, GRID_ROW, PILL_TYPES, SIDEBAR_TYPES, TAB_COLS, tileRows,
  bothShown, categoryFor, clampCard, isVisible, newAutoTab, newCard, newPill, newSection,
  newSidebarItem, newTab, placeNear, sectionRows, sectionsOf, starterLayout, typeAllowed,
} = await import(`./casa-layout.js${V}`);
const { renderCard, cardStyles } = await import(`./casa-cards.js${V}`);

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
    _tab: { state: true },
    _insp: { state: true },     // {kind:'pill'|'side'|'card'|'tab', …ids}
    _drag: { state: true },
    _pick: { state: true },     // {mode:'card'|'auto'|'pill'|'side', si?}
    _q: { state: true },
  };

  constructor() { super(); this._tab = 0; this._q = ""; }

  // handed to casa-cards so the real cards can act
  get _ctx() {
    return {
      hass: this.hass,
      call: (d, sv, data) => this.hass.callService(d, sv, data),
      more: (entityId) => this.dispatchEvent(new CustomEvent("hass-more-info",
        { detail: { entityId }, bubbles: true, composed: true })),
    };
  }

  get _l() {
    if (!this.layout?.tabs?.length) this.layout = starterLayout();
    if (!this.layout.header) this.layout.header = { pills: [] };
    if (!this.layout.sidebar) this.layout.sidebar = { items: [] };
    return this.layout;
  }
  get _tabs() { return this._l.tabs; }
  get _cur() { return this._tabs[Math.min(this._tab, this._tabs.length - 1)]; }
  _emit() {
    this.dispatchEvent(new CustomEvent("layout-changed", { detail: this.layout, bubbles: true, composed: true }));
    this.requestUpdate();
  }
  _vis(item) { return this.editing || isVisible(item, this.narrow, this.hass); }

  /* -------------------------------------------------------- live values */
  _st(e) { return this.hass?.states?.[e]; }
  _nameOf(c) {
    if (c.name) return c.name;
    return this._st(c.entity)?.attributes?.friendly_name || c.entity || "Not set";
  }
  _iconOf(c) { return c.icon || this._st(c.entity)?.attributes?.icon || iconFor(c.entity); }
  _isOn(c) {
    const s = this._st(c.entity);
    return !!s && !["off", "unavailable", "unknown", "idle", "closed"].includes(s.state);
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
  _tap(c) {
    if (this.editing) return;
    const d = String(c.entity || "").split(".")[0];
    if (["light", "switch", "fan", "input_boolean"].includes(d)) this.hass.callService("homeassistant", "toggle", { entity_id: c.entity });
    else if (d === "scene" || d === "script") this.hass.callService(d, "turn_on", { entity_id: c.entity });
    else if (c.entity) this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: c.entity }, bubbles: true, composed: true }));
  }

  /* ------------------------------------------------------------- mutate */
  _patch(obj, patch) { Object.assign(obj, patch); this._emit(); }
  _removeFrom(arr, i) { arr.splice(i, 1); this._insp = null; this._emit(); }

  /* ------------------------------------------------------------ header */
  _headerBar() {
    const pills = this._l.header.pills || [];
    return html`<div class="pills">
      ${pills.map((p, i) => this._vis(p) ? html`
        <div class="pill ${this.editing ? "editable" : ""} ${!isVisible(p, this.narrow, this.hass) ? "ghost" : ""}"
             @click=${() => this.editing && (this._insp = { kind: "pill", i })}>
          ${this._pillBody(p)}
          ${this.editing ? html`<ha-icon class="mini-pencil" icon="mdi:pencil"></ha-icon>` : ""}
        </div>` : "")}
      ${this.editing ? html`<button class="pill add" title="Add a pill"
        @click=${() => this._pick = { mode: "pill" }}><ha-icon icon="mdi:plus"></ha-icon></button>` : ""}
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
        <div class="sit ${this.editing ? "editable" : ""} ${!isVisible(it, this.narrow, this.hass) ? "ghost" : ""}"
             @click=${() => this.editing && (this._insp = { kind: "side", i })}>
          ${it.type === "clock" ? html`<div class="clock">${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>`
            : it.type === "date" ? html`<div class="date">${now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}</div>`
            : it.type === "greeting" ? html`<div class="greet">${this._greeting()}</div>`
            : html`<div class="spill"><ha-icon icon=${this._iconOf(it)}></ha-icon><span>${this._sub(it)}</span></div>`}
          ${this.editing ? html`<ha-icon class="mini-pencil" icon="mdi:pencil"></ha-icon>` : ""}
        </div>` : "")}
      ${this.editing ? html`<button class="mini add" @click=${() => this._pick = { mode: "side" }}>+ Add to sidebar</button>` : ""}
    </aside>`;
  }
  _greeting() {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }

  /* -------------------------------------------------------------- tabs */
  _tabBar() {
    return html`<div class="tabs">
      ${this._tabs.map((t, i) => this._vis(t) ? html`
        <button class="tab ${i === this._tab ? "on" : ""} ${!isVisible(t, this.narrow, this.hass) ? "ghost" : ""}"
                @click=${() => (this._tab = i)}>
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
  firstUpdated() {
    this._ro = new ResizeObserver(() => {
      const g = this.renderRoot.querySelector(".grid");
      if (g?.clientWidth && g.clientWidth !== this._gw) { this._gw = g.clientWidth; this.requestUpdate(); }
    });
    this._ro.observe(this);
  }
  disconnectedCallback() { super.disconnectedCallback(); this._ro?.disconnect(); }

  /** Width of one column in the given section, in px (0 until measured). */
  _colw(cols) { return this._gw ? (this._gw - GRID_GAP * (cols - 1)) / cols : 0; }

  /* ------------------------------------------------------------- cards */
  _card(si, ci, c, auto, cols = 4) {
    if (!this._vis(c)) return "";
    // A square card can't use its stored height: rows are fixed, columns aren't.
    const rows = c.type === "tile" ? tileRows(this._colw(cols), c.w) : c.h;
    const on = this._isOn(c), t = c.type;
    const dragging = this._drag?.si === si && this._drag?.ci === ci;
    const art = t === "full" ? this._st(c.entity)?.attributes?.entity_picture : null;
    return html`
      <div class="card t-${t} ${on ? "on" : ""} ${dragging ? "dragging" : ""} ${this.editing ? "editing" : ""} ${!isVisible(c, this.narrow, this.hass) ? "ghost" : ""}"
           data-ci=${ci} style="--x:${c.x | 0};--y:${c.y | 0};--w:${c.w};--h:${rows}"
           @pointerdown=${(e) => !auto && this._dragStart(e, si, ci)} @click=${() => this._tap(c)}>
        ${renderCard(this._ctx, c)}
        ${this.editing ? html`<div class="edit-veil"></div>` : ""}
        ${this.editing && !auto ? html`
          <button class="pencil" @click=${(e) => { e.stopPropagation(); this._insp = { kind: "card", si, ci }; }}>
            <ha-icon icon="mdi:pencil"></ha-icon></button>
          <div class="grip" @pointerdown=${(e) => this._resize(e, si, ci)}></div>` : ""}
      </div>`;
  }

  _dragStart(e, si, ci) {
    if (!this.editing || e.target.closest(".pencil, .grip")) return;
    const sec = this._cur.sections[si], card = sec.cards[ci];
    const grid = this.renderRoot.querySelector(`[data-grid="${si}"]`);
    if (!grid) return;
    const r = grid.getBoundingClientRect();
    const colW = (r.width - GRID_GAP * (sec.cols - 1)) / sec.cols;
    // where in the card the grab happened, so it doesn't jump under the cursor
    const cr = e.currentTarget.getBoundingClientRect();
    const offX = (e.clientX - cr.left) / (colW + GRID_GAP);
    const offY = (e.clientY - cr.top) / (GRID_ROW + GRID_GAP);
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const cellAt = (ev) => ({
      x: (ev.clientX - r.left) / (colW + GRID_GAP) - offX,
      y: (ev.clientY - r.top) / (GRID_ROW + GRID_GAP) - offY,
    });
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      moved = true;
      const want = cellAt(ev);
      const at = placeNear(sec.cards, card, want.x, want.y, sec.cols, (k) => this._rows(k, sec.cols));
      if (!this._drag || this._drag.x !== at.x || this._drag.y !== at.y) {
        this._drag = { si, ci, ...at, w: card.w, h: this._rows(card, sec.cols) };
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      if (moved && this._drag) { card.x = this._drag.x; card.y = this._drag.y; this._drag = null; this._emit(); }
      else this._drag = null;
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }
  /** Rows a card occupies — a tile's height follows its width, so it can't use the stored value. */
  _rows(c, cols) { return c.type === "tile" ? tileRows(this._colw(cols), c.w) : c.h; }

  _resize(e, si, ci) {
    e.stopPropagation(); e.preventDefault();
    const s = this._cur.sections[si], card = s.cards[ci];
    const grid = this.renderRoot.querySelector(`[data-grid="${si}"]`);
    const colW = (grid.getBoundingClientRect().width - GRID_GAP * (s.cols - 1)) / s.cols;
    const x0 = e.clientX, y0 = e.clientY, w0 = card.w, h0 = card.h;
    const move = (ev) => {
      Object.assign(card, { w: w0 + Math.round((ev.clientX - x0) / (colW + GRID_GAP)),
                            h: h0 + Math.round((ev.clientY - y0) / (GRID_ROW + GRID_GAP)) });
      clampCard(card, s.cols); this._emit();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  /* --------------------------------------------------------- inspector */
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
  _condition(item) {
    const c = item.visibleWhen || {};
    return html`<div class="f"><label>Only show when (optional)</label>
      <input placeholder="entity id" .value=${c.entity || ""}
        @change=${(e) => { item.visibleWhen = e.target.value ? { ...c, entity: e.target.value } : undefined; this._emit(); }}>
      <div class="hint">Left blank it's always shown. With an entity it appears only while that entity is active.</div></div>`;
  }

  _inspector() {
    if (!this._insp) return "";
    const k = this._insp.kind;
    const close = () => (this._insp = null);
    let title = "", body = "", onDelete = null;

    if (k === "section") {
      const sec = this._cur.sections[this._insp.si];
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
          <input .value=${p.entity || ""} @change=${(e) => this._patch(p, { entity: e.target.value })}></div>` : ""}
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
          <input .value=${it.entity || ""} @change=${(e) => this._patch(it, { entity: e.target.value })}></div>` : ""}
        ${this._showChips(it)}${this._condition(it)}`;
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
      const s = this._cur.sections[this._insp.si];
      const c = s?.cards[this._insp.ci];
      if (!c) return "";
      const ct = CARD_TYPES[c.type];
      title = this._nameOf(c);
      onDelete = () => this._removeFrom(s.cards, this._insp.ci);
      const patchCard = (patch) => { Object.assign(c, patch); clampCard(c, s.cols); this._emit(); };
      body = html`
        <div class="f"><label>Card type</label><div class="chips">
          ${Object.entries(CARD_TYPES).map(([key, v]) => html`
            <button class="chip ${c.type === key ? "on" : ""}" ?disabled=${!typeAllowed(key, c.entity)}
              title=${typeAllowed(key, c.entity) ? v.sub : "Media players only"}
              @click=${() => patchCard({ type: key, w: v.w, h: v.square ? v.w : v.h })}>${v.label}</button>`)}
        </div></div>
        <div class="two">
          <div class="f"><label>Width</label><div class="stp">
            <button class="mini" @click=${() => patchCard({ w: c.w - 1 })}>−</button><span>${c.w}</span>
            <button class="mini" @click=${() => patchCard({ w: c.w + 1 })}>+</button></div></div>
          <div class="f"><label>Height</label><div class="stp">
            <button class="mini" ?disabled=${ct?.square || ct?.maxH === 1} @click=${() => patchCard({ h: c.h - 1 })}>−</button>
            <span>${c.h}${ct?.square ? " ·sq" : ""}</span>
            <button class="mini" ?disabled=${ct?.square || ct?.maxH === 1} @click=${() => patchCard({ h: c.h + 1 })}>+</button></div></div>
        </div>
        <div class="f"><label>Entity</label><input .value=${c.entity || ""} @change=${(e) => patchCard({ entity: e.target.value })}></div>
        <div class="f"><label>Name (optional)</label><input .value=${c.name || ""} placeholder=${this._nameOf(c)}
          @change=${(e) => patchCard({ name: e.target.value || undefined })}></div>
        ${this._showChips(c)}${this._condition(c)}`;
    }

    return html`<div class="scrim" @click=${close}><div class="sheet" @click=${(e) => e.stopPropagation()}>
      <div class="sh-h"><div class="grow"><div class="sh-t">${title}</div></div>
        <button class="x" @click=${close}><ha-icon icon="mdi:close"></ha-icon></button></div>
      ${body}
      ${onDelete ? html`<button class="mini del wide" @click=${onDelete}>Remove</button>` : ""}
    </div></div>`;
  }

  /* ------------------------------------------------------------ picker */
  _pickerSheet() {
    if (!this._pick) return "";
    const { mode, si } = this._pick;
    const close = () => { this._pick = null; this._q = ""; };
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
    // entity pickers: single card, or multi-select for an auto tab
    const q = this._q.toLowerCase();
    const ids = Object.keys(this.hass?.states || {})
      .filter((id) => !q || id.includes(q) || (this._st(id).attributes.friendly_name || "").toLowerCase().includes(q))
      .slice(0, 60);
    const tab = this._cur;
    return html`<div class="scrim" @click=${close}><div class="sheet tall" @click=${(e) => e.stopPropagation()}>
      <div class="sh-t">${mode === "auto" ? "Choose entities — they'll be grouped automatically" : "Add a card"}</div>
      <input class="search" placeholder="Search…" .value=${this._q} @input=${(e) => (this._q = e.target.value)}>
      <div class="pl">${ids.map((id) => {
        const chosen = mode === "auto" && (tab.entities || []).includes(id);
        return html`<div class="pr">
          <ha-icon icon=${iconFor(id)}></ha-icon>
          <span class="grow">${this._st(id).attributes.friendly_name || id}</span>
          ${mode === "auto"
            ? html`<span class="cat">${categoryFor(id).name}</span>
                <button class="mini ${chosen ? "on" : ""}" @click=${() => {
                  tab.entities = tab.entities || [];
                  chosen ? tab.entities.splice(tab.entities.indexOf(id), 1) : tab.entities.push(id);
                  this._emit();
                }}>${chosen ? "✓" : "+"}</button>`
            : Object.keys(CARD_TYPES).filter((t) => typeAllowed(t, id)).map((t) => html`
                <button class="mini" @click=${() => {
                  const s = this._cur.sections[si];
                  s.cards.push(clampCard(newCard(t, id), s.cols)); close(); this._emit();
                }}>${CARD_TYPES[t].label}</button>`)}
        </div>`;
      })}</div>
      <button class="mini wide" @click=${close}>Done</button>
    </div></div>`;
  }

  render() {
    if (!this.hass) return html``;
    const tab = this._cur;
    const sections = sectionsOf(tab);
    const auto = tab.kind === "auto";
    return html`
      ${this._headerBar()}
      <div class="cols">
        ${this._sidebar()}
        <main class="main">
          ${this._tabBar()}
          <div class="secs" style="--tabcols:${TAB_COLS};--gap:${GRID_GAP}px;--colw:${COL_W}px">
          ${sections.map((sec, si) => this._vis(sec) ? html`
            <div class="sec" style="--span:${sec.cols}">
              ${sec.name || this.editing ? html`<div class="sec-t">${sec.name}${auto ? html`<span class="auto-tag">auto</span>` : ""}
                ${this.editing && !auto ? html`<button class="sec-pen" @click=${(e) => { e.stopPropagation(); this._insp = { kind: "section", si }; }}>
                  <ha-icon icon="mdi:pencil"></ha-icon></button>` : ""}</div>` : ""}
              <div class="grid" data-grid=${si}
                   style="--cols:${sec.cols};--row:${GRID_ROW}px;--gap:${GRID_GAP}px;--colw:${COL_W}px;--rows:${Math.max(1, sectionRows(sec, (k) => this._rows(k, sec.cols)))}">
                ${sec.cards.map((c, ci) => this._card(si, ci, c, auto, sec.cols))}
                ${this._drag?.si === si ? html`<div class="ph"
                  style="--x:${this._drag.x};--y:${this._drag.y};--w:${this._drag.w};--h:${this._drag.h}"></div>` : ""}
              </div>
              ${this.editing && !auto ? html`<button class="mini add" @click=${() => this._pick = { mode: "card", si }}>+ Add card</button>` : ""}
            </div>` : "")}
          </div>
          ${auto && !sections.length ? html`<div class="empty">Open this tab's pencil and choose some entities.</div>` : ""}
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
    :host{display:block;
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
    .hint{font-size:11px;color:var(--dim,rgba(235,235,245,.5));margin-top:5px;}
    .pills{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:flex-end;margin-bottom:18px;}
    .pill{position:relative;display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 15px;border-radius:22px;
      border:1px solid var(--cardBorder,rgba(255,255,255,.12));background:var(--chip,rgba(255,255,255,.09));
      font-size:14px;font-weight:500;color:inherit;}
    .pill.editable{cursor:pointer;}
    .pill.add{cursor:pointer;padding:0 14px;}
    .pill ha-icon{--mdc-icon-size:19px;}
    .ghost{opacity:.4;outline:1px dashed rgba(255,255,255,.3);}
    .mini-pencil{--mdc-icon-size:13px;margin-left:4px;opacity:.7;}
    .cols{display:flex;gap:26px;align-items:flex-start;}
    .side{flex:0 0 240px;display:flex;flex-direction:column;gap:6px;}
    .sit{position:relative;border-radius:12px;padding:2px 4px;}
    .sit.editable{cursor:pointer;}
    .sit.editable:hover{background:rgba(255,255,255,.05);}
    .clock{font-size:44px;font-weight:300;letter-spacing:-1px;line-height:1.05;}
    .date{font-size:13px;color:var(--dim,rgba(235,235,245,.6));}
    .greet{font-size:26px;font-weight:600;margin-top:12px;line-height:1.2;}
    .spill{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 13px;border-radius:19px;
      background:var(--chip,rgba(255,255,255,.09));border:1px solid var(--cardBorder,rgba(255,255,255,.12));font-size:13px;}
    .main{flex:1;min-width:0;}
    .tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;}
    .tab{display:inline-flex;align-items:center;gap:7px;padding:9px 15px;border-radius:19px;
      border:1px solid var(--cardBorder,rgba(255,255,255,.12));background:var(--chip,rgba(255,255,255,.09));
      color:inherit;font:inherit;font-size:13.5px;cursor:pointer;}
    .tab.on{background:#fff;color:#0e1620;font-weight:600;}
    .tab ha-icon{--mdc-icon-size:17px;}
    /* A tab is TAB_COLS columns wide and a section takes some of them, so two three-column
       sections sit side by side and a six-column one is full width. */
    .secs{display:grid;grid-template-columns:repeat(var(--tabcols),minmax(0,var(--colw)));
      gap:22px var(--gap);align-items:start;justify-content:start;}
    .sec{grid-column:span var(--span);min-width:0;}
    .sec-pen{width:24px;height:24px;border-radius:50%;border:none;background:var(--chip);color:var(--dim);
      cursor:pointer;display:inline-flex;align-items:center;justify-content:center;margin-left:8px;vertical-align:middle;}
    .sec-pen ha-icon{--mdc-icon-size:14px;}
    .sec-t{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dim,rgba(235,235,245,.6));margin:0 2px 10px;}
    .auto-tag{font-size:10px;padding:2px 7px;border-radius:8px;background:rgba(94,155,255,.2);color:#9dc4ff;}
    /* A column is a fixed width, not a share of the screen. Stretching the columns to fill made a
       four column section 600px per card on a wide monitor; now the section is as wide as its
       columns need and no wider, and still shrinks below that on a narrow screen. */
    .grid{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));
      grid-template-rows:repeat(var(--rows),var(--row));grid-auto-rows:var(--row);
      gap:var(--gap);max-width:calc(var(--cols) * var(--colw) + (var(--cols) - 1) * var(--gap));}
    /* A card stops growing at a readable width — a section with few columns would otherwise
       stretch a two-line card across half the screen. The media hero is exempt: it is meant
       to be wide. */
    /* A card stops growing at a readable size. A section with few columns would otherwise stretch
       a two-line card across half the screen, and extra rows would stretch it down the page —
       none of these designs has anything to put in the space. Tiles are square by definition and
       the media hero is meant to be big, so both are exempt. */
    .card{position:relative;grid-column:calc(var(--x) + 1) / span var(--w);grid-row:calc(var(--y) + 1) / span var(--h);min-width:0;min-height:0;
      overflow:hidden;border-radius:18px;}
    .card.t-tile{aspect-ratio:1;height:auto;align-self:start;}
    .edit-veil{position:absolute;inset:0;border-radius:24px;z-index:2;}
    .card.editing{cursor:grab;touch-action:none;}
    .card.dragging{opacity:.35;}
    .nm{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .sb{font-size:12px;color:var(--dim,rgba(235,235,245,.6));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .sb.end{flex:none;margin-left:auto;}
    .pencil{position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:50%;border:none;
      background:rgba(0,0,0,.55);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:3;}
    .pencil ha-icon{--mdc-icon-size:15px;}
    .grip{position:absolute;right:2px;bottom:2px;width:18px;height:18px;cursor:nwse-resize;touch-action:none;z-index:3;
      background:linear-gradient(135deg,transparent 50%,rgba(255,255,255,.5) 50%);border-radius:0 0 18px 0;}
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
    .x{width:32px;height:32px;border-radius:50%;border:none;background:var(--chip,rgba(255,255,255,.09));color:inherit;cursor:pointer;}
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
    .stp{display:flex;align-items:center;gap:10px;} .stp span{font-size:13px;min-width:46px;text-align:center;}
    .pl{flex:1;overflow-y:auto;margin:10px 0;}
    .pr{display:flex;align-items:center;gap:8px;padding:7px 2px;font-size:13px;border-bottom:1px solid rgba(255,255,255,.06);}
    .pr .grow{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .pr ha-icon{--mdc-icon-size:18px;color:var(--dim,rgba(235,235,245,.6));}
    .cat{font-size:10.5px;color:var(--dim,rgba(235,235,245,.5));}
    .chosen{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;}
    .tagx{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:9px;font-size:11.5px;
      background:rgba(255,255,255,.08);}
    .tagx button{border:none;background:none;color:#ff8a80;cursor:pointer;font-size:11px;padding:0;}
    @media (max-width:760px){ .cols{flex-direction:column;} .side{flex:1 1 auto;width:100%;} }
  `;
}

if (!customElements.get("casa-view")) customElements.define("casa-view", CasaView);
