/**
 * Casa Cards — the real card designs, ported from the bedroom panel.
 *
 * Same glass, same shadow, same controls, so a generated dashboard is indistinguishable from a
 * hand-built one. Which design a card gets follows its type and its entity's domain:
 *
 *   light               -> the light card, with the brightness fill behind it
 *   media_player        -> speaker card, or the TV card when it looks like a TV
 *   cover               -> shade card
 *   scene / script      -> scene button
 *   type "full"         -> the Now Playing hero
 *   anything else       -> a plain small/compact card
 *
 * `ctx` is the host view: { hass, call(domain,service,data), more(entity), openPopup(type,entity) }.
 */
// The panel is loaded with a ?v=<integration version> query. Propagating that query to every
// import means a HACS update can never leave a stale module cached in someone's browser.
const V = new URL(import.meta.url).search;
const { html } = await import(`./lit-all.min.js${V}`);
const { COL_W, GRID_GAP, GRID_ROW, tileRows } = await import(`./casa-layout.js${V}`);

/** Three rows or more: the name, the reading large in the middle, controls underneath. */
/**
 * Enough room for the big centred reading: more than two rows. A tile is square, so its height is
 * measured from its width — even a single-column tile is about three rows tall.
 */
const isTall = (c) => (c.type === "tile" ? tileRows(COL_W, c.w || 1) : (c.h || 2)) >= 3;

const tallBody = (icon, name, state, value, label, controls, onMore, text = false) => html`
  <div class="cc-head rclick" @click=${onMore}>
    <ha-icon class="spk-ic" icon=${icon}></ha-icon>
    <div class="hl-meta">
      <div class="cc-title">${name}</div>
      ${state ? html`<div class="hl-sub">${state}</div>` : ""}
    </div>
  </div>
  <div class="cc-mid">
    <div class="cc-cur ${text ? "text" : ""}">${value}</div>
    <div class="cc-now">${label}</div>
  </div>
  ${controls}`;

/** A one-row card is a reading only — every taller card, and every tile, keeps its controls. */
const readingOnly = (c) => (c.h || 2) <= 1 && c.type !== "tile";

/** States are shown to people, so they read as words: "open" -> "Open", "not_home" -> "Not home". */
export const cap = (t) => {
  const v = String(t ?? "").replace(/_/g, " ");
  return v ? v[0].toUpperCase() + v.slice(1) : "";
};

/**
 * What a thermostat is actually doing. `hvac_action` is the honest answer when the integration
 * reports it; otherwise fall back to the mode. Comparing target against current is not a
 * substitute — a unit set to Cool at 21° in a 22.8° room is still cooling, and would otherwise
 * be drawn as idle.
 */
const hvacOf = (s) => {
  const act = s?.attributes?.hvac_action, mode = s?.state;
  if (act) return { heating: act === "heating", cooling: act === "cooling" };
  return { heating: mode === "heat", cooling: mode === "cool" };
};

const st = (ctx, e) => ctx.hass?.states?.[e];

/** What an entity's icon should be when nobody has configured one. */
const DEFAULT_ICON = {
  lock: (x) => ({ locked: "mdi:lock", unlocked: "mdi:lock-open-variant", jammed: "mdi:lock-alert",
    locking: "mdi:lock-clock", unlocking: "mdi:lock-clock" }[x] || "mdi:lock"),
  fan: () => "mdi:fan",
  vacuum: (x) => ({ cleaning: "mdi:robot-vacuum", returning: "mdi:robot-vacuum-alert",
    error: "mdi:robot-vacuum-alert" }[x] || "mdi:robot-vacuum"),
  alarm_control_panel: (x) => (x === "disarmed" ? "mdi:shield-off-outline"
    : x === "triggered" ? "mdi:shield-alert" : "mdi:shield-check"),
  binary_sensor: () => "mdi:radiobox-blank",
  switch: () => "mdi:toggle-switch-variant",
  input_boolean: () => "mdi:toggle-switch-variant",
  sensor: () => "mdi:gauge",
  person: () => "mdi:account",
  camera: () => "mdi:video",
  number: () => "mdi:ray-vertex",
  select: () => "mdi:format-list-bulleted",
  button: () => "mdi:gesture-tap-button",
  calendar: () => "mdi:calendar-month",
};

/**
 * The icon a domain wears at rest. A picker offers entities before it has any interest in their
 * state, and kept its own shorter list that quietly missed whole domains — alarms among them.
 */
export const domainIcon = (id) => {
  const f = DEFAULT_ICON[String(id || "").split(".")[0]];
  return typeof f === "function" ? f("") : f || "";
};

/**
 * The icon for an entity. Home Assistant does not put default icons in the state — only one that
 * has been configured explicitly appears there — so the frontend works the rest out from the
 * domain, the device class and the current state. Use its own element when it is available, which
 * gets device classes and state changes right for free, and fall back to the table above when it
 * is not (the design harness has no Home Assistant).
 */
export const stateIcon = (ctx, e, cls, explicit, fallback) => {
  const s = st(ctx, e);
  const icon = explicit || s?.attributes?.icon;
  if (icon) return html`<ha-icon class=${cls} icon=${icon}></ha-icon>`;
  if (s && customElements.get("ha-state-icon"))
    return html`<ha-state-icon class=${cls} .hass=${ctx.hass} .stateObj=${s}></ha-state-icon>`;
  const d = String(e || "").split(".")[0];
  return html`<ha-icon class=${cls} icon=${DEFAULT_ICON[d]?.(s?.state) || fallback}></ha-icon>`;
};
const attr = (ctx, e, a) => st(ctx, e)?.attributes?.[a];

/** One decimal, and no trailing .0 — a temperature reads 20.4, a humidity 61, not 61.0. */
const round1 = (v) => String(Math.round(v * 10) / 10);

/** Degrees and percentages sit against the number; a word unit like kWh needs its space. */
const unitGap = (unit) => (/^[°%]/.test(unit || "") ? "" : " ");

/** How far the hover label is held off the ends of a trace, clear of the card's corner. */
const TIP_EDGE = 8;

/**
 * The reading under the pointer on a history trace. Written straight to the DOM rather than held
 * as state: a card that re-rendered on every mouse move would redraw its whole trace to move one
 * dot, and the marker is not something worth saving anyway.
 */
function hoverPoint(ev, pts, at, y, unit, span) {
  const plot = ev.currentTarget;
  const box = plot.getBoundingClientRect();
  if (!box.width || !pts.length) return;
  const f = (ev.clientX - box.left) / box.width;
  const i = Math.max(0, Math.min(pts.length - 1, Math.round(f * (pts.length - 1))));
  const p = pts[i];
  const when = new Date(p.ts);
  const stamp = span === "week"
    ? when.toLocaleDateString([], { weekday: "short" })
    : when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const [rule, dot, tip] = ["hst-rule", "hst-dot", "hst-tip"].map((k) => plot.querySelector(`.${k}`));
  if (!tip) return;
  const x = at(i);
  rule.style.left = `${x}%`;
  dot.style.left = `${x}%`;
  dot.style.top = `${y(p.val)}%`;
  tip.textContent = `${round1(p.val)}${unitGap(unit)}${unit} · ${stamp}`;
  plot.classList.add("hovering");
  // Placed after the text, so its measured width is the one being clamped — otherwise the label
  // hangs off the card at either end of the trace. Held a little short of the edge as well, so it
  // clears the card's rounded corner rather than sitting flush against it.
  const half = tip.offsetWidth / 2;
  const want = (x / 100) * box.width;
  const lo = half + TIP_EDGE, hi = box.width - half - TIP_EDGE;
  tip.style.left = `${lo > hi ? box.width / 2 : Math.max(lo, Math.min(hi, want))}px`;
}
const isOn = (ctx, e) => {
  const s = st(ctx, e);
  return !!s && !["off", "unavailable", "unknown"].includes(s.state);
};
const briPct = (ctx, e) => {
  const b = attr(ctx, e, "brightness");
  return b != null ? Math.max(1, Math.round(b / 2.55)) : 0;
};
const isActive = (ctx, e) => ["playing", "paused", "buffering"].includes(st(ctx, e)?.state);
const looksLikeTv = (ctx, e) =>
  attr(ctx, e, "device_class") === "tv" || /tv|television|chromecast|shield|roku/i.test(e);

const volNudge = (ctx, e, d) => {
  const cur = attr(ctx, e, "volume_level") ?? 0;
  ctx.call("media_player", "volume_set",
    { entity_id: e, volume_level: Math.max(0, Math.min(1, Math.round((cur + d) * 100) / 100)) });
};
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/* ------------------------------------------------------------------ light */
function lightCard(ctx, c) {
  const e = c.entity, on = isOn(ctx, e), pct = briPct(ctx, e);
  // Only a dimmable light gets the brightness row, and only when it has been given the height.
  const dimmable = (attr(ctx, e, "supported_color_modes") || []).some((m) => m !== "onoff");
  const dim = dimmable && !readingOnly(c);
  const step = (ev, d) => {
    ev.stopPropagation();
    ctx.call("light", "turn_on", { entity_id: e, brightness_step_pct: d });
  };
  return html`<div class="gcard hlight ${on ? "on" : ""} ${dim ? "tall" : ""}"
      @click=${() => ctx.call("light", "toggle", { entity_id: e })}>
    <div class="hl-fill" style="width:${on ? Math.max(pct, 6) : 0}%"></div>
    <button class="hl-gear" @click=${(ev) => { ev.stopPropagation(); ctx.more(e); }}><ha-icon icon="mdi:tune-variant"></ha-icon></button>
    <div class="hl-body">
      <ha-icon class="hl-ic" icon=${c.icon || attr(ctx, e, "icon") || "mdi:lightbulb"}></ha-icon>
      <div class="hl-meta">
        <div class="hl-name">${c.name || attr(ctx, e, "friendly_name") || e}</div>
        <div class="hl-sub">${on ? pct + "%" : "Off"}</div>
      </div>
    </div>
    ${dim ? html`<div class="spk-btns">
      <button @click=${(ev) => step(ev, -10)}><ha-icon icon="mdi:minus"></ha-icon></button>
      <div class="c2-tgt">${on ? pct + "%" : "Off"}</div>
      <button @click=${(ev) => step(ev, 10)}><ha-icon icon="mdi:plus"></ha-icon></button>
    </div>` : ""}
  </div>`;
}

/* ---------------------------------------------------------------- speaker */
function speakerCard(ctx, c) {
  const e = c.entity, muted = attr(ctx, e, "is_volume_muted");
  const v = attr(ctx, e, "volume_level");
  const vol = v != null ? Math.round(v * 100) : 0;
  const name = c.name || attr(ctx, e, "friendly_name") || "Speaker";
  const icon = muted ? "mdi:volume-off" : (c.icon || "mdi:speaker");
  const volBtns = html`<div class="spk-btns">
    <button @click=${() => volNudge(ctx, e, -0.01)}><ha-icon icon="mdi:minus"></ha-icon></button>
    <button class=${muted ? "act" : ""} @click=${() => ctx.call("media_player", "volume_mute", { entity_id: e, is_volume_muted: !muted })}>
      <ha-icon icon=${muted ? "mdi:volume-off" : "mdi:volume-mute"}></ha-icon></button>
    <button @click=${() => volNudge(ctx, e, 0.01)}><ha-icon icon="mdi:plus"></ha-icon></button>
  </div>`;
  if (isTall(c))
    return html`<div class="gcard spk-card ${isActive(ctx, e) ? "playing" : ""}">
      ${tallBody(icon, name, muted ? "Muted" : isActive(ctx, e) ? "Playing" : "Idle",
        muted ? "Muted" : vol + "%", "Volume", volBtns, () => ctx.more(e))}
    </div>`;
  return html`<div class="gcard spk-card ${isActive(ctx, e) ? "playing" : ""} ${readingOnly(c) ? "reading" : ""}">
    <div class="cmp-head rclick" @click=${() => ctx.more(e)}>
      <ha-icon class="spk-ic" icon=${icon}></ha-icon>
      <div class="hl-meta">
        <div class="hl-name">${name}</div>
        <div class="hl-sub">${muted ? "Muted" : isActive(ctx, e) ? "Playing" : "Idle"}</div>
      </div>
      <div class="cmp-val">${vol}%</div>
    </div>
    ${readingOnly(c) ? "" : volBtns}
  </div>`;
}

/* --------------------------------------------------------------------- TV */
function tvCard(ctx, c) {
  const e = c.entity, s = st(ctx, e), a = s?.attributes || {};
  const on = s && !["off", "unavailable", "unknown", "standby"].includes(s.state);
  const playing = on && s.state === "playing";
  const dur = a.media_duration;
  const seek = (d) => {
    if (!dur) return;
    let at = a.media_position || 0;
    if (playing && a.media_position_updated_at) at += (Date.now() - new Date(a.media_position_updated_at).getTime()) / 1000;
    ctx.call("media_player", "media_seek", { entity_id: e, seek_position: Math.max(0, Math.min(dur, at + d)) });
  };
  const tvName = c.name || attr(ctx, e, "friendly_name") || "TV";
  const transport = html`<div class="spk-btns">
    <button ?disabled=${!dur} @click=${() => seek(-10)}><ha-icon icon="mdi:rewind-10"></ha-icon></button>
    <button @click=${() => ctx.call("media_player", "media_play_pause", { entity_id: e })}>
      <ha-icon icon=${playing ? "mdi:pause" : "mdi:play"}></ha-icon></button>
    <button ?disabled=${!dur} @click=${() => seek(10)}><ha-icon icon="mdi:fast-forward-10"></ha-icon></button>
  </div>`;
  if (isTall(c))
    return html`<div class="gcard media-tile ${on ? "on" : ""}">
      ${tallBody(c.icon || "mdi:television", tvName, on ? "On" : "Off",
        on ? (a.media_title || a.app_name || a.source || "On") : "Off",
        on ? (a.media_title ? (a.app_name || a.source || "") : "") : "",
        transport, () => ctx.more(e), true)}
    </div>`;
  return html`<div class="gcard media-tile ${on ? "on" : ""} ${readingOnly(c) ? "reading" : ""}">
    <div class="cmp-head rclick" @click=${() => ctx.more(e)}>
      <ha-icon class="spk-ic" icon=${c.icon || "mdi:television"}></ha-icon>
      <div class="hl-meta">
        <div class="hl-name">${c.name || attr(ctx, e, "friendly_name") || "TV"}</div>
        <div class="hl-sub">${on ? [a.app_name || a.source, a.media_title].filter(Boolean).join(" \u00b7 ") || "On" : "Off"}</div>
      </div>
    </div>
    ${readingOnly(c) ? "" : html`<div class="spk-btns">
      <button ?disabled=${!dur} @click=${() => seek(-10)}><ha-icon icon="mdi:rewind-10"></ha-icon></button>
      <button @click=${() => ctx.call("media_player", "media_play_pause", { entity_id: e })}>
        <ha-icon icon=${playing ? "mdi:pause" : "mdi:play"}></ha-icon></button>
      <button ?disabled=${!dur} @click=${() => seek(10)}><ha-icon icon="mdi:fast-forward-10"></ha-icon></button>
    </div>`}
  </div>`;
}

/* ------------------------------------------------------------------ shade */
function shadeCard(ctx, c) {
  const e = c.entity, s = st(ctx, e);
  if (!s) return html`<div class="gcard shade2"></div>`;
  const pos = s.attributes.current_position, open = s.state === "open";
  const closed = s.state === "closed" || pos === 0;
  const name = c.name || attr(ctx, e, "friendly_name") || "Shade";
  const btns = html`<div class="spk-btns">
    <button @click=${() => ctx.call("cover", "open_cover", { entity_id: e })}><ha-icon icon="mdi:chevron-up"></ha-icon></button>
    <button @click=${() => ctx.call("cover", "stop_cover", { entity_id: e })}><ha-icon icon="mdi:stop"></ha-icon></button>
    <button @click=${() => ctx.call("cover", "close_cover", { entity_id: e })}><ha-icon icon="mdi:chevron-down"></ha-icon></button>
  </div>`;
  if (isTall(c))
    return html`<div class="gcard shade2 ${closed ? "on" : ""}">
      ${tallBody(open ? "mdi:blinds-open" : "mdi:blinds", name,
        cap(s.state),
        pos != null ? pos + "%" : cap(s.state),
        pos != null ? "Position" : "", btns, () => ctx.more(e))}
    </div>`;
  return html`<div class="gcard shade2 ${closed ? "on" : ""} ${readingOnly(c) ? "reading" : ""}">
    <div class="cmp-head rclick" @click=${() => ctx.more(e)}>
      <ha-icon class="spk-ic" icon=${open ? "mdi:blinds-open" : "mdi:blinds"}></ha-icon>
      <div class="hl-meta">
        <div class="hl-name">${c.name || attr(ctx, e, "friendly_name") || "Shade"}</div>
        <div class="hl-sub">${cap(s.state)}</div>
      </div>
      ${pos != null ? html`<div class="cmp-val">${pos}%</div>` : ""}
    </div>
    ${readingOnly(c) ? "" : html`<div class="spk-btns">
      <button @click=${() => ctx.call("cover", "open_cover", { entity_id: e })}><ha-icon icon="mdi:chevron-up"></ha-icon></button>
      <button @click=${() => ctx.call("cover", "stop_cover", { entity_id: e })}><ha-icon icon="mdi:stop"></ha-icon></button>
      <button @click=${() => ctx.call("cover", "close_cover", { entity_id: e })}><ha-icon icon="mdi:chevron-down"></ha-icon></button>
    </div>`}
  </div>`;
}

/* ------------------------------------------------------------------ scene */
function sceneCard(ctx, c) {
  const e = c.entity, d = String(e).split(".")[0];
  const domain = d === "scene" ? "scene" : d === "automation" ? "automation" : "script";
  const kind = d === "scene" ? "Scene" : d === "automation" ? "Automation" : "Script";
  // Reads like a light card: icon, name, what it is. Running it is the whole card, so there is
  // nothing to press inside it.
  return html`<button class="gcard scene2 reading"
      @click=${() => ctx.call(domain, "turn_on", { entity_id: e })}>
    <div class="cmp-head">
      <ha-icon class="spk-ic" icon=${c.icon || attr(ctx, e, "icon") || "mdi:creation"}></ha-icon>
      <div class="hl-meta">
        <div class="hl-name">${c.name || attr(ctx, e, "friendly_name") || e}</div>
        <div class="hl-sub">${kind}</div>
      </div>
    </div>
  </button>`;
}

/* ------------------------------------------------------------- media widget */
/**
 * Full is the Now Playing hero from the app. Every other size is laid out like a phone's lock
 * screen player: the artwork sits beside the name, title and artist, with the progress bar and
 * then the transport stacked underneath it, each spanning the card.
 * A Full card narrowed to a phone's two columns has no room for the hero and uses this instead.
 */
function mediaWidget(ctx, c) {
  const e = c.entity, s = st(ctx, e);
  if (!s) return html`<div class="gcard wdg col"><div class="hl-sub">Pick a media player</div></div>`;
  if ((c.full || c.h >= 4) && c.w >= 3) return fullCard(ctx, c);   // c.h for cards saved before the flag

  const a = s.attributes || {};
  const playing = s.state === "playing";
  const art = a.entity_picture;
  const dur = a.media_duration || 0;
  let el = a.media_position || 0;
  if (playing && a.media_position_updated_at) el += (Date.now() - new Date(a.media_position_updated_at).getTime()) / 1000;
  el = dur ? Math.min(el, dur) : el;
  const pct = dur ? (el / dur) * 100 : 0;
  const call = (svc) => (ev) => { ev.stopPropagation(); ctx.call("media_player", svc, { entity_id: e }); };
  const name = c.name || a.friendly_name || e;
  const times = c.h >= 3;                      // only a three row card has room to label the bar
  return html`<div class="gcard mw ${times ? "tall" : ""}">
    <div class="mw-head rclick" @click=${() => ctx.more(e)}>
      <div class="mw-art" style=${art ? `background-image:url('${art}')` : ""}>
        ${art ? "" : stateIcon(ctx, e, "mw-ic", c.icon, "mdi:music")}</div>
      <div class="mw-txt">
        <div class="kick">On ${name}</div>
        <div class="mw-t">${a.media_title || (playing ? "Playing" : cap(s.state))}</div>
        <div class="mw-a">${a.media_artist || a.app_name || ""}</div>
      </div>
    </div>
    ${dur ? html`<div class="mw-bar">
      <div class="mw-prog"><div class="mw-fill" style="width:${pct}%"></div></div>
      ${times ? html`<div class="mw-times"><span>${fmt(el)}</span><span>${fmt(dur)}</span></div>` : ""}
    </div>` : ""}
    <div class="mw-ctrls">
      <ha-icon class="mw-sk" icon="mdi:skip-previous" @click=${call("media_previous_track")}></ha-icon>
      <ha-icon class="mw-play" icon=${playing ? "mdi:pause-circle" : "mdi:play-circle"} @click=${call("media_play_pause")}></ha-icon>
      <ha-icon class="mw-sk" icon="mdi:skip-next" @click=${call("media_next_track")}></ha-icon>
    </div>
  </div>`;
}

/* -------------------------------------------------------- full media hero */
function fullCard(ctx, c) {
  const e = c.entity, s = st(ctx, e), a = s?.attributes || {};
  const playing = s?.state === "playing";
  const art = a.entity_picture;
  const dur = a.media_duration || 0;
  let el = a.media_position || 0;
  if (playing && a.media_position_updated_at) el += (Date.now() - new Date(a.media_position_updated_at).getTime()) / 1000;
  el = dur ? Math.min(el, dur) : el;
  return html`<div class="full">
    <div class="full-art" style=${art ? `background-image:url('${art}')` : ""}>
      ${art ? "" : html`<ha-icon icon="mdi:music"></ha-icon>`}</div>
    <div class="full-side">
      <div class="np-kick">NOW PLAYING</div>
      <div class="full-title">${a.media_title || (playing ? "Playing" : "Nothing playing")}</div>
      <div class="full-artist">${a.media_artist || a.app_name || ""}</div>
      ${dur ? html`<div class="full-prog">
        <div class="np-track"><div class="np-fill" style="width:${(el / dur) * 100}%"></div></div>
        <div class="np-times"><span>${fmt(el)}</span><span>${fmt(dur)}</span></div></div>` : ""}
      <div class="full-ctrls">
        <ha-icon class="np-ic" icon="mdi:skip-previous" @click=${() => ctx.call("media_player", "media_previous_track", { entity_id: e })}></ha-icon>
        <ha-icon class="np-play" icon=${playing ? "mdi:pause-circle" : "mdi:play-circle"}
          @click=${() => ctx.call("media_player", "media_play_pause", { entity_id: e })}></ha-icon>
        <ha-icon class="np-ic" icon="mdi:skip-next" @click=${() => ctx.call("media_player", "media_next_track", { entity_id: e })}></ha-icon>
      </div>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- climate */
function climateCard(ctx, c) {
  const e = c.entity, s = st(ctx, e);
  if (!s) return html`<div class="gcard clim-card"></div>`;
  const cur = s.attributes.current_temperature, tgt = s.attributes.temperature, mode = s.state;
  const { heating, cooling } = hvacOf(s);
  const setT = (t) => ctx.call("climate", "set_temperature", { entity_id: e, temperature: Math.round(t * 2) / 2 });
  return html`<div class="gcard clim-card ${mode !== "off" ? "on" : ""} ${heating ? "heat" : cooling ? "cool" : ""}">
    <div class="cc-head rclick" @click=${() => ctx.more(e)}>
      <ha-icon class="spk-ic" icon=${heating ? "mdi:fire" : cooling ? "mdi:snowflake" : "mdi:thermostat"}></ha-icon>
      <div class="hl-meta">
        <div class="cc-title">${c.name || attr(ctx, e, "friendly_name") || "Climate"}</div>
        <div class="hl-sub">${heating ? "Heating" : cooling ? "Cooling"
          : cap(mode)}</div>
      </div>
    </div>
    <div class="cc-mid">
      <div class="cc-cur">${cur != null ? cur + "°" : "–"}</div>
      <div class="cc-now">Current temperature</div>
    </div>
    <div class="cc-stepper">
      <button @click=${() => setT((tgt ?? 20) - 0.5)}><ha-icon icon="mdi:minus"></ha-icon></button>
      <div class="cc-tgt"><div class="cc-tgt-v">${tgt != null ? tgt + "°" : "–"}</div><div class="cc-tgt-l">Target</div></div>
      <button @click=${() => setT((tgt ?? 20) + 0.5)}><ha-icon icon="mdi:plus"></ha-icon></button>
    </div>
  </div>`;
}

/**
 * Climate at two rows. The full card wants three — reading, label, stepper — so at two it becomes
 * the shade card's shape instead of losing something: name, temperature, status, controls.
 */
function climateCompact(ctx, c) {
  const e = c.entity, s = st(ctx, e);
  if (!s) return html`<div class="gcard clim2"></div>`;
  const cur = s.attributes.current_temperature, tgt = s.attributes.temperature, mode = s.state;
  const { heating, cooling } = hvacOf(s);
  const setT = (t) => ctx.call("climate", "set_temperature", { entity_id: e, temperature: Math.round(t * 2) / 2 });
  const status = heating ? "Heating" : cooling ? "Cooling"
    : cap(mode);
  return html`<div class="gcard clim2 ${mode !== "off" ? "on" : ""} ${heating ? "heat" : cooling ? "cool" : ""} ${readingOnly(c) ? "reading" : ""}">
    <div class="cmp-head rclick" @click=${() => ctx.more(e)}>
      <ha-icon class="spk-ic" icon=${heating ? "mdi:fire" : cooling ? "mdi:snowflake" : "mdi:thermostat"}></ha-icon>
      <div class="hl-meta">
        <div class="hl-name">${c.name || attr(ctx, e, "friendly_name") || "Climate"}</div>
        <div class="hl-sub">${status}</div>
      </div>
      <div class="cmp-val">${cur != null ? cur + "\u00b0" : "\u2013"}</div>
    </div>
    ${readingOnly(c) ? "" : html`<div class="spk-btns">
      <button @click=${() => setT((tgt ?? 20) - 0.5)}><ha-icon icon="mdi:minus"></ha-icon></button>
      <div class="c2-tgt">${tgt != null ? tgt + "\u00b0" : "\u2013"}</div>
      <button @click=${() => setT((tgt ?? 20) + 0.5)}><ha-icon icon="mdi:plus"></ha-icon></button>
    </div>`}
  </div>`;
}

/* ------------------------------------------------------------------- lock */
function lockCard(ctx, c) {
  const e = c.entity, s = st(ctx, e);
  if (!s) return html`<div class="gcard lock2"></div>`;
  const locked = s.state === "locked", jammed = s.state === "jammed";
  // Home Assistant reports the journey as well as the destination: locking, unlocking, opening.
  const locking = s.state === "locking";
  const unlocking = ["unlocking", "opening"].includes(s.state);
  const busy = locking || unlocking;
  const name = c.name || attr(ctx, e, "friendly_name") || "Lock";
  const icon = jammed ? "mdi:lock-alert" : busy ? "mdi:lock-clock" : locked ? "mdi:lock" : "mdi:lock-open-variant";
  // Two buttons, no middle one: whichever state the lock is already in is the one you cannot press.
  // While the lock is moving, the button you pressed flashes — the same signal the alarm gives
  // while it arms, so a slow lock does not look like a tap that did nothing.
  const btns = html`<div class="spk-btns">
    <button class=${locking ? "pulse" : ""} ?disabled=${locked || busy}
      @click=${() => ctx.call("lock", "lock", { entity_id: e })}>
      <ha-icon icon="mdi:lock"></ha-icon></button>
    <button class=${unlocking ? "pulse" : ""} ?disabled=${(!locked && !jammed) || busy}
      @click=${() => ctx.call("lock", "unlock", { entity_id: e })}>
      <ha-icon icon="mdi:lock-open-variant"></ha-icon></button>
  </div>`;
  if (isTall(c))
    return html`<div class="gcard lock2 ${locked ? "" : "on"} ${jammed ? "warn" : ""}">
      ${tallBody(icon, name, "", cap(s.state), "Door", btns, () => ctx.more(e), true)}
    </div>`;
  return html`<div class="gcard lock2 ${locked ? "" : "on"} ${jammed ? "warn" : ""} ${readingOnly(c) ? "reading" : ""}">
    <div class="cmp-head rclick" @click=${() => ctx.more(e)}>
      <ha-icon class="spk-ic" icon=${icon}></ha-icon>
      <div class="hl-meta"><div class="hl-name">${name}</div><div class="hl-sub">${cap(s.state)}</div></div>
    </div>
    ${readingOnly(c) ? "" : btns}
  </div>`;
}

/* -------------------------------------------------------------------- fan */
function fanCard(ctx, c) {
  const e = c.entity, s = st(ctx, e);
  if (!s) return html`<div class="gcard fan2"></div>`;
  const on = s.state === "on";
  const pct = s.attributes.percentage;
  const step = s.attributes.percentage_step || 100 / (s.attributes.speed_count || 4);
  const name = c.name || attr(ctx, e, "friendly_name") || "Fan";
  const set = (v) => ctx.call("fan", "set_percentage",
    { entity_id: e, percentage: Math.max(0, Math.min(100, Math.round(v))) });
  // Speed moves by the fan's own step, so a four-speed fan does not get 1% nudges.
  // Power in the middle rather than a repeated reading: the percentage is already on the right at
  // two rows and is the reading itself when tall. A fan with no speed control still gets power.
  const btns = html`<div class="spk-btns">
    ${pct == null ? "" : html`<button @click=${() => set((pct || 0) - step)}>
      <ha-icon icon="mdi:fan-minus"></ha-icon></button>`}
    <button class="pow ${on ? "on" : ""}" @click=${() => ctx.call("fan", "toggle", { entity_id: e })}>
      <ha-icon icon="mdi:power"></ha-icon></button>
    ${pct == null ? "" : html`<button @click=${() => set((pct || 0) + step)}>
      <ha-icon icon="mdi:fan-plus"></ha-icon></button>`}
  </div>`;
  if (isTall(c))
    return html`<div class="gcard fan2 ${on ? "on" : ""}">
      ${tallBody("mdi:fan", name, cap(s.state), on && pct != null ? Math.round(pct) + "%" : cap(s.state),
        pct != null ? "Speed" : "", btns, () => ctx.more(e))}
    </div>`;
  return html`<div class="gcard fan2 ${on ? "on" : ""} ${readingOnly(c) ? "reading" : ""}">
    <div class="cmp-head rclick" @click=${() => ctx.more(e)}>
      <ha-icon class="spk-ic" icon="mdi:fan"></ha-icon>
      <div class="hl-meta"><div class="hl-name">${name}</div><div class="hl-sub">${cap(s.state)}</div></div>
      ${on && pct != null ? html`<div class="cmp-val">${Math.round(pct)}%</div>` : ""}
    </div>
    ${readingOnly(c) ? "" : btns}
  </div>`;
}

/* ----------------------------------------------------------------- vacuum */
function vacuumCard(ctx, c) {
  const e = c.entity, s = st(ctx, e);
  if (!s) return html`<div class="gcard vac2"></div>`;
  const docked = ["docked", "off", "unavailable", "unknown"].includes(s.state);
  const batt = s.attributes.battery_level;
  const name = c.name || attr(ctx, e, "friendly_name") || "Vacuum";
  // Whichever action the vacuum is currently carrying out is the one lit, so the card says what it
  // is doing as well as offering what it could do.
  const acts = [
    { key: "start",          icon: "mdi:play",                states: ["cleaning"] },
    { key: "pause",          icon: "mdi:pause",               states: ["paused"] },
    { key: "stop",           icon: "mdi:stop",                states: [] },   // stopped is not an activity
    { key: "return_to_base", icon: "mdi:home-import-outline", states: ["returning"] },
  ];
  const btns = html`<div class="spk-btns">
    ${acts.map((a) => html`<button class=${a.states.includes(s.state) ? "on" : ""}
      @click=${() => ctx.call("vacuum", a.key, { entity_id: e })}>
      <ha-icon icon=${a.icon}></ha-icon></button>`)}
  </div>`;
  if (isTall(c))
    return html`<div class="gcard vac2 ${docked ? "" : "on"}">
      ${tallBody("mdi:robot-vacuum", name, cap(s.state), batt != null ? batt + "%" : cap(s.state),
        batt != null ? "Battery" : "", btns, () => ctx.more(e))}
    </div>`;
  return html`<div class="gcard vac2 ${docked ? "" : "on"} ${readingOnly(c) ? "reading" : ""}">
    <div class="cmp-head rclick" @click=${() => ctx.more(e)}>
      <ha-icon class="spk-ic" icon="mdi:robot-vacuum"></ha-icon>
      <div class="hl-meta"><div class="hl-name">${name}</div><div class="hl-sub">${cap(s.state)}</div></div>
      ${batt != null ? html`<div class="cmp-val">${batt}%</div>` : ""}
    </div>
    ${readingOnly(c) ? "" : btns}
  </div>`;
}

/* ------------------------------------------------------------------ alarm */
/** The mode last asked for, per panel: Home Assistant does not say what a panel is arming to. */
const ARM_TARGET = new Map();

const ALARM_MODES = [
  { key: "disarm",       bit: 0,  label: "Off",      icon: "mdi:shield-off-outline", state: "disarmed" },
  { key: "arm_home",     bit: 1,  label: "Home",     icon: "mdi:shield-home",        state: "armed_home" },
  { key: "arm_away",     bit: 2,  label: "Away",     icon: "mdi:shield-lock",        state: "armed_away" },
  { key: "arm_night",    bit: 4,  label: "Night",    icon: "mdi:shield-moon",        state: "armed_night" },
  { key: "arm_vacation", bit: 32, label: "Vacation", icon: "mdi:shield-airplane",    state: "armed_vacation" },
];

function alarmCard(ctx, c) {
  const e = c.entity, s = st(ctx, e);
  if (!s) return html`<div class="gcard alarm2"></div>`;
  const armed = s.state !== "disarmed";
  const triggered = s.state === "triggered";
  const pending = ["arming", "pending"].includes(s.state);
  const name = c.name || attr(ctx, e, "friendly_name") || "Alarm";
  const feat = s.attributes.supported_features || 0;
  const icon = triggered ? "mdi:shield-alert" : pending ? "mdi:shield-sync"
    : armed ? "mdi:shield-check" : "mdi:shield-off-outline";
  // Only the modes this panel says it supports; disarming is always possible.
  const modes = ALARM_MODES.filter((m) => !m.bit || (feat & m.bit));
  // One control rather than a row of buttons: the indicator slides to whichever mode is set.
  // Segments are equal width, so its position is a fraction of the track and needs no measuring.
  const at = modes.findIndex((m) => m.state === s.state);
  if (at >= 0) ARM_TARGET.delete(e);                     // settled — nothing pending to remember
  // While arming, the panel reports neither the old mode nor the new one, so without this the
  // indicator would vanish the instant you pressed and you could not tell the tap had registered.
  const want = pending ? ARM_TARGET.get(e) : undefined;
  const idx = at >= 0 ? at : want;
  const btns = html`<div class="seg ${triggered ? "warn" : armed || pending ? "armed" : ""}"
      style="--n:${modes.length};--ind:${((idx ?? 0) / modes.length) * 100}%">
    ${idx == null ? "" : html`<div class="seg-ind ${pending ? "pulse" : ""}"></div>`}
    ${modes.map((m, i) => html`<button class="seg-b ${idx === i ? "on" : ""}" title=${m.label}
      @click=${() => { ARM_TARGET.set(e, i); ctx.call("alarm_control_panel", `alarm_${m.key}`, { entity_id: e }); }}>
      <ha-icon icon=${m.icon}></ha-icon></button>`)}
  </div>`;
  if (isTall(c))
    return html`<div class="gcard alarm2 ${armed ? "on" : ""} ${triggered ? "warn" : ""}">
      ${tallBody(icon, name, "", cap(s.state), "Alarm", btns, () => ctx.more(e), true)}
    </div>`;
  return html`<div class="gcard alarm2 ${armed ? "on" : ""} ${triggered ? "warn" : ""} ${readingOnly(c) ? "reading" : ""}">
    <div class="cmp-head rclick" @click=${() => ctx.more(e)}>
      <ha-icon class="spk-ic" icon=${icon}></ha-icon>
      <div class="hl-meta"><div class="hl-name">${name}</div><div class="hl-sub">${cap(s.state)}</div></div>
    </div>
    ${readingOnly(c) ? "" : btns}
  </div>`;
}


/* ---------------------------------------------------------------- widgets */
const MODE_ICON = (m) => ({ off: "mdi:power", heat: "mdi:fire", cool: "mdi:snowflake",
  heat_cool: "mdi:sun-snowflake-variant", auto: "mdi:autorenew", dry: "mdi:water-percent",
  fan_only: "mdi:fan" }[m] || "mdi:thermostat");
const WICON = {
  "clear-night": "mdi:weather-night", sunny: "mdi:weather-sunny", partlycloudy: "mdi:weather-partly-cloudy",
  cloudy: "mdi:weather-cloudy", rainy: "mdi:weather-rainy", pouring: "mdi:weather-pouring",
  snowy: "mdi:weather-snowy", "snowy-rainy": "mdi:weather-snowy-rainy", fog: "mdi:weather-fog",
  hail: "mdi:weather-hail", lightning: "mdi:weather-lightning", "lightning-rainy": "mdi:weather-lightning-rainy",
  windy: "mdi:weather-windy", "windy-variant": "mdi:weather-windy-variant", exceptional: "mdi:alert-circle-outline",
};
/** Home Assistant's condition names are run together, so they need spelling out rather than splitting. */
export const WLABEL = {
  "clear-night": "Clear night", partlycloudy: "Partly cloudy", "snowy-rainy": "Sleet",
  "lightning-rainy": "Thunderstorms", "windy-variant": "Windy", pouring: "Heavy rain",
  exceptional: "Severe weather",
};
const GREETING = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

/** Cards that show the dashboard itself rather than an entity. */
/**
 * How many list rows a card this tall can actually show, and whether a "+N more" line is needed.
 * The card's chrome comes off first — padding, header, and the more-line itself, which costs a
 * row's worth of space and so has to be counted before deciding how many rows are left.
 */
const LIST_ROW = 19, LIST_GAP = 0;                 // a row and the space under it
const LIST_CHROME = 74;                            // 16 padding + 33 header + 9 gap, and 16 below
const LIST_MORE = 13;                              // the "+N more" line, and no gap of its own
function listFits(rows, total) {
  const height = rows * (GRID_ROW + GRID_GAP) - GRID_GAP;
  const room = (extra) =>
    Math.max(0, Math.floor((height - LIST_CHROME - extra + LIST_GAP) / (LIST_ROW + LIST_GAP)));
  const all = room(0);
  if (total <= all) return { fits: total, more: 0 };
  // The footer is only its own line height — it takes no gap and will sit against the last entry
  // on a card with no room to spare, which is cheaper than losing an entry to it.
  const fits = room(LIST_MORE);
  return { fits, more: total - fits };
}

/** Device classes where "on" means something is standing open. */
const OPEN_CLASSES = new Set(["door", "window", "garage_door", "opening"]);

/**
 * Everything in the house that wants looking at. The only widget that reports on entities nobody
 * chose to put on the dashboard — which is the point: a flat battery is exactly the thing you
 * never think to add a card for.
 */
function attentionItems(ctx, checks, level) {
  const states = ctx.hass?.states || {};
  const found = [];
  for (const id in states) {
    const s = states[id], a = s.attributes || {};
    const domain = id.split(".")[0];
    const name = a.friendly_name || id;
    if (checks.battery !== false && domain === "sensor" && a.device_class === "battery") {
      const pct = Number(s.state);
      if (Number.isFinite(pct) && pct <= level) {
        found.push({ id, name, icon: "mdi:battery-alert-variant-outline", note: `${Math.round(pct)}%`, rank: pct });
        continue;
      }
    }
    if (checks.open !== false && domain === "binary_sensor"
        && OPEN_CLASSES.has(a.device_class) && s.state === "on") {
      found.push({ id, name, icon: a.device_class === "window" ? "mdi:window-open" : "mdi:door-open",
        note: "Open", rank: 1000 });
      continue;
    }
    // `unknown` is the resting state of a scene or a script, so only `unavailable` counts as wrong
    if (checks.offline !== false && s.state === "unavailable")
      found.push({ id, name, icon: "mdi:lan-disconnect", note: "Unavailable", rank: 2000 });
  }
  return found.sort((x, y) => x.rank - y.rank || x.name.localeCompare(y.name));
}

function widgetCard(ctx, c) {
  const now = new Date();
  switch (c.widget) {
    case "media":
      return mediaWidget(ctx, c);
    case "clock":
      return html`<div class="gcard wdg"><div class="wdg-big">${
        now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(c.hour12 == null ? {} : { hour12: !!c.hour12 }) })}</div></div>`;
    case "date":
      return html`<div class="gcard wdg"><div class="wdg-mid">${
        now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div></div>`;
    case "greeting":
      return html`<div class="gcard wdg"><div class="wdg-mid">${c.name || GREETING()}</div></div>`;
    case "spacer":
      return html`<div class="wdg-gap"></div>`;
    case "people": {
      const people = Object.keys(ctx.hass?.states || {}).filter((x) => x.startsWith("person."));
      const home = people.filter((x) => st(ctx, x)?.state === "home").length;
      return html`<div class="gcard wdg row" @click=${() => people[0] && ctx.more(people[0])}>
        <ha-icon class="spk-ic" icon="mdi:account-group"></ha-icon>
        <div class="hl-meta"><div class="hl-name">${home ? `${home} home` : "Away"}</div>
          <div class="hl-sub">${people.length} ${people.length === 1 ? "person" : "people"}</div></div>
      </div>`;
    }
    case "weather": {
      const s = st(ctx, c.entity);
      if (!s) return html`<div class="gcard wdg col"><div class="hl-sub">Pick a weather entity</div></div>`;
      const a = s.attributes;
      const temp = a.temperature != null ? Math.round(a.temperature) : null;
      const cond = WLABEL[s.state] || cap(String(s.state).replace(/[-_]/g, " "));
      const icon = WICON[s.state] || "mdi:weather-partly-cloudy";
      // Integrations often name the entity after themselves — Buienradar, Met.no — so prefer the
      // card's own name, then a station name if one is reported, and only then the entity's.
      const station = String(a.station_name || a.stationname || "").replace(/^meetstation\s+/i, "").trim();
      const place = c.name || station || a.friendly_name || c.entity;

      // One row reads like any entity card: the condition as the icon, the place over the
      // condition, and the temperature on the right.
      if ((c.h || 3) <= 1)
        return html`<div class="gcard wdg reading" @click=${() => ctx.more(c.entity)}>
          <div class="cmp-head">
            <ha-icon class="spk-ic" icon=${icon}></ha-icon>
            <div class="hl-meta"><div class="hl-name">${place}</div><div class="hl-sub">${cond}</div></div>
            <div class="cmp-val">${temp != null ? temp + "°" : "–"}</div>
          </div>
        </div>`;

      const fc = ctx.forecast(c.entity);
      const today = fc?.[0];
      const hi = today?.temperature != null ? Math.round(today.temperature) : null;
      const lo = today?.templow != null ? Math.round(today.templow) : null;
      // A wide card lays out like the phone's weather widget: the place and the reading top left,
      // the condition top right, and the days along the bottom. Three columns fit a fifth day.
      if ((c.w || 2) >= 2) {
        // Integrations differ in how far ahead they publish — five days is common, and dropping
        // today from five leaves only four columns. Fall back to starting at today so the row is
        // full either way.
        const want = (c.w || 2) >= 3 ? 5 : 4;
        const all = fc || [];
        const days = all.length > want ? all.slice(1, 1 + want) : all.slice(0, want);
        return html`<div class="gcard wx2" @click=${() => ctx.more(c.entity)}>
          <div class="wx2-top">
            <div class="wx2-now">
              <div class="wx2-place">${place}</div>
              <div class="wx2-temp">${temp != null ? temp : "–"}°</div>
            </div>
            <div class="wx2-cond">
              <ha-icon icon=${icon}></ha-icon>
              <div class="wx2-cname">${cond}</div>
              <div class="wx2-hl">${fc === null ? "…" : `H:${hi ?? "–"}°  L:${lo ?? "–"}°`}</div>
            </div>
          </div>
          ${days.length ? html`<div class="wx2-fc">
            ${days.map((d) => html`<div class="wx2-day">
              <span class="wx2-dn">${new Date(d.datetime).toLocaleDateString([], { weekday: "short" })}</span>
              <ha-icon icon=${WICON[d.condition] || "mdi:weather-partly-cloudy"}></ha-icon>
              <span class="wx2-t">${d.temperature != null ? Math.round(d.temperature) + "°" : "–"}<span>${
                d.templow != null ? Math.round(d.templow) + "°" : ""}</span></span>
            </div>`)}
          </div>` : ""}
        </div>`;
      }

      // One column: the Casa app's mobile square — condition above, the reading with the condition
      // beside it, then the place with today's high and low. No room for a forecast.
      return html`<div class="gcard wx-sq ${(c.h || 3) <= 2 ? "sm" : ""}"
          @click=${() => ctx.more(c.entity)}>
        <div class="wx-main">
          <ha-icon class="wx-ic" icon=${icon}></ha-icon>
          <div class="wx-temp">${temp != null ? temp : "–"}°<span>${cond}</span></div>
          <div class="wx-labels">
            <div class="hl-name">${place}</div>
            <div class="hl-sub">${fc === null ? "…" : `H:${hi ?? "–"}° · L:${lo ?? "–"}°`}</div>
          </div>
        </div>
      </div>`;
    }
    case "rooms": {
      // One switch over however many entities were chosen — the room card from the Casa app.
      const list = c.entities || [];
      const on = list.filter((x) => isOn(ctx, x));
      const anyOn = on.length > 0;
      return html`<div class="gcard wdg row ${anyOn ? "on" : ""}"
          @click=${() => list.length && ctx.call("homeassistant", anyOn ? "turn_off" : "turn_on", { entity_id: list })}>
        <ha-icon class="spk-ic" icon=${c.icon || "mdi:lightbulb-group"}></ha-icon>
        <div class="hl-meta grow">
          <div class="hl-name">${c.name || "Switch"}</div>
          <div class="hl-sub">${!list.length ? "Pick some entities"
            : anyOn ? `${on.length} of ${list.length} on` : "All off"}</div>
        </div>
        <div class="wdg-sw ${anyOn ? "on" : ""}"><span></span></div>
      </div>`;
    }
    case "calendar": {
      const ids = c.entities || [];
      if (!ids.length) return html`<div class="gcard wdg col"><div class="hl-sub">Pick a calendar</div></div>`;
      const events = ctx.calendar(ids, c.span);
      const rows = c.h || 3;
      const title = c.name || "Calendar";
      const head = (sub) => html`<div class="nrg-head"><div class="nrg-meta">
        <span class="hl-name">${title}</span>
        ${sub ? html`<span class="hl-sub">${sub}</span>` : ""}
      </div><ha-icon class="cal-ic" icon="mdi:calendar-month"></ha-icon></div>`;
      if (events === null)
        return html`<div class="gcard cal">${head("Loading")}</div>`;
      if (!events.length)
        return html`<div class="gcard cal">${head("Nothing scheduled")}</div>`;

      const now = new Date();
      const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
      // "14:30" for today, "Fri 14:30" beyond it — the weekday only where it tells you something.
      const when = (ev) => {
        const day = ev.start < midnight ? "" : ev.start.toLocaleDateString([], { weekday: "short" });
        if (ev.allDay) return day || "Today";
        const at = ev.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return day ? `${day} ${at}` : at;
      };
      const n = events.length;
      const { fits, more } = listFits(rows, n);
      return html`<div class="gcard cal">
        ${head(`${n} ${n === 1 ? "event" : "events"}`)}
        <div class="cal-list">
          ${events.slice(0, fits).map((ev) => html`
            <span class="cal-when">${when(ev)}</span>
            <span class="cal-name">${ev.summary}</span>`)}
        </div>
        ${more ? html`<div class="att-more">+${more} more</div>` : ""}
      </div>`;
    }
    case "attention": {
      const checks = c.checks || {};
      const level = c.battery ?? 20;
      const items = attentionItems(ctx, checks, level);
      const n = items.length;
      const rows = c.h || 3;
      const title = c.name || "Needs attention";
      if (!n) return html`<div class="gcard att ${rows === 1 ? "one" : ""} clear">
        <div class="nrg-head"><div class="nrg-meta">
          <span class="hl-name">${title}</span>
          ${rows > 1 ? html`<span class="hl-sub">Nothing to report</span>` : ""}
        </div><ha-icon class="att-ok" icon="mdi:check-circle-outline"></ha-icon></div>
      </div>`;

      // One row can only carry the count; taller cards list as many as they have lines for.
      const { fits, more } = listFits(rows, n);
      return html`<div class="gcard att ${rows === 1 ? "one" : ""}">
        <div class="nrg-head"><div class="nrg-meta">
          <span class="hl-name">${title}</span>
          ${rows > 1 ? html`<span class="hl-sub">${n} ${n === 1 ? "thing" : "things"}</span>` : ""}
        </div><span class="att-n">${n}</span></div>
        ${rows > 1 ? html`<div class="att-list">
          ${items.slice(0, fits).map((it) => html`
            <button class="att-row" @click=${(ev) => { ev.stopPropagation(); ctx.more(it.id); }}>
              <ha-icon icon=${it.icon}></ha-icon>
              <span class="att-name">${it.name}</span>
              <span class="att-note">${it.note}</span>
            </button>`)}
        </div>` : ""}
        ${rows > 1 && more ? html`<div class="att-more">+${more} more</div>` : ""}
      </div>`;
    }
    case "counter": {
      const list = c.entities || [];
      const on = list.filter((x) => isOn(ctx, x)).length;
      const pct = list.length ? Math.round((on / list.length) * 100) : 0;
      const label = c.name || "On now";
      const status = on ? `${on} of ${list.length} on` : "All off";

      // One row is a line: name over the count, with the tally on the right.
      if ((c.h || 2) <= 1)
        return html`<div class="gcard wdg reading ${on ? "on" : ""}">
          <div class="cmp-head">
            <ha-icon class="spk-ic" icon=${c.icon || "mdi:lightbulb-on-outline"}></ha-icon>
            <div class="hl-meta"><div class="hl-name">${label}</div><div class="hl-sub">${status}</div></div>
            <div class="cmp-val">${on}<span class="cnt-of">/${list.length}</span></div>
          </div>
        </div>`;

      // Three rows lays out like the energy card: the name and what it adds up to on top, the
      // tally in the middle, the fill along the bottom.
      if ((c.h || 2) >= 3)
        return html`<div class="gcard cnt-wide ${on ? "on" : ""}">
          <div class="nrg-head">
            <div class="nrg-meta">
              <span class="hl-name">${label}</span>
              <span class="hl-sub">${status}</span>
            </div>
          </div>
          <div class="cnt-num big">${on}<span>/${list.length}</span></div>
          <div class="cnt-bar"><div class="cnt-fill" style="width:${pct}%"></div></div>
        </div>`;

      // Otherwise the Casa app's mobile counter square: the icon, the tally, then the name over
      // what it adds up to.
      return html`<div class="gcard cnt-sq ${on ? "on" : ""}">
        <ha-icon class="cnt-ic" icon=${c.icon || "mdi:lightbulb-on-outline"}></ha-icon>
        <div class="cnt-num">${on}<span>/${list.length}</span></div>
        <div class="cnt-labels">
          <div class="hl-name">${label}</div>
          <div class="hl-sub">${status}</div>
        </div>
        ${(c.w || 1) >= 2 ? html`<div class="wdg-bar"><div class="wdg-fill" style="width:${pct}%"></div></div>` : ""}
      </div>`;
    }
    case "climate": {
      // The Casa app's climate card: room chips, the reading with its steppers, the status line
      // with the mode, fan and swing pickers, and the tick scale you can drag.
      const list = (c.entities || []).filter((x) => st(ctx, x));
      if (!list.length) return html`<div class="gcard wdg col"><div class="hl-sub">Pick some thermostats</div></div>`;
      const at = Math.min(ctx.pick(c.id) ?? 0, list.length - 1);
      const e = list[at];
      const s = st(ctx, e), a = s.attributes;
      const cur = a.current_temperature;
      const held = ctx.target(e);                    // previewed or just-set target
      const tgt = held ? held.temp : a.temperature;
      const mode = s.state;
      const { heating, cooling } = hvacOf(s);
      const zone = heating ? "#FB6E1D" : cooling ? "#5AC8FA" : "#62D621";
      const lo = Math.min(cur ?? 20, tgt ?? 20), hi = Math.max(cur ?? 20, tgt ?? 20);
      const pos = (t) => Math.max(0, Math.min(100, ((t - 17) / 11) * 100));
      const ticks = [];
      for (let i = 0; i < 45; i++) {
        const tv = 17 + i * 0.25;                    // 17..28 in quarter degrees; every fourth is whole
        const inZone = (heating || cooling) && tv >= lo - 0.13 && tv <= hi + 0.13;
        ticks.push(html`<div class="ct" style="height:${i % 4 === 0 ? 16 : 9}px;background:${
          inZone ? zone : "rgba(255,255,255,0.28)"};${inZone ? `box-shadow:0 0 6px ${zone}` : ""}"></div>`);
      }
      // Two rows is the Casa app's mobile climate square: the reading with the room and what the
      // house is doing underneath. The count is across every thermostat on the card, so it reads
      // the same way the app's does.
      if ((c.h || 4) === 2) {
        let heat = 0, cool = 0;
        for (const x of list) {
          const h = hvacOf(st(ctx, x));
          if (h.heating) heat++; else if (h.cooling) cool++;
        }
        const rooms = (n) => `${n} room${n > 1 ? "s" : ""}`;
        const summary = heat && cool ? `${rooms(heat)} heating · ${rooms(cool)} cooling`
          : heat ? `${rooms(heat)} heating` : cool ? `${rooms(cool)} cooling` : "All idle";
        return html`<div class="gcard clim-sq ${heat ? "heat" : cool ? "cool" : ""}"
            @click=${() => (list.length > 1 ? ctx.setPick(c.id, (at + 1) % list.length) : ctx.more(e))}>
          <ha-icon class="clim-sq-ic" icon="mdi:home-thermometer"></ha-icon>
          <div class="clim-sq-temp">${cur ?? "–"}°<span>now</span></div>
          <div class="clim-sq-labels">
            <div class="hl-name">${attr(ctx, e, "friendly_name") || e}</div>
            <div class="hl-sub">${summary}</div>
          </div>
        </div>`;
      }

      // One row reads like an entity card: the thermostat's name over what it is doing, with the
      // temperature on the right. Tapping moves to the next when several are listed, since there
      // is no room for the chips.
      if ((c.h || 4) <= 2) {
        const next = () => (list.length > 1 ? ctx.setPick(c.id, (at + 1) % list.length) : ctx.more(e));
        return html`<div class="gcard clim2 ${heating ? "heat" : cooling ? "cool" : ""} ${(c.h || 4) <= 1 ? "reading" : ""}">
          <div class="cmp-head rclick" @click=${next}>
            <ha-icon class="spk-ic" icon=${MODE_ICON(mode)}></ha-icon>
            <div class="hl-meta">
              <div class="hl-name">${attr(ctx, e, "friendly_name") || e}</div>
              <div class="hl-sub">${heating ? `Heating · ${cur}° → ${tgt}°`
                : cooling ? `Cooling · ${cur}° → ${tgt}°` : mode === "off" ? "Off" : cap(mode)}</div>
            </div>
            <div class="cmp-val">${cur != null ? cur + "°" : "–"}</div>
          </div>
          ${(c.h || 4) <= 1 ? "" : html`<div class="spk-btns">
            <button @click=${() => ctx.setTarget(e, (tgt ?? 20) - 0.5)}><ha-icon icon="mdi:minus"></ha-icon></button>
            <div class="c2-tgt">${tgt ?? "–"}°</div>
            <button @click=${() => ctx.setTarget(e, (tgt ?? 20) + 0.5)}><ha-icon icon="mdi:plus"></ha-icon></button>
          </div>`}
        </div>`;
      }

      const steppers = html`<div class="clim-step">
        <button class="cstep" @click=${() => ctx.setTarget(e, (tgt ?? 20) - 0.5)}><ha-icon icon="mdi:minus"></ha-icon></button>
        <div class="clim-tgt">${tgt ?? "–"}°<span>target</span></div>
        <button class="cstep" @click=${() => ctx.setTarget(e, (tgt ?? 20) + 0.5)}><ha-icon icon="mdi:plus"></ha-icon></button>
      </div>`;
      const picker = (kind, icon, current, options, service, field, iconOf) => {
        const key = `${c.id}:${kind}`;
        const open = ctx.menu(key);
        return html`<div class="clim-modewrap">
          <button class="clim-mode ${open ? "open" : ""}" @click=${(ev) => { ev.stopPropagation(); ctx.openMenu(key, ev); }}>
            <ha-icon icon=${icon}></ha-icon><span>${cap(String(current || "").replace(/_/g, " "))}</span>
            <ha-icon class="cm-caret" icon=${open ? "mdi:chevron-up" : "mdi:chevron-down"}></ha-icon>
          </button>
          ${open ? html`
            <div class="cm-away" @click=${() => ctx.closeMenu()}></div>
            <div class="cm-menu ${open.up ? "up" : ""} ${open.left ? "left" : ""}">
              ${options.map((o) => html`<button class="cm ${o === current ? "sel" : ""}"
                @click=${() => { ctx.call("climate", service, { entity_id: e, [field]: o }); ctx.closeMenu(); }}>
                <ha-icon icon=${iconOf ? iconOf(o) : icon}></ha-icon>
                <span>${cap(String(o).replace(/_/g, " "))}</span>
                ${o === current ? html`<ha-icon class="cm-tick" icon="mdi:check"></ha-icon>` : ""}</button>`)}
            </div>` : ""}
        </div>`;
      };
      return html`<div class="gcard clim-big-card ${heating ? "heat" : cooling ? "cool" : ""}">
        ${list.length > 1 ? html`<div class="clim-sel">
          ${list.map((x, i) => html`<button class="cs ${i === at ? "sel" : ""}"
            @click=${() => { ctx.setPick(c.id, i); ctx.closeMenu(); }}>${attr(ctx, x, "friendly_name") || x}</button>`)}
        </div>` : ""}
        <div class="clim-temprow">
          <div class="clim-big rclick" @click=${() => ctx.more(e)}>${cur ?? "–"}°<span>now</span></div>
          ${steppers}
        </div>
        <div class="clim-statusrow">
          <div class="clim-status">${held?.live ? `Set to ${tgt}°`
            : heating ? `Heating · ${cur}° → ${tgt}°` : cooling ? `Cooling · ${cur}° → ${tgt}°`
            : mode === "off" ? "Off" : cap(mode)}</div>
          <div class="clim-pickers">
            ${picker("mode", MODE_ICON(mode), mode, a.hvac_modes || ["off", "heat", "cool"],
              "set_hvac_mode", "hvac_mode", (m) => MODE_ICON(m))}
            ${a.fan_modes ? picker("fan", "mdi:fan", a.fan_mode, a.fan_modes, "set_fan_mode", "fan_mode") : ""}
            ${a.swing_modes ? picker("swing", "mdi:arrow-oscillating", a.swing_mode, a.swing_modes,
              "set_swing_mode", "swing_mode") : ""}
          </div>
        </div>
        ${(c.h || 4) <= 3 ? "" : html`
          <div class="scale" @pointerdown=${(ev) => ctx.scaleDown(ev, e)}>
            <div class="ticks">${ticks}</div>
            <div class="handle" style="left:${pos(tgt ?? 20)}%"></div>
            <div class="curdot" style="left:${pos(cur ?? 20)}%;background:${zone};box-shadow:0 0 8px ${zone}"></div>
            <div class="slabels">${[18, 20, 22, 24, 26, 28].map((t) =>
              html`<span style="left:${pos(t)}%">${t}</span>`)}</div>
          </div>`}
      </div>`;
    }
    case "history": {
      if (!c.entity) return html`<div class="gcard wdg col"><div class="hl-sub">Pick a sensor</div></div>`;
      const span = c.span || "day";
      const pts = ctx.history(c.entity, span);
      if (pts === null) return html`<div class="gcard wdg col"><div class="wdg-big">…</div>
        <div class="hl-sub">Loading</div></div>`;
      const unit = attr(ctx, c.entity, "unit_of_measurement") || "";
      const name = c.name || attr(ctx, c.entity, "friendly_name") || c.entity;
      const now = Number(st(ctx, c.entity)?.state);
      const shownNow = Number.isFinite(now) ? round1(now) : "–";
      if (pts.length < 2) return html`<div class="gcard wdg col" @click=${() => ctx.more(c.entity)}>
        <span class="hl-name">${name}</span>
        <div class="cc-cur">${shownNow}<span class="nrg-unit">${unit}</span></div>
        <div class="hl-sub">Nothing recorded yet</div></div>`;

      const vals = pts.map((p) => p.val);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      // Drawn in a 0..100 box and stretched by the card, so the shape is the same at every size.
      // A sensor that has not moved has no range to scale to; draw it down the middle, since
      // resting it on the floor of the plot reads as zero rather than as steady.
      const at = (i) => (pts.length === 1 ? 0 : (i / (pts.length - 1)) * 100);
      // Kept off the very edges: the stroke is centred on the path, so a point at 0 or 100 would
      // sit half outside the plot and graze the header above it.
      const y = (v) => (hi === lo ? 50 : 4 + (1 - (v - lo) / (hi - lo)) * 92);
      const line = pts.map((p, i) => `${at(i).toFixed(2)},${y(p.val).toFixed(2)}`).join(" ");
      const rows = c.h || 2;

      // One row is a single line of type: the span has to go, or the header is taller than the card.
      return html`<div class="gcard hst" @click=${() => ctx.more(c.entity)}>
        <div class="nrg-head">
          <div class="nrg-meta">
            <span class="hl-name">${name}</span>
            <span class="hl-sub">${
              span === "week" ? "Last 7 days" : "Last 24 hours"}${
              // The range only earns its place where the line has room for it — on one column it
              // would be ellipsised away, which says less than leaving it out.
              hi === lo || (c.w || 2) < 2 ? ""
                : ` · ${round1(lo)}–${round1(hi)}${unitGap(unit)}${unit}`}</span>
          </div>
          <span class="nrg-figure">
            <span class=${(c.w || 2) >= 2 && rows >= 3 ? "cc-cur" : "cmp-val"}>${shownNow}</span>
            <span class="nrg-unit">${unit}</span></span>
        </div>
        <div class="hst-plot"
            @pointermove=${(ev) => hoverPoint(ev, pts, at, y, unit, span)}
            @pointerdown=${(ev) => hoverPoint(ev, pts, at, y, unit, span)}
            @pointerleave=${(ev) => ev.currentTarget.classList.remove("hovering")}
            @pointercancel=${(ev) => ev.currentTarget.classList.remove("hovering")}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline class="hst-line" points=${line}></polyline>
          </svg>
          <span class="hst-rule"></span><span class="hst-dot"></span><span class="hst-tip"></span>
        </div>
      </div>`;
    }
    case "energy": {
      const bars = ctx.energy(c.entity);
      if (!c.entity) return html`<div class="gcard wdg col"><div class="hl-sub">Pick an energy sensor</div></div>`;
      if (bars === null) return html`<div class="gcard wdg col"><div class="wdg-big">…</div>
        <div class="hl-sub">Loading</div></div>`;
      if (!bars.length) return html`<div class="gcard wdg col"><div class="wdg-big">–</div>
        <div class="hl-sub">No statistics yet</div></div>`;
      const unit = attr(ctx, c.entity, "unit_of_measurement") || "kWh";

      // The same header at every size — name, period, figure — then whatever the height can carry
      // below it: nothing, the app's tick gauge, or the week of bars. The figure only takes the
      // large reading once there are three rows, since a 48px number is taller than a short card.
      const rows = c.h || 4;
      const max = Math.max(...bars.map((b) => b.val), 1);
      const n = bars.length;
      const today = n ? bars[n - 1].val : 0;

      // The figure is either today on its own or the whole fetched window.
      const showToday = c.period === "today";
      const total = (showToday ? today : bars.reduce((a, b) => a + b.val, 0)).toFixed(1);
      const yest = n > 1 ? bars[n - 2].val : 0;
      const scale = Math.max(today, yest, 1);
      const pct = Math.max(0, Math.min(1, today / scale)) * 100;
      const refPct = yest > 0 && today > yest ? (yest / scale) * 100 : null;
      return html`<div class="gcard nrg ${rows === 1 ? "one" : ""}" @click=${() => ctx.more(c.entity)}>
        <div class="nrg-head">
          <div class="nrg-meta">
            <span class="hl-name">${c.name || "Energy used"}</span>
            <span class="hl-sub">${showToday ? "Today" : `Last ${n} days`}</span>
          </div>
          <span class="nrg-figure">
            <span class=${(c.w || 4) >= 2 && rows >= 3 ? "cc-cur" : "cmp-val"}>${total}</span>
            <span class="nrg-unit">${unit}</span></span>
        </div>

        ${rows === 2 ? html`
          <div class="tgauge">
            <div class="gbar">
              <div class="gfill" style="width:${pct}%"></div>
              ${refPct != null ? html`<div class="gref" style="left:${refPct}%"></div>` : ""}
              <div class="ghandle" style="left:${pct}%"></div>
            </div>
            <div class="ruler">${Array.from({ length: 44 }, (_, i) =>
              html`<span class="rk ${i % 5 === 0 ? "lg" : ""}"></span>`)}</div>
            <div class="g-lbls"><span>Today · ${today.toFixed(1)} ${unit}</span>
              ${refPct != null ? html`<span class="g-ref-lbl" style="left:${refPct}%">${yest.toFixed(1)} ${unit}</span>` : ""}
            </div>
          </div>` : ""}

        ${rows >= 3 ? html`
          <div class="nrg-bars">
            ${bars.map((b) => html`<div class="nrg-bar">
              <span class="nrg-val">${b.val}</span>
              <div class="nrg-fill" style="height:${Math.max(8, (b.val / max) * 80)}%"></div>
            </div>`)}
          </div>
          <div class="nrg-days">${bars.map((b) => html`<span>${
            new Date(b.ts).toLocaleDateString([], { weekday: "short" })}</span>`)}</div>` : ""}
      </div>`;
    }
    default:
      return html`<div class="gcard wdg"></div>`;
  }
}

/* ----------------------------------------------------------------- plain */
function plainCard(ctx, c) {
  const e = c.entity, s = st(ctx, e);
  const d = String(e || "").split(".")[0];
  // Only something switchable can be "on" — a sensor reading "Not home" is not active, it is data.
  const on = ["switch", "input_boolean", "fan", "lock", "binary_sensor"].includes(d) && isOn(ctx, e);
  const sub = s ? (d === "climate" ? `${s.attributes.current_temperature ?? "–"}° · ${cap(s.state)}`
    : `${cap(s.state)}${s.attributes.unit_of_measurement ? " " + s.attributes.unit_of_measurement : ""}`) : "Not set";
  return html`<div class="gcard plain ${on ? "on" : ""} ${c.type === "small" ? "one" : ""}"
      @click=${() => (["switch", "input_boolean", "fan", "lock"].includes(d)
        ? ctx.call("homeassistant", "toggle", { entity_id: e }) : ctx.more(e))}>
    <div class="pl-body">
      ${stateIcon(ctx, e, "pl-ic", c.icon, "mdi:card-outline")}
      <div class="pl-meta">
        <div class="hl-name">${c.name || attr(ctx, e, "friendly_name") || e || "Not set"}</div>
        ${c.type !== "small" ? html`<div class="hl-sub">${sub}</div>` : ""}
      </div>
      ${c.type === "small" ? html`<div class="hl-sub end">${sub}</div>` : ""}
    </div>
  </div>`;
}

/** Pick the design for a card. */
export function renderCard(ctx, c) {
  if (c.widget) return widgetCard(ctx, c);
  const d = String(c.entity || "").split(".")[0];
  if (c.type === "full") return fullCard(ctx, c);
  if (d === "light") return lightCard(ctx, c);
  if (d === "cover") return shadeCard(ctx, c);
  if (d === "climate") return isTall(c) ? climateCard(ctx, c) : climateCompact(ctx, c);
  if (d === "lock") return lockCard(ctx, c);
  if (d === "fan") return fanCard(ctx, c);
  if (d === "vacuum") return vacuumCard(ctx, c);
  if (d === "alarm_control_panel") return alarmCard(ctx, c);
  if (d === "scene" || d === "script" || d === "automation") return sceneCard(ctx, c);
  if (d === "media_player") return looksLikeTv(ctx, c.entity) ? tvCard(ctx, c) : speakerCard(ctx, c);
  return plainCard(ctx, c);
}

/** The bedroom panel's card styling, verbatim where it matters. */
export const cardStyles = `
  .gcard{position:relative;background:var(--card);border:1px solid var(--cardBorder);border-radius:18px;
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);box-shadow:var(--shadow);
    overflow:hidden;display:flex;flex-direction:column;min-height:0;min-width:0;height:100%;}
  /* light */
  .hlight{flex-direction:row;align-items:center;cursor:pointer;}
  /* with the brightness row the card becomes a column, like the shade */
  .hlight.tall{flex-direction:column;align-items:stretch;justify-content:space-between;padding:15px;}
  .hlight.tall .hl-body{padding:0;}
  .hlight.tall .spk-btns{position:relative;z-index:2;}
  .hl-fill{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,rgba(248,222,111,.22),rgba(248,222,111,.06));
    transition:width .25s ease;}
  .hlight.on{border-color:rgba(248,222,111,.32);}
  /* same chip as the control buttons on the taller cards, so the two never read as different UI */
  .hl-gear{position:absolute;top:12px;right:12px;z-index:3;width:32px;height:32px;border-radius:50%;
    border:1px solid var(--cardBorder);background:var(--chip);color:var(--text);
    cursor:pointer;display:flex;align-items:center;justify-content:center;}
  .hl-gear ha-icon{--mdc-icon-size:14px;}
  .hl-body{position:relative;z-index:1;display:flex;align-items:center;gap:11px;padding:0 15px;width:100%;}
  /* The gear floats over the card, so the text below it had no edge to run into and slid straight
     underneath. Reserve its width and the name truncates against it instead.
     Gear: 32px wide, 12px from the card's edge. */
  .hl-gear ~ .hl-body{padding-right:52px;}
  .hlight.tall .hl-gear ~ .hl-body{padding-right:37px;}   /* the card's own 15px padding counts */
  .hl-meta{flex:1;}
  .hl-ic{--mdc-icon-size:21px;color:var(--dim);}
  .hlight.on .hl-ic{color:var(--yellow);}
  .hl-meta{min-width:0;overflow:hidden;}
  .hl-name{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .hl-sub{font-size:11.5px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .hl-sub.end{margin-left:auto;}
  /* speaker · shade · tv share the two-line frame */
  .spk-card,.shade2,.media-tile,.clim2,.lock2,.fan2,.vac2,.alarm2{padding:15px;justify-content:space-between;}
  /* a one-row card has only its head — centre it rather than letting it hug the top */
  .reading{justify-content:center;gap:10px;}
  .c2-tgt{flex:0 0 auto;min-width:48px;text-align:center;font-size:16px;font-weight:600;}
  .spk-head{display:flex;align-items:center;gap:10px;min-width:0;max-width:100%;}
  .spk-card .spk-head,.media-tile .spk-head{cursor:pointer;}
  .spk-ic{--mdc-icon-size:20px;color:var(--dim);flex:none;}
  .spk-name{font-size:13.5px;font-weight:600;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .spk-card.playing .spk-ic{color:var(--green);}
  .shade2.on .spk-ic,.shade2.on .cc-ic{color:#8ec5ff;}
  /* An active card carries a wash of its own colour and a tinted border — the TV had this and
     nothing else did, so a playing speaker or an open shade looked identical to an idle one. */
  .media-tile.on,.spk-card.playing{background:linear-gradient(135deg,rgba(98,214,33,.16),rgba(98,214,33,.05));border-color:rgba(98,214,33,.28);}
  .shade2.on{background:linear-gradient(135deg,rgba(142,197,255,.16),rgba(142,197,255,.05));border-color:rgba(142,197,255,.28);}
  /* closed is a state worth seeing too, in the deeper blue its icon already uses */
  .clim2.on,.clim-card.on{background:linear-gradient(135deg,rgba(251,110,29,.10),rgba(251,110,29,.03));border-color:rgba(251,110,29,.20);}
  /* blue for the door, the fan and the vacuum — the same active blue the shade uses */
  .lock2.on,.fan2.on,.vac2.on{background:linear-gradient(135deg,rgba(125,178,255,.16),rgba(125,178,255,.05));
    border-color:rgba(125,178,255,.3);}
  .lock2.on .spk-ic,.fan2.on .spk-ic,.vac2.on .spk-ic{color:#7db2ff;}
  /* an armed alarm is green, since armed is the reassuring state, not the alarming one */
  .alarm2.on{background:linear-gradient(135deg,rgba(98,214,33,.16),rgba(98,214,33,.05));border-color:rgba(98,214,33,.32);}
  .alarm2.on .spk-ic{color:var(--green);}
  /* jammed, or triggered: amber, and it beats the active tint */
  .lock2.warn,.alarm2.warn{background:linear-gradient(135deg,rgba(251,110,29,.2),rgba(251,110,29,.06));
    border-color:rgba(251,110,29,.4);}
  .lock2.warn .spk-ic,.alarm2.warn .spk-ic{color:var(--orange);}
  .spk-btns button[disabled]{opacity:.35;cursor:default;}
  .clim-sq.heat,.clim2.heat,.clim-card.heat,.clim-big-card.heat{background:linear-gradient(135deg,rgba(251,110,29,.16),rgba(251,110,29,.05));border-color:rgba(251,110,29,.3);}
  .clim-sq.cool,.clim2.cool,.clim-card.cool,.clim-big-card.cool{background:linear-gradient(135deg,rgba(125,178,255,.16),rgba(125,178,255,.05));border-color:rgba(125,178,255,.3);}
  .plain.on{background:linear-gradient(135deg,rgba(248,222,111,.14),rgba(248,222,111,.04));border-color:rgba(248,222,111,.28);}
  .media-tile.on .spk-ic{color:var(--green);}
  .spk-btns{display:flex;align-items:center;gap:10px;}
  .spk-btns button{flex:1;height:40px;border-radius:12px;border:1px solid var(--cardBorder);background:var(--chip);
    color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit;}
  .spk-btns button.act{background:rgba(251,110,29,.2);border-color:rgba(251,110,29,.4);color:var(--orange);}
  .spk-btns button.on{background:rgba(125,178,255,.2);border-color:rgba(125,178,255,.4);color:#7db2ff;}
  .spk-btns button ha-icon{--mdc-icon-size:18px;}
  .spk-btns button[disabled]{opacity:.35;cursor:default;}
  /* scene */
  .scene2{padding:15px;cursor:pointer;font-family:inherit;color:var(--text);text-align:left;width:100%;
    transition:transform .15s,border-color .5s ease,background .5s ease;}
  .scene2:active{transform:scale(.97);}
  .scene2:focus{outline:none;}
  .scene2:focus-visible{outline:2px solid rgba(255,255,255,.5);outline-offset:2px;}
  /* full media hero */
  /* The hero fills its grid cell rather than assuming a fixed 320px artwork — at a fixed size it
     overflowed short cells and painted over the cards around it. */
  /* media widget — laid out like a phone's lock screen player: art beside the text, then the
     progress bar, then the transport, each spanning the card */
  .mw{flex-direction:column;justify-content:center;gap:9px;padding:12px 14px;overflow:hidden;}
  .mw-head{display:flex;align-items:center;gap:11px;min-width:0;}
  .mw-art{flex:none;width:46px;height:46px;border-radius:11px;background-size:cover;
    background-position:center;background-image:linear-gradient(135deg,#8a5bff,#d06bff);
    display:flex;align-items:center;justify-content:center;}
  /* Three rows: the artwork takes the height of the three lines beside it rather than a size of
     its own, so the two blocks end together however the type falls. */
  .mw.tall .mw-head{align-items:stretch;}
  .mw.tall .mw-art{width:auto;height:auto;align-self:stretch;aspect-ratio:1;border-radius:13px;}
  .mw-art .mw-ic{--mdc-icon-size:22px;color:#fff;}
  .mw-txt{flex:1;min-width:0;}
  .mw-t{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .mw-a{font-size:12px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .mw-bar{display:flex;flex-direction:column;gap:3px;flex:none;}
  .mw-times{display:flex;justify-content:space-between;font-size:10.5px;color:var(--dim);
    font-variant-numeric:tabular-nums;line-height:1;}
  .mw-prog{height:4px;border-radius:2px;background:rgba(255,255,255,.16);overflow:hidden;flex:none;}
  .mw-fill{height:100%;border-radius:2px;background:var(--text);}
  .mw-ctrls{display:flex;align-items:center;justify-content:center;gap:clamp(16px,9%,34px);}
  .mw-sk{--mdc-icon-size:23px;color:var(--text);opacity:.85;cursor:pointer;}
  .mw-play{--mdc-icon-size:33px;color:var(--text);cursor:pointer;}
  /* Three rows has height to spare. Spread it evenly rather than centring the stack and leaving
     it all at the edges — the bar wants air above and below it, not a margin at the top of the
     card. */
  .mw.tall{gap:0;justify-content:space-evenly;padding:10px 14px;}
  .mw.tall .mw-play{--mdc-icon-size:46px;}
  .mw.tall .mw-sk{--mdc-icon-size:31px;}

  /* Centred, not stretched: rows added beyond what the artwork can use leave space above and
     below rather than pushing everything to the edges. container-type makes cq units resolve
     against this card, which is what lets the art take the smaller of its two limits. */
  .full{position:relative;display:flex;align-items:center;gap:clamp(16px,4%,44px);padding:4px 26px 4px 4px;
    height:100%;min-height:0;min-width:0;overflow:hidden;container-type:size;
    /* 388px is what six rows leaves once the card's padding is taken off (GRID_ROW 58, GRID_GAP
       11). Six rows is as large as the artwork goes: past that the card grows and it does not. */
    --art:min(100cqh,42cqw,388px);}
  /* Sized by the card's width, not its height, so adding rows never grows it — the height term
     is only a guard so a short card cannot overflow. */
  .full-art{position:relative;height:var(--art);aspect-ratio:1;flex:0 0 auto;min-width:0;border-radius:24px;
    background:linear-gradient(135deg,#8a5bff,#d06bff);background-size:cover;background-position:center;
    /* No drop shadow: the card clips its overflow, so a 70px blur around a centred artwork was
       sliced off mid-fade and read as a dark band under it. */
    display:flex;align-items:center;justify-content:center;}
  .full-art ha-icon{--mdc-icon-size:clamp(32px,7vw,88px);color:#fff;}
  .full-side{flex:1 1 0;min-width:0;height:var(--art);display:flex;flex-direction:column;
    justify-content:flex-end;overflow:hidden;}
  .np-kick{font-size:12px;font-weight:700;letter-spacing:.7px;color:var(--dim);}
  .full-title{font-size:clamp(18px,3.4vw,40px);font-weight:600;letter-spacing:-.6px;line-height:1.1;margin-top:6px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .full-artist{font-size:clamp(13px,1.7vw,21px);color:var(--dim);margin-top:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .full-prog{margin-top:clamp(10px,3%,28px);cursor:pointer;touch-action:none;}
  .np-track{height:8px;border-radius:4px;background:var(--track);overflow:hidden;}
  .np-fill{height:100%;background:#fff;border-radius:4px;}
  .np-times{display:flex;justify-content:space-between;font-size:12px;color:var(--dim);margin-top:7px;}
  .full-ctrls{display:flex;align-items:center;justify-content:center;gap:clamp(14px,3vw,30px);margin-top:clamp(12px,3%,30px);}
  .np-ic{--mdc-icon-size:clamp(22px,3vw,34px);color:var(--dim);cursor:pointer;}
  .np-play{--mdc-icon-size:clamp(38px,5vw,64px);color:var(--green);cursor:pointer;}
  /* climate */
  .clim-card{padding:16px;justify-content:space-between;align-items:flex-start;}
  /* compact head, same shape as the light card: icon, name over status, value on the right */
  .cmp-head{display:flex;align-items:center;gap:11px;min-width:0;max-width:100%;width:100%;cursor:pointer;}
  .cmp-val{margin-left:auto;padding-left:9px;flex:none;font-size:19px;font-weight:600;}
  .clim2.heat .spk-ic,.clim-card.heat .spk-ic{color:var(--orange);}
  .clim2.cool .spk-ic,.clim-card.cool .spk-ic{color:#7db2ff;}
  .cc-head{display:flex;align-items:center;gap:11px;min-width:0;max-width:100%;width:100%;color:var(--dim);cursor:pointer;}
  .cc-title{font-size:13.5px;font-weight:600;color:var(--text);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .cc-mid{align-self:stretch;flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;justify-content:center;}
  .cc-cur{font-size:48px;font-weight:300;letter-spacing:-2px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .cc-cur.text{font-size:21px;font-weight:600;letter-spacing:0;line-height:1.25;white-space:normal;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
  .cc-now{font-size:11.5px;color:var(--dim);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  /* the stepper's buttons are the shade's buttons: equal widths sharing the row */
  .cc-stepper{display:flex;align-items:center;gap:10px;width:100%;}
  .cc-stepper button{flex:1;height:40px;border-radius:12px;border:1px solid var(--cardBorder);background:var(--chip);
    color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;}
  .cc-stepper button ha-icon{--mdc-icon-size:18px;}
  .cc-tgt{flex:1;text-align:center;}
  .cc-tgt-v{font-size:20px;font-weight:600;}
  .cc-tgt-l{font-size:11px;color:var(--dim);}
  /* A segmented selector built from the same chips as .spk-btns, so an alarm's controls sit in
     the card exactly like a shade's or a vacuum's. The indicator slides between them; segments
     are equal width, so its travel is its own width plus one gap and needs no measuring. */
  /* One track with the indicator sliding behind transparent segments — the whole row is 40px,
     the height of a .spk-btns button, so it still lines up with every other card's controls. */
  .seg{position:relative;display:flex;align-items:center;width:100%;height:44px;
    border-radius:15px;background:rgba(0,0,0,.22);border:1px solid var(--cardBorder);}
  /* The offset is a plain percentage worked out when the card renders. A compound calc mixing a
     custom property with a percentage was being dropped, leaving the indicator parked at zero. */
  /* The pill sits inside its own segment: the offset is a whole number of segments and the
     margins inset it, so the track keeps an even margin at both ends. */
  .seg-ind{position:absolute;top:4px;bottom:4px;left:var(--ind,0%);margin:0 4px;
    width:calc(100% / var(--n) - 8px);
    border-radius:11px;background:rgba(255,255,255,.18);
    transition:left .3s cubic-bezier(.2,.7,.3,1),background .3s ease;}
  .seg.armed .seg-ind{background:var(--green);}
  .seg.warn{border-radius:12px;}
  .seg.warn .seg-ind{background:var(--orange);}
  .seg-ind.pulse{animation:segPulse 1.1s ease-in-out infinite;}
  .spk-btns button.pulse{animation:segPulse 1.1s ease-in-out infinite;
    background:rgba(125,178,255,.2);border-color:rgba(125,178,255,.4);color:#7db2ff;}
  @keyframes segPulse{0%,100%{opacity:1;}50%{opacity:.3;}}
  .seg-b{position:relative;z-index:1;flex:1;min-width:0;height:100%;border:none;background:none;
    color:var(--dim);cursor:pointer;display:flex;align-items:center;justify-content:center;
    font-family:inherit;-webkit-tap-highlight-color:transparent;transition:color .2s;}
  .seg-b ha-icon{--mdc-icon-size:18px;}
  .seg-b.on{color:var(--text);}
  .seg.armed .seg-b.on,.seg.warn .seg-b.on{color:#0e1620;}

  /* the dashboard's own furniture */
  .wdg{padding:14px 16px;justify-content:center;}
  .wdg.row{flex-direction:row;align-items:center;gap:11px;cursor:pointer;}
  /* the toggle sits at the far edge, so the row reads name on the left, control on the right */
  .wdg .hl-meta.grow{flex:1;min-width:0;}
  .wdg.col{align-items:flex-start;justify-content:center;cursor:pointer;}
  .wdg-big{font-size:clamp(26px,7cqw,52px);font-weight:300;letter-spacing:-1px;line-height:1;}
  .wdg-mid{font-size:clamp(14px,3.2cqw,22px);font-weight:600;line-height:1.2;}
  .wdg-gap{width:100%;height:100%;}

  .wdg.on .spk-ic{color:var(--yellow);}
  .wdg-sw{flex:none;width:44px;height:26px;border-radius:13px;background:var(--track);position:relative;
    transition:background .2s;}
  .wdg-sw span{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;
    transition:transform .2s;}
  .wdg-sw.on{background:var(--green);}
  .wdg-sw.on span{transform:translateX(18px);}
  .counter{gap:6px;}
  .wdg-of{font-size:.45em;color:var(--dim);font-weight:400;}
  .wdg-bar{width:100%;height:6px;border-radius:3px;background:var(--track);overflow:hidden;}
  .wdg-fill{height:100%;border-radius:3px;background:var(--yellow);transition:width .4s ease;}
  /* the Casa app's climate card, ported whole */
  /* the tint follows whichever thermostat the chips have selected */
  .clim-big-card{padding:18px;justify-content:space-between;transition:background .5s ease,border-color .5s ease;}
  .clim-sel{display:flex;gap:8px;flex-wrap:wrap;}
  .cs{flex:1;min-width:64px;height:36px;border-radius:17px;border:1px solid var(--cardBorder);
    background:var(--chip);color:var(--text);font-size:13px;font-weight:500;cursor:pointer;
    font-family:inherit;transition:.2s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .cs.sel{background:#fff;color:#0e1620;border-color:transparent;font-weight:600;}
  .clim-temprow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px;}
  .clim-big{font-size:clamp(34px,9cqw,64px);font-weight:300;letter-spacing:-3px;line-height:1;cursor:pointer;}
  .clim-big span{font-size:14px;font-weight:500;color:var(--dim);letter-spacing:0;margin-left:6px;}
  .clim-step{display:flex;align-items:center;gap:10px;flex:none;}
  .cstep{width:46px;height:46px;border-radius:15px;border:1px solid var(--cardBorder);background:var(--chip);
    color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer;
    font-family:inherit;transition:.15s;}
  .clim-tgt{min-width:54px;text-align:center;font-size:24px;font-weight:600;line-height:1;}
  .clim-tgt span{display:block;font-size:11px;font-weight:500;color:var(--dim);margin-top:4px;}
  .clim-statusrow{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
  .clim-status{font-size:14px;color:var(--dim);}
  .clim-pickers{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
  .clim-modewrap{position:relative;flex:none;}
  .clim-mode{display:inline-flex;align-items:center;gap:7px;flex:none;height:34px;padding:0 10px 0 12px;
    border-radius:17px;border:1px solid var(--cardBorder);background:var(--chip);color:var(--text);
    font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:.2s;}
  .clim-mode.open{background:#fff;color:#0e1620;border-color:transparent;}
  .clim-mode ha-icon{--mdc-icon-size:17px;}
  .cm-caret{--mdc-icon-size:16px;opacity:.7;}
  .cm-away{position:fixed;inset:0;z-index:30;}
  .cm-menu{position:absolute;top:calc(100% + 8px);right:0;z-index:31;min-width:168px;padding:6px;
    display:flex;flex-direction:column;gap:2px;border-radius:16px;
    background:linear-gradient(150deg,rgba(255,255,255,.12),rgba(255,255,255,.03) 62%),rgba(16,21,27,.92);
    border:1px solid var(--cardBorder);box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 20px 46px rgba(0,0,0,.5);
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);}
  .cm-menu.up{top:auto;bottom:calc(100% + 8px);}
  .cm-menu.left{right:auto;left:0;}
  .cm{display:flex;align-items:center;gap:10px;width:100%;height:38px;padding:0 10px;border-radius:11px;
    border:none;background:transparent;color:var(--text);text-align:left;font-family:inherit;
    font-size:13.5px;font-weight:500;cursor:pointer;transition:background .15s;}
  .cm span{flex:1;}
  .cm ha-icon{--mdc-icon-size:18px;color:var(--dim);}
  .cm:hover{background:rgba(255,255,255,.08);}
  .cm.sel{background:rgba(255,255,255,.12);}
  .cm .cm-tick{--mdc-icon-size:16px;color:var(--green);}
  .scale{position:relative;height:52px;margin-top:12px;cursor:pointer;touch-action:pan-y;}
  .ticks{position:absolute;top:8px;left:0;right:0;display:flex;align-items:flex-end;
    justify-content:space-between;height:18px;}
  .ct{width:2px;border-radius:1px;}
  .handle{position:absolute;top:0;transform:translateX(-50%);width:8px;height:34px;border-radius:5px;
    background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.4);}
  .curdot{position:absolute;top:30px;transform:translateX(-50%);width:9px;height:9px;border-radius:50%;}
  .slabels{position:absolute;bottom:0;left:0;right:0;height:14px;font-size:12px;color:var(--dim);}
  .slabels span{position:absolute;transform:translateX(-50%);}

  .nrg{padding:15px;justify-content:center;cursor:pointer;}
  /* a single row still shows the name and the period, so it needs the tighter padding */
  .nrg.one{padding:9px 14px;}
  /* the app's mobile square: bolt, tick gauge, name and today's figure */
  .nrg.sq{justify-content:space-between;gap:10px;}
  .sq-top{display:flex;justify-content:space-between;align-items:center;}
  .sq-ic{--mdc-icon-size:24px;color:var(--text);}
  .tgauge{width:100%;margin-top:10px;}
  .gbar{position:relative;height:14px;border-radius:5px;background:rgba(255,255,255,.07);
    border:1px solid rgba(255,255,255,.07);}
  .gfill{position:absolute;top:0;bottom:0;left:0;min-width:6px;border-radius:5px 0 0 5px;
    background:linear-gradient(90deg,rgba(255,255,255,.20),rgba(255,255,255,.44));}
  .ghandle{position:absolute;top:-2px;bottom:-2px;width:5px;border-radius:3px;background:#fff;
    transform:translateX(-50%);box-shadow:0 0 12px rgba(255,255,255,.5);}
  .gref{position:absolute;top:-3px;bottom:-3px;width:2px;border-radius:1px;background:rgba(255,255,255,.5);
    transform:translateX(-50%);box-shadow:0 0 3px rgba(0,0,0,.5);}
  .ruler{display:flex;justify-content:space-between;align-items:flex-end;height:8px;margin-top:5px;padding:0 1px;}
  .rk{width:1.5px;height:5px;border-radius:1px;background:rgba(255,255,255,.16);}
  .rk.lg{height:8px;background:rgba(255,255,255,.26);}
  .g-lbls{position:relative;display:flex;justify-content:space-between;margin-top:5px;
    font-size:11px;color:var(--dim);}
  .g-ref-lbl{position:absolute;transform:translateX(-50%);font-size:11px;color:var(--dim);white-space:nowrap;}

  /* History: the same header as the energy card, with the trace taking whatever is left. The plot
     is drawn in a 0..100 box and stretched, so one path serves every card size. */
  /* Needs attention: the header carries the count, the rest is a list of what is wrong. */
  .att{padding:16px;display:flex;flex-direction:column;gap:9px;min-height:0;overflow:hidden;}
  .cal{padding:16px;display:flex;flex-direction:column;gap:9px;min-height:0;overflow:hidden;}
  .cal-ic{--mdc-icon-size:20px;color:var(--dim);flex:none;}
  /* A grid, not a fixed column: an auto track makes the time column exactly as wide as the longest
     in this card, so the times start at the card's edge, the summaries line up down the card, and
     there is no slack between the two. A fixed width could only have two of those three. */
  .cal-list{display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 9px;
    grid-auto-rows:19px;align-items:center;align-content:start;min-height:0;overflow:hidden;}
  .cal-when{font-size:11.5px;font-weight:600;color:var(--dim);
    font-variant-numeric:tabular-nums;white-space:nowrap;}
  .cal-name{font-size:12.5px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

  .att.one{padding:9px 14px;justify-content:center;}
  .att.one .nrg-head{align-items:center;}
  .att.one .att-n{font-size:20px;}
  .att-n{font-size:26px;font-weight:600;line-height:1;flex:none;}
  .att-ok{--mdc-icon-size:24px;color:var(--green,#5ad06a);flex:none;}
  .att-list{display:flex;flex-direction:column;gap:0;min-height:0;overflow:hidden;}
  .att-row{display:flex;align-items:center;gap:9px;min-width:0;height:19px;padding:0;border:none;
    background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;}
  .att-row ha-icon{--mdc-icon-size:16px;color:var(--dim);flex:none;}
  .att-name{flex:1;min-width:0;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .att-note{font-size:11.5px;font-weight:600;color:var(--dim);flex:none;}
  /* Pushed to the foot of the card, so it reads as a footnote rather than another entry. */
  .att-more{font-size:11px;color:var(--dim);margin-top:auto;}

  .hst{padding:16px;display:flex;flex-direction:column;gap:8px;cursor:pointer;min-height:0;}
  .hst-plot{position:relative;flex:1;min-height:0;margin:0 -2px;touch-action:none;}
  /* The marker only exists while the pointer is over the plot. */
  .hst-rule,.hst-dot,.hst-tip{position:absolute;opacity:0;pointer-events:none;transition:opacity .12s;}
  .hst-plot.hovering .hst-rule,.hst-plot.hovering .hst-dot,.hst-plot.hovering .hst-tip{opacity:1;}
  .hst-rule{top:0;bottom:0;width:1px;background:rgba(255,255,255,.28);transform:translateX(-.5px);}
  .hst-dot{width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;background:var(--text);
    box-shadow:0 0 0 3px rgba(0,0,0,.35);}
  .hst-tip{top:-2px;transform:translateX(-50%);white-space:nowrap;font-size:11.5px;font-weight:600;
    padding:3px 7px;border-radius:8px;background:rgba(0,0,0,.62);color:#fff;
    backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}
  .hst-plot svg{width:100%;height:100%;display:block;overflow:visible;}
  .hst-line{fill:none;stroke:var(--text);stroke-width:2;vector-effect:non-scaling-stroke;
    stroke-linejoin:round;stroke-linecap:round;}

  /* The title sits at the top of the card, as every other card's does — centring it against a
     figure two or three times its height dropped it well below where the eye expects it. */
  .nrg-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
  /* One row is a single line of type, where the two do belong on the same centre. */
  .nrg.one .nrg-head{align-items:center;}
  .nrg-meta{display:flex;flex-direction:column;min-width:0;line-height:1.3;}
  /* the reading as it was: the big semibold number with the unit dim beside it */
  .nrg-figure{display:flex;align-items:baseline;gap:6px;flex:none;}
  .nrg-unit{font-size:15px;color:var(--dim);}
  .nrg-unit{font-size:15px;color:var(--dim);}
  .nrg-bars{display:flex;align-items:flex-end;gap:8px;flex:1;min-height:52px;margin-top:14px;}
  .nrg-bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
    height:100%;gap:4px;}
  .nrg-val{font-size:10px;font-weight:600;color:var(--dim);}
  /* glass body with a bright cap, the same treatment the mobile gauge uses */
  .nrg-fill{position:relative;flex:0 0 auto;width:100%;border-radius:6px;min-height:8px;
    background:linear-gradient(180deg,rgba(255,255,255,.28),rgba(255,255,255,.10));}
  .nrg-fill::before{content:"";position:absolute;top:0;left:0;right:0;height:4px;
    border-radius:6px 6px 3px 3px;background:#fff;box-shadow:0 0 10px rgba(255,255,255,.55);}
  .nrg-days{display:flex;gap:8px;margin-top:8px;}
  .nrg-days span{flex:1;text-align:center;font-size:11px;color:var(--dim);}

  /* weather, the app's mobile square */
  /* Wide weather: the phone widget's arrangement — place and reading top left, condition top
     right, days along the bottom. Compact by design; the old layout spread the same content
     across the full width and read as mostly gap. */
  .wx2{padding:14px 16px;display:flex;flex-direction:column;justify-content:space-between;
    gap:10px;cursor:pointer;min-height:0;}
  .wx2-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-width:0;}
  .wx2-now{min-width:0;display:flex;flex-direction:column;gap:2px;}
  .wx2-place{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .wx2-temp{font-size:44px;font-weight:300;line-height:1;letter-spacing:-2.5px;white-space:nowrap;}
  .wx2-cond{display:flex;flex-direction:column;align-items:flex-end;gap:1px;text-align:right;min-width:0;}
  .wx2-cond ha-icon{--mdc-icon-size:26px;color:var(--text);}
  .wx2-cname{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
  .wx2-hl{font-size:12px;color:var(--dim);white-space:nowrap;}
  /* The row takes whatever height the top block leaves, rather than sitting small at the bottom
     with the slack above it. */
  .wx2-fc{flex:1;min-height:0;display:flex;align-items:center;justify-content:space-between;
    gap:4px;min-width:0;}
  .wx2-day{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:5px;}
  .wx2-dn{font-size:13px;color:var(--dim);}
  .wx2-day ha-icon{--mdc-icon-size:28px;color:var(--text);}
  .wx2-t{font-size:14px;font-weight:600;white-space:nowrap;}
  .wx2-t span{font-weight:400;color:var(--dim);margin-left:3px;}

  .wx-sq{padding:15px;justify-content:space-between;cursor:pointer;}
  .wx-ic{--mdc-icon-size:30px;color:var(--text);flex:none;}
  .wx-temp{font-size:46px;font-weight:300;line-height:1;letter-spacing:-2.5px;white-space:nowrap;}
  .wx-temp span{font-size:13px;font-weight:500;color:var(--dim);letter-spacing:0;margin-left:5px;}
  .wx-labels{min-width:0;}
  /* Two rows carries the same type as the tall card — only the padding gives way, since 125px
     has to hold the icon, the reading, the place and the high and low. Sizes are fixed rather
     than measured in cqw: nothing declares a container, so those clamps resolved against the
     viewport and picked an end of their range at random. */
  .wx-sq.sm{padding:10px 15px;}
  .wx-sq.sm .wx-ic{--mdc-icon-size:24px;}

  .wx-main{display:flex;flex-direction:column;justify-content:space-between;flex:0 1 auto;min-width:0;}

  /* the app's mobile climate square, at the two-row card's scale */
  .clim-sq{padding:15px;justify-content:space-between;cursor:pointer;}
  .clim-sq-ic{--mdc-icon-size:22px;color:var(--text);flex:none;}
  .clim-sq-temp{font-size:40px;font-weight:300;line-height:1;letter-spacing:-2px;white-space:nowrap;}
  .clim-sq-temp span{font-size:12px;font-weight:500;color:var(--dim);letter-spacing:0;margin-left:5px;}
  .clim-sq-labels{min-width:0;}

  /* the app's mobile counter square */
  .cnt-sq{padding:15px;justify-content:space-between;}
  .cnt-ic{--mdc-icon-size:22px;color:var(--dim);flex:none;}
  .cnt-sq.on .cnt-ic{color:var(--yellow);}
  .cnt-num{font-size:40px;font-weight:300;line-height:1;letter-spacing:-2px;white-space:nowrap;}
  .cnt-num span{font-size:14px;font-weight:500;color:var(--dim);letter-spacing:0;margin-left:4px;}
  .cnt-labels{min-width:0;}
  .cnt-wide{padding:15px;justify-content:space-between;gap:8px;}
  /* the app's proportions: a big semibold count over a thick, glowing track */
  .cnt-num.big{font-size:48px;font-weight:600;letter-spacing:-1.5px;}
  .cnt-num.big span{font-size:17px;margin-left:5px;}
  .cnt-bar{height:26px;border-radius:13px;background:var(--track);overflow:hidden;flex:none;}
  .cnt-fill{height:100%;border-radius:13px;transition:width .4s ease;
    background:linear-gradient(90deg,#F8DE6F,#FFE9A0);box-shadow:0 0 16px rgba(248,222,111,.5);}
  /* the tally reads as a value with its total in the state's type, the way a compact card does */
  .cnt-of{font-size:11.5px;font-weight:400;color:var(--dim);margin-left:3px;letter-spacing:0;}

  /* plain fallback */
  .plain{padding:11px 14px;justify-content:center;cursor:pointer;}
  .plain.one .pl-body{align-items:center;}
  .pl-body{display:flex;align-items:center;gap:13px;min-width:0;}
  .pl-ic{--mdc-icon-size:19px;color:var(--dim);flex:none;}
  .plain.on .pl-ic{color:var(--yellow);}
  .pl-meta{min-width:0;flex:1;}
  @media (max-width:760px){ .full{flex-direction:column;align-items:stretch;gap:18px;}
    .full-art{width:100%;height:auto;aspect-ratio:1;max-width:none;max-height:none;flex:0 0 auto;}
    .full-title{font-size:26px;} .full-artist{font-size:16px;} }
`;
