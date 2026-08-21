/**
 * Casa Dashboard — the panel shell.
 *
 * Deliberately small: it loads the layout from the integration, paints the background, offers the
 * pencil and the settings sheet, and hands everything else to <casa-view>. There is no knowledge of
 * any particular home in here — no entities, no rooms, no personal anything. Whatever a user sees
 * comes from their saved layout.
 */
// The panel is loaded with a ?v=<integration version> query. Propagating that query to every
// import means a HACS update can never leave a stale module cached in someone's browser.
const V = new URL(import.meta.url).search;
const { LitElement, html, css } = await import(`./lit-all.min.js${V}`);
const { starterLayout, normalizeLayout, areaMap } = await import(`./casa-layout.js${V}`);
await import(`./casa-view.js${V}`);

console.info(`Casa Dashboard ${new URLSearchParams(V).get("v") || "dev"} loaded`);

/** Matches the view's stacking width, so the phone layout and the phone scale switch together. */
const STACK_W = 760;
/** How much smaller a phone draws, on top of whatever scale the user picked. */
const MOBILE_SCALE = 0.9;

const WS_GET = "casa_dashboard/get";
const WS_SET = "casa_dashboard/set";

// Small steps: the grid keeps its column count, so cards can only widen as far as the screen
// allows. Anything larger stretches them taller without making them wider.
export const SCALES = [
  { v: 1,    label: "1×" },
  { v: 1.05, label: "1.05×" },
  { v: 1.1,  label: "1.1×" },
  { v: 1.15, label: "1.15×" },
];

// Where this module was served from, so the wallpapers resolve wherever the integration is
// mounted rather than against a path written down twice.
const ASSETS = new URL(".", import.meta.url).href;

/**
 * The wallpapers that ship with the integration. Dusk keeps the empty value, so a dashboard that
 * has never chosen one is already on it.
 */
export const WALLPAPERS = [
  { name: "Dusk",   value: "",       file: "wallpapers/dusk.jpg" },
  { name: "Taupe",  value: "taupe",  file: "wallpapers/taupe.jpg" },
  { name: "Aurora", value: "aurora", file: "wallpapers/aurora.jpg" },
  { name: "Sunset", value: "sunset", file: "wallpapers/sunset.jpg" },
].map((w) => ({ ...w, css: `url('${ASSETS}${w.file}')` }));

/** A wallpaper the user typed, rather than one of the presets above. */
const isUrl = (v) => !!v && !WALLPAPERS.some((w) => w.value === v);

const DEFAULT_SETTINGS = {
  wallpaper: "",                     // image url; blank = the built-in gradient
  title: "Casa",
  scale: 1,                          // how large everything is drawn; see SCALES
};

class CasaPanel extends LitElement {
  static properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    panel: { attribute: false },
    _layout: { state: true },
    _settings: { state: true },
    _edit: { state: true },
    _showSettings: { state: true },
    _loaded: { state: true },
    _areas: { state: true },
    _areaNames: { state: true },
  };

  constructor() {
    super();
    this._settings = { ...DEFAULT_SETTINGS };
    this._edit = false;
    this._loaded = false;
  }

  /**
   * Lovelace calls this on a card. Being a card as well as a panel is what lets someone make this
   * their default dashboard: Home Assistant's default-dashboard setting — and the companion app's
   * — only ever lists Lovelace dashboards, never a custom panel like the sidebar entry.
   *
   * There is nothing to configure: the layout lives in the integration's own storage, the same one
   * the panel reads, so both show the same dashboard and editing either edits both.
   */
  setConfig(config) { this._cardConfig = config || {}; }

  /** Tall: it is meant to be the only card in a panel view. */
  getCardSize() { return 100; }

  connectedCallback() {
    super.connectedCallback();
    // The same width the view stacks at, so the scale and the two-column layout switch together.
    this._mq = window.matchMedia(`(max-width:${STACK_W}px)`);
    this._onMq = () => this.requestUpdate();
    this._mq.addEventListener("change", this._onMq);
  }

  disconnectedCallback() {
    this._mq?.removeEventListener("change", this._onMq);
    super.disconnectedCallback();
  }

  /**
   * A phone caps the grid at two columns, and at full size those columns are squeezed well under
   * the width the cards are drawn for — everything inside them ends up cramped. Shrinking the
   * whole view buys the columns back that width, so cards sit closer to their intended shape.
   */
  get _scale() {
    return (this._settings.scale || 1) * (this._mq?.matches ? MOBILE_SCALE : 1);
  }

  updated(ch) { if (ch.has("hass")) this._load(); }

  async _load() {
    if (this._loading || this._loaded || !this.hass?.connection) return;
    this._loading = true;
    try {
      const cfg = await this.hass.connection.sendMessagePromise({ type: WS_GET });
      this._layout = normalizeLayout(cfg?.layout || starterLayout());
      this._settings = { ...DEFAULT_SETTINGS, ...(cfg?.settings || {}) };
    } catch (e) {
      // integration missing or not ready — still usable, just can't persist
      this._layout = starterLayout();
      this._err = true;
    }
    this._loaded = true;
    this._loadAreas();
  }

  /**
   * Which room each entity is in. `hass` does not always carry the registries — depending on the
   * version and on what the frontend has subscribed to, hass.areas can be empty — and without them
   * every entity looks unassigned and lands in "Other". Ask for them directly.
   */
  async _loadAreas() {
    try {
      const [areas, devices, entities] = await Promise.all([
        this.hass.callWS({ type: "config/area_registry/list" }),
        this.hass.callWS({ type: "config/device_registry/list" }),
        this.hass.callWS({ type: "config/entity_registry/list" }),
      ]);
      this._areas = areaMap(areas, devices, entities);
      this._areaNames = areas.map((a) => a.name).sort((a, b) => a.localeCompare(b));
      console.info(`Casa Dashboard: ${Object.keys(this._areas).length} entities matched to ${areas.length} rooms`);
    } catch (e) {
      console.warn("Casa Dashboard: could not read the area registry, grouping without rooms", e);
      this._areas = {}; this._areaNames = [];
    }
  }

  /** Persist, coalesced so a drag doesn't write once per frame. */
  _save() {
    clearTimeout(this._t);
    this._t = setTimeout(async () => {
      try {
        await this.hass?.connection?.sendMessagePromise({
          type: WS_SET, config: { layout: this._layout, settings: this._settings },
        });
        if (this._err) { this._err = false; this.requestUpdate(); }
      } catch (e) {
        // A write that fails quietly looks exactly like one that worked — until the next reload,
        // when the work is gone. Say so instead.
        console.error("Casa Dashboard: could not save the dashboard", e);
        this._err = true;
        this.requestUpdate();
      }
    }, 500);
  }

  _setSetting(k, v) { this._settings = { ...this._settings, [k]: v }; this._save(); }

  _settingsSheet() {
    return html`<div class="scrim" @click=${() => (this._showSettings = false)}>
      <div class="sheet" @click=${(e) => e.stopPropagation()}>
        <div class="sh-h"><div class="sh-t">Settings</div>
          <button class="x" @click=${() => (this._showSettings = false)}><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="f"><label>Dashboard name</label>
          <input .value=${this._settings.title || ""} @change=${(e) => this._setSetting("title", e.target.value)}></div>
        ${(() => {
          const at = Math.max(0, SCALES.findIndex((x) => x.v === (this._settings.scale || 1)));
          return html`<div class="f"><label>Scale</label>
            <div class="seg" style="--n:${SCALES.length};--ind:${(at / SCALES.length) * 100}%">
              <div class="seg-ind"></div>
              ${SCALES.map((x, i) => html`<button class="seg-b ${i === at ? "on" : ""}"
                @click=${() => this._setSetting("scale", x.v)}>${x.label}</button>`)}
            </div>
            <div class="hint">Draws the whole dashboard larger — useful on a wall panel across the room.</div>
          </div>`;
        })()}
        <div class="f"><label>Wallpaper</label>
          <div class="wps">
            ${WALLPAPERS.map((w) => html`
              <button class="wp ${(this._settings.wallpaper || "") === w.value ? "on" : ""}"
                title=${w.name} style=${`--sw:${w.css}`}
                @click=${() => this._setSetting("wallpaper", w.value)}>
                <span>${w.name}</span></button>`)}
          </div></div>
        <div class="f"><label>…or your own image</label>
          <input placeholder="/local/my-wallpaper.jpg"
            .value=${isUrl(this._settings.wallpaper) ? this._settings.wallpaper : ""}
            @change=${(e) => this._setSetting("wallpaper", e.target.value)}>
          <div class="hint">Any image Home Assistant serves, e.g. something you've put in <code>/config/www</code>.</div></div>
        <button class="mini danger wide" @click=${() => {
          if (!confirm("Clear the whole dashboard and start again?")) return;
          this._layout = starterLayout(); this._showSettings = false; this._save();
        }}>Start over</button>
      </div></div>`;
  }

  render() {
    if (!this._loaded) return html`<div class="shell"><div class="loading">Loading…</div></div>`;
    const wp = this._settings.wallpaper;
    const preset = WALLPAPERS.find((w) => w.value === wp);
    return html`
      <div class="shell" style=${preset ? `--wp:${preset.css}` : wp ? `--wp:url('${wp}')` : ""}>
        ${this._err ? html`<div class="warnbar"><span class="warn"
          title="Changes are not being saved — see the browser console">not saving</span></div>` : ""}

        <casa-view style=${`zoom:${this._scale}`} .hass=${this.hass} .layout=${this._layout} .areas=${this._areas} .areaNames=${this._areaNames} ?editing=${this._edit} ?narrow=${this.narrow}
          @layout-changed=${(e) => { this._layout = e.detail; this._save(); }}
          @toggle-edit=${() => (this._edit = !this._edit)}
          @open-settings=${() => (this._showSettings = true)}></casa-view>

        ${this._showSettings ? this._settingsSheet() : ""}
      </div>`;
  }

  static styles = css`
    :host{display:block;height:100%;
      --text:#fff;--dim:rgba(235,235,245,.6);
      --card:linear-gradient(150deg,rgba(255,255,255,.12),rgba(255,255,255,.03) 62%),rgba(255,255,255,.04);
      --cardBorder:rgba(255,255,255,.12);--chip:rgba(255,255,255,.09);--track:rgba(255,255,255,.15);
      --shadow:inset 0 1px 0 rgba(255,255,255,.14),0 14px 34px rgba(0,0,0,.34);
      --blur:blur(9px) saturate(120%) brightness(1.06);
      --green:#62D621;--orange:#FB6E1D;--yellow:#F8DE6F;
      font-family:Outfit,-apple-system,"Helvetica Neue",sans-serif;-webkit-font-smoothing:antialiased;
      color:var(--text);}
    /* Reserve the scrollbar's width permanently. Moving a card changes the page height, and
       without this the bar appearing or vanishing changes the content width — which reflows the
       wrapped tab row and shifts the + buttons mid-drag. */
    /* Keep the scrollbar's space reserved: dragging a card taller made the page scroll, which
       narrowed everything by the scrollbar's width and rewrapped the tab row under the cursor. */
    .shell{min-height:100%;box-sizing:border-box;padding:10px 22px 40px;overflow-y:auto;scrollbar-gutter:stable;overflow-anchor:none;
      background:#0b1014;isolation:isolate;}
    /* The background is its own fixed layer rather than background-attachment:fixed, which mobile
       browsers ignore — there it falls back to scrolling with the content. */
    .shell::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
      background-color:#0b1014;
      background-image:var(--wp,radial-gradient(120% 90% at 70% 10%,#26323d,#161d24 45%,#0b1014));
      background-size:cover;background-position:center;background-repeat:no-repeat;}
    /* 22px of gutter costs a phone real width. casa-app settles on 16, plus room for the home
       indicator at the bottom. */
    @media (max-width:760px){
      .shell{padding:8px 16px calc(40px + env(safe-area-inset-bottom));}
    }
    .loading{padding:40px;color:var(--dim);font-size:14px;}
    .warnbar{display:flex;justify-content:flex-end;margin-bottom:8px;}
    .warn{font-size:11.5px;color:#ffcf8a;background:rgba(255,180,80,.14);padding:5px 10px;border-radius:9px;}
    .scrim{position:fixed;inset:0;z-index:600;background:rgba(6,9,12,.72);backdrop-filter:blur(14px);
      display:flex;align-items:center;justify-content:center;padding:18px;}
    .sheet{width:min(94vw,480px);border-radius:24px;padding:18px;background:rgba(20,25,31,.97);
      border:1px solid var(--cardBorder);box-shadow:0 24px 60px rgba(0,0,0,.55);}
    .sh-h{display:flex;align-items:center;margin-bottom:14px;}
    .sh-t{font-size:16px;font-weight:600;flex:1;}
    .x{width:32px;height:32px;border-radius:50%;border:none;background:var(--chip);color:inherit;cursor:pointer;}
    .f{margin-bottom:14px;}
    .f label{display:block;font-size:11.5px;color:var(--dim);margin-bottom:5px;}
    .f input{width:100%;box-sizing:border-box;padding:9px 11px;border-radius:10px;border:1px solid var(--cardBorder);
      background:rgba(0,0,0,.25);color:inherit;font:inherit;font-size:13px;}
    .hint{font-size:11px;color:var(--dim);margin-top:5px;}
    /* the same segmented selector the alarm card uses: one track, the indicator slides */
    .seg{position:relative;display:flex;align-items:center;width:100%;height:44px;
      border-radius:15px;background:rgba(0,0,0,.22);border:1px solid var(--cardBorder);}
    /* The offset is a plain percentage worked out when the card renders. A compound calc mixing
       a custom property with a percentage was being dropped, leaving the indicator parked. */
    .seg-ind{position:absolute;top:4px;bottom:4px;left:var(--ind,0%);margin:0 4px;
      width:calc(100% / var(--n) - 8px);
      border-radius:11px;background:#fff;transition:left .3s cubic-bezier(.2,.7,.3,1);}
    .seg-b{position:relative;z-index:1;flex:1;min-width:0;height:100%;border:none;background:none;
      color:var(--dim);cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:500;
      transition:color .2s;}
    .seg-b.on{color:#0e1620;font-weight:600;}
    .wps{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px;}
    .wp{position:relative;height:54px;border-radius:12px;cursor:pointer;padding:0;overflow:hidden;
      border:1px solid var(--cardBorder);background:var(--sw) center/cover no-repeat;
      color:#fff;font:inherit;font-size:11px;}
    .wp span{position:absolute;left:0;right:0;bottom:0;padding:3px 0 4px;
      background:linear-gradient(transparent,rgba(0,0,0,.55));}
    .wp.on{border-color:#fff;box-shadow:0 0 0 1px #fff inset;}
    .mini{padding:9px 14px;border-radius:11px;border:1px solid var(--cardBorder);background:var(--chip);
      color:inherit;font:inherit;font-size:12.5px;cursor:pointer;}
    .mini.danger{color:#ff8a80;} .mini.wide{width:100%;}
    code{font-size:11px;background:rgba(255,255,255,.08);padding:1px 5px;border-radius:4px;}
  `;
}

if (!customElements.get("casa-panel")) customElements.define("casa-panel", CasaPanel);

// Show up in Lovelace's own card picker, so it can be added without knowing the type by heart.
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "casa-panel"))
  window.customCards.push({
    type: "casa-panel",
    name: "Casa Dashboard",
    description: "The whole dashboard as a card — put it in a panel view to use it as your default.",
    preview: false,
  });
