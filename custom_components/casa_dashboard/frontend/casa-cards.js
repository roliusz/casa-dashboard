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

/** Three rows or more: the name, the reading large in the middle, controls underneath. */
const isTall = (c) => (c.h || 2) >= 3 && c.type !== "tile";

const tallBody = (icon, name, value, label, controls, onMore) => html`
  <div class="cc-head rclick" @click=${onMore}>
    <ha-icon class="cc-ic" icon=${icon}></ha-icon>
    <span class="cc-title">${name}</span>
  </div>
  <div class="cc-mid">
    <div class="cc-cur">${value}</div>
    <div class="cc-now">${label}</div>
  </div>
  ${controls}`;

/** A one-row card is a reading only — every taller card, and every tile, keeps its controls. */
const readingOnly = (c) => (c.h || 2) <= 1 && c.type !== "tile";

const st = (ctx, e) => ctx.hass?.states?.[e];
const attr = (ctx, e, a) => st(ctx, e)?.attributes?.[a];
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
  return html`<div class="gcard hlight ${on ? "on" : ""}" @click=${() => ctx.call("light", "toggle", { entity_id: e })}>
    <div class="hl-fill" style="width:${on ? Math.max(pct, 6) : 0}%"></div>
    <button class="hl-gear" @click=${(ev) => { ev.stopPropagation(); ctx.more(e); }}><ha-icon icon="mdi:tune-variant"></ha-icon></button>
    <div class="hl-body">
      <ha-icon class="hl-ic" icon=${c.icon || attr(ctx, e, "icon") || "mdi:lightbulb"}></ha-icon>
      <div class="hl-meta">
        <div class="hl-name">${c.name || attr(ctx, e, "friendly_name") || e}</div>
        <div class="hl-sub">${on ? pct + "%" : "Off"}</div>
      </div>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- speaker */
function speakerCard(ctx, c) {
  const e = c.entity, muted = attr(ctx, e, "is_volume_muted");
  const v = attr(ctx, e, "volume_level");
  const vol = v != null ? Math.round(v * 100) : 0;
  if (readingOnly(c))
    return html`<div class="gcard spk-card reading ${isActive(ctx, e) ? "playing" : ""}">
      <div class="cmp-head rclick" @click=${() => ctx.more(e)}>
        <ha-icon class="spk-ic" icon=${muted ? "mdi:volume-off" : (c.icon || "mdi:speaker")}></ha-icon>
        <div class="hl-meta">
          <div class="hl-name">${c.name || attr(ctx, e, "friendly_name") || "Speaker"}</div>
          <div class="hl-sub">${muted ? "Muted" : isActive(ctx, e) ? "Playing" : "Idle"}</div>
        </div>
        <div class="cmp-val">${vol}%</div>
      </div>
    </div>`;
  return html`<div class="gcard spk-card ${isActive(ctx, e) ? "playing" : ""}">
    <div class="spk-head rclick" @click=${() => ctx.more(e)}>
      <ha-icon class="spk-ic" icon=${muted ? "mdi:volume-off" : (c.icon || "mdi:speaker")}></ha-icon>
      <div class="spk-name">${c.name || attr(ctx, e, "friendly_name") || "Speaker"}</div>
    </div>
    <div class="spk-level">${muted ? "Muted" : vol + "%"}</div>
    <div class="spk-btns">
      <button @click=${() => volNudge(ctx, e, -0.01)}><ha-icon icon="mdi:minus"></ha-icon></button>
      <button class=${muted ? "act" : ""} @click=${() => ctx.call("media_player", "volume_mute", { entity_id: e, is_volume_muted: !muted })}>
        <ha-icon icon=${muted ? "mdi:volume-off" : "mdi:volume-mute"}></ha-icon></button>
      <button @click=${() => volNudge(ctx, e, 0.01)}><ha-icon icon="mdi:plus"></ha-icon></button>
    </div>
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
      ${tallBody(c.icon || "mdi:television", tvName,
        on ? (a.app_name || a.source || "On") : "Off", on ? (a.media_title || "") : "",
        transport, () => ctx.more(e))}
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
    return html`<div class="gcard shade2 ${open ? "on" : ""} ${closed ? "closed" : ""}">
      ${tallBody(open ? "mdi:blinds-open" : "mdi:blinds", name,
        pos != null ? pos + "%" : s.state[0].toUpperCase() + s.state.slice(1),
        pos != null ? "open" : "", btns, () => ctx.more(e))}
    </div>`;
  return html`<div class="gcard shade2 ${open ? "on" : ""} ${closed ? "closed" : ""} ${readingOnly(c) ? "reading" : ""}">
    <div class="cmp-head rclick" @click=${() => ctx.more(e)}>
      <ha-icon class="spk-ic" icon=${open ? "mdi:blinds-open" : "mdi:blinds"}></ha-icon>
      <div class="hl-meta">
        <div class="hl-name">${c.name || attr(ctx, e, "friendly_name") || "Shade"}</div>
        <div class="hl-sub">${pos != null ? "open" : s.state[0].toUpperCase() + s.state.slice(1)}</div>
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
  return html`<button class="scene-card" @click=${() => ctx.call(d === "scene" ? "scene" : "script", "turn_on", { entity_id: e })}>
    <ha-icon icon=${c.icon || attr(ctx, e, "icon") || "mdi:creation"}></ha-icon>
    <span>${c.name || attr(ctx, e, "friendly_name") || e}</span>
  </button>`;
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
  const heating = (mode === "heat" || mode === "auto") && tgt > cur;
  const cooling = (mode === "cool" || mode === "auto") && tgt < cur;
  const setT = (t) => ctx.call("climate", "set_temperature", { entity_id: e, temperature: Math.round(t * 2) / 2 });
  return html`<div class="gcard clim-card ${heating ? "heat" : cooling ? "cool" : ""}">
    <div class="cc-head rclick" @click=${() => ctx.more(e)}>
      <ha-icon class="cc-ic" icon=${heating ? "mdi:fire" : cooling ? "mdi:snowflake" : "mdi:thermostat"}></ha-icon>
      <span class="cc-title">${c.name || attr(ctx, e, "friendly_name") || "Climate"}</span>
    </div>
    <div class="cc-mid">
      <div class="cc-cur">${cur != null ? cur + "°" : "–"}</div>
      <div class="cc-now">${heating ? "Heating" : cooling ? "Cooling"
        : mode === "off" ? "Off" : mode[0].toUpperCase() + mode.slice(1)}</div>
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
  const heating = (mode === "heat" || mode === "auto") && tgt > cur;
  const cooling = (mode === "cool" || mode === "auto") && tgt < cur;
  const setT = (t) => ctx.call("climate", "set_temperature", { entity_id: e, temperature: Math.round(t * 2) / 2 });
  const status = heating ? "Heating" : cooling ? "Cooling"
    : mode === "off" ? "Off" : mode[0].toUpperCase() + mode.slice(1);
  return html`<div class="gcard clim2 ${heating ? "heat" : cooling ? "cool" : ""} ${readingOnly(c) ? "reading" : ""}">
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

/* ----------------------------------------------------------------- plain */
function plainCard(ctx, c) {
  const e = c.entity, s = st(ctx, e), on = isOn(ctx, e);
  const d = String(e || "").split(".")[0];
  const sub = s ? (d === "climate" ? `${s.attributes.current_temperature ?? "–"}° · ${s.state}`
    : `${s.state}${s.attributes.unit_of_measurement ? " " + s.attributes.unit_of_measurement : ""}`) : "not set";
  return html`<div class="gcard plain ${on ? "on" : ""} ${c.type === "small" ? "one" : ""}"
      @click=${() => (["switch", "input_boolean", "fan", "lock"].includes(d)
        ? ctx.call("homeassistant", "toggle", { entity_id: e }) : ctx.more(e))}>
    <div class="pl-body">
      <ha-icon class="pl-ic" icon=${c.icon || attr(ctx, e, "icon") || "mdi:card-outline"}></ha-icon>
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
  const d = String(c.entity || "").split(".")[0];
  if (c.type === "full") return fullCard(ctx, c);
  if (d === "light") return lightCard(ctx, c);
  if (d === "cover") return shadeCard(ctx, c);
  if (d === "climate") return (c.h || 3) <= 2 ? climateCompact(ctx, c) : climateCard(ctx, c);
  if (d === "scene" || d === "script") return sceneCard(ctx, c);
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
  .hl-fill{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,rgba(248,222,111,.22),rgba(248,222,111,.06));
    transition:width .25s ease;}
  .hlight.on{border-color:rgba(248,222,111,.32);}
  .hl-gear{position:absolute;top:12px;right:12px;z-index:3;width:32px;height:32px;border-radius:50%;border:none;
    background:rgba(10,14,18,.5);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;}
  .hl-gear ha-icon{--mdc-icon-size:14px;}
  .hl-body{position:relative;z-index:1;display:flex;align-items:center;gap:11px;padding:0 15px;width:100%;}
  .hl-ic{--mdc-icon-size:21px;color:var(--dim);}
  .hlight.on .hl-ic{color:var(--yellow);}
  .hl-meta{min-width:0;}
  .hl-name{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .hl-sub{font-size:11.5px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .hl-sub.end{margin-left:auto;}
  /* speaker · shade · tv share the two-line frame */
  .spk-card,.shade2,.media-tile,.clim2{padding:15px;justify-content:space-between;}
  /* a one-row card has only its head — centre it rather than letting it hug the top */
  .reading{justify-content:center;gap:10px;}
  .c2-tgt{flex:0 0 auto;min-width:48px;text-align:center;font-size:16px;font-weight:600;}
  .spk-head{display:flex;align-items:center;gap:10px;min-width:0;max-width:100%;}
  .spk-card .spk-head,.media-tile .spk-head{cursor:pointer;}
  .spk-ic{--mdc-icon-size:20px;color:var(--dim);flex:none;}
  .spk-name{font-size:13.5px;font-weight:600;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .spk-level{font-size:29px;font-weight:300;letter-spacing:-1px;}
  .spk-level.sm{font-size:19px;font-weight:600;letter-spacing:0;}
  .spk-card.playing .spk-ic{color:var(--green);}
  .shade2.on .spk-ic{color:#8ec5ff;} .shade2.closed .spk-ic{color:#7db2ff;}
  .media-tile.on{background:linear-gradient(135deg,rgba(98,214,33,.16),rgba(98,214,33,.05));border-color:rgba(98,214,33,.28);}
  .media-tile.on .spk-ic{color:var(--green);}
  .spk-btns{display:flex;align-items:center;gap:10px;}
  .spk-btns button{flex:1;height:40px;border-radius:12px;border:1px solid var(--cardBorder);background:var(--chip);
    color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit;}
  .spk-btns button.act{background:rgba(251,110,29,.2);border-color:rgba(251,110,29,.4);color:var(--orange);}
  .spk-btns button ha-icon{--mdc-icon-size:18px;}
  .spk-btns button[disabled]{opacity:.35;cursor:default;}
  /* scene */
  .scene-card{border-radius:18px;background:var(--card);border:1px solid var(--cardBorder);
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);box-shadow:var(--shadow);
    display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;padding:13px;
    cursor:pointer;font-family:inherit;color:var(--text);height:100%;min-height:0;
    transition:transform .15s,border-color .5s ease,background .5s ease;}
  .scene-card:active{transform:scale(.97);}
  .scene-card ha-icon{--mdc-icon-size:22px;color:var(--dim);}
  .scene-card span{font-size:13.5px;font-weight:600;}
  /* full media hero */
  /* The hero fills its grid cell rather than assuming a fixed 320px artwork — at a fixed size it
     overflowed short cells and painted over the cards around it. */
  .full{position:relative;display:flex;align-items:stretch;gap:clamp(16px,4%,44px);padding:4px;
    height:100%;min-height:0;min-width:0;overflow:hidden;}
  .full-art{position:relative;height:100%;aspect-ratio:1;flex:0 1 auto;min-width:0;max-width:46%;border-radius:24px;
    background:linear-gradient(135deg,#8a5bff,#d06bff);background-size:cover;background-position:center;
    display:flex;align-items:center;justify-content:center;box-shadow:0 26px 70px -16px rgba(0,0,0,.55);}
  .full-art ha-icon{--mdc-icon-size:clamp(32px,7vw,88px);color:#fff;}
  .full-side{flex:1 1 0;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden;}
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
  .cmp-head{display:flex;align-items:center;gap:11px;min-width:0;cursor:pointer;}
  .cmp-val{margin-left:auto;padding-left:9px;flex:none;font-size:19px;font-weight:600;}
  .clim2.heat .spk-ic{color:var(--orange);} .clim2.cool .spk-ic{color:#7db2ff;}
  .cc-head{display:flex;align-items:center;gap:8px;min-width:0;font-size:12px;font-weight:600;color:var(--dim);cursor:pointer;}
  .cc-title{font-size:13.5px;font-weight:600;color:var(--text);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .shade2.on .cc-ic{color:#8ec5ff;} .shade2.closed .cc-ic{color:#7db2ff;} .media-tile.on .cc-ic{color:var(--green);}
  .cc-ic{--mdc-icon-size:17px;}
  .clim-card.heat .cc-ic{color:var(--orange);} .clim-card.cool .cc-ic{color:#7db2ff;}
  .clim-card.heat{border-color:rgba(251,110,29,.3);} .clim-card.cool{border-color:rgba(125,178,255,.3);}
  .cc-mid{align-self:flex-start;flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;}
  .cc-cur{font-size:48px;font-weight:300;letter-spacing:-2px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .cc-now{font-size:11.5px;color:var(--dim);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .cc-stepper{display:flex;align-items:center;gap:12px;width:100%;}
  .cc-stepper button{width:40px;height:40px;border-radius:12px;border:1px solid var(--cardBorder);background:var(--chip);
    color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;}
  .cc-stepper button ha-icon{--mdc-icon-size:19px;}
  .cc-tgt{flex:1;text-align:center;}
  .cc-tgt-v{font-size:20px;font-weight:600;}
  .cc-tgt-l{font-size:11px;color:var(--dim);}
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
