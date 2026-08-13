/**
 * Casa Dashboard — the panel shell.
 *
 * Deliberately small: it loads the layout from the integration, paints the background, offers the
 * pencil and the settings sheet, and hands everything else to <casa-view>. There is no knowledge of
 * any particular home in here — no entities, no rooms, no personal anything. Whatever a user sees
 * comes from their saved layout.
 */
import { LitElement, html, css } from "./lit-all.min.js";
import "./casa-view.js";
import { starterLayout } from "./casa-layout.js";

const WS_GET = "casa_dashboard/get";
const WS_SET = "casa_dashboard/set";

const DEFAULT_SETTINGS = {
  wallpaper: "",                     // image url; blank = the built-in gradient
  title: "Casa",
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
  };

  constructor() {
    super();
    this._settings = { ...DEFAULT_SETTINGS };
    this._edit = false;
    this._loaded = false;
  }

  updated(ch) { if (ch.has("hass")) this._load(); }

  async _load() {
    if (this._loading || this._loaded || !this.hass?.connection) return;
    this._loading = true;
    try {
      const cfg = await this.hass.connection.sendMessagePromise({ type: WS_GET });
      this._layout = cfg?.layout || starterLayout();
      this._settings = { ...DEFAULT_SETTINGS, ...(cfg?.settings || {}) };
    } catch (e) {
      // integration missing or not ready — still usable, just can't persist
      this._layout = starterLayout();
      this._err = true;
    }
    this._loaded = true;
  }

  /** Persist, coalesced so a drag doesn't write once per frame. */
  _save() {
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      this.hass?.connection?.sendMessagePromise({
        type: WS_SET, config: { layout: this._layout, settings: this._settings },
      }).catch(() => {});
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
        <div class="f"><label>Wallpaper URL</label>
          <input placeholder="/local/my-wallpaper.jpg — blank for the default"
            .value=${this._settings.wallpaper || ""} @change=${(e) => this._setSetting("wallpaper", e.target.value)}>
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
    return html`
      <div class="shell" style=${wp ? `background-image:url('${wp}')` : ""}>
        <header class="bar">
          <div class="title">${this._settings.title || "Casa"}</div>
          <div class="grow"></div>
          ${this._err ? html`<span class="warn" title="The Casa Dashboard integration isn't responding — changes won't be saved">unsaved</span>` : ""}
          <button class="round ${this._edit ? "on" : ""}" title=${this._edit ? "Done" : "Edit dashboard"}
            @click=${() => (this._edit = !this._edit)}>
            <ha-icon icon=${this._edit ? "mdi:check" : "mdi:pencil-outline"}></ha-icon></button>
          <button class="round" title="Settings" @click=${() => (this._showSettings = true)}>
            <ha-icon icon="mdi:cog-outline"></ha-icon></button>
        </header>

        <casa-view .hass=${this.hass} .layout=${this._layout} ?editing=${this._edit} ?narrow=${this.narrow}
          @layout-changed=${(e) => { this._layout = e.detail; this._save(); }}></casa-view>

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
    .shell{min-height:100%;box-sizing:border-box;padding:16px 22px 40px;overflow-y:auto;
      background:#0b1014 radial-gradient(120% 90% at 70% 10%,#26323d,#161d24 45%,#0b1014) center/cover no-repeat fixed;}
    .loading{padding:40px;color:var(--dim);font-size:14px;}
    .bar{display:flex;align-items:center;gap:10px;margin-bottom:16px;}
    .title{font-size:20px;font-weight:600;}
    .grow{flex:1;}
    .warn{font-size:11.5px;color:#ffcf8a;background:rgba(255,180,80,.14);padding:5px 10px;border-radius:9px;}
    .round{width:44px;height:44px;border-radius:50%;flex:none;cursor:pointer;
      border:1px solid var(--cardBorder);background:var(--chip);color:var(--dim);
      display:flex;align-items:center;justify-content:center;}
    .round.on{background:#fff;color:#0e1620;border-color:transparent;}
    .round ha-icon{--mdc-icon-size:21px;}
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
    .mini{padding:9px 14px;border-radius:11px;border:1px solid var(--cardBorder);background:var(--chip);
      color:inherit;font:inherit;font-size:12.5px;cursor:pointer;}
    .mini.danger{color:#ff8a80;} .mini.wide{width:100%;}
    code{font-size:11px;background:rgba(255,255,255,.08);padding:1px 5px;border-radius:4px;}
  `;
}

if (!customElements.get("casa-panel")) customElements.define("casa-panel", CasaPanel);
