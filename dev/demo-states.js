/** A fake home: enough entities to exercise every card type, none of them real. */
const st = (id, state, attrs = {}) => [id, { entity_id: id, state, attributes: attrs }];

export const DEMO_STATES = Object.fromEntries([
  st("light.kitchen", "on", { friendly_name: "Kitchen", brightness: 180, supported_color_modes: ["brightness"] }),
  st("light.living_room", "off", { friendly_name: "Living Room", supported_color_modes: ["brightness"] }),
  st("light.hallway", "on", { friendly_name: "Hallway", brightness: 60, supported_color_modes: ["onoff"] }),

  st("climate.living_room", "heat", {
    friendly_name: "Living Room", current_temperature: 21.4, temperature: 20,
    min_temp: 7, max_temp: 30, hvac_action: "heating",
  }),
  st("climate.bedroom", "off", {
    friendly_name: "Bedroom", current_temperature: 19.2, temperature: 18.5, min_temp: 7, max_temp: 30,
  }),

  st("cover.bedroom", "open", { friendly_name: "Bedroom Blind", current_position: 100 }),
  st("cover.living_room", "closed", { friendly_name: "Living Room Blind", current_position: 0 }),

  st("media_player.lounge", "playing", {
    friendly_name: "Lounge", media_title: "Nightcall", media_artist: "Kavinsky", volume_level: 0.4,
  }),
  st("media_player.kitchen", "idle", { friendly_name: "Kitchen Speaker", volume_level: 0.2 }),

  st("lock.front_door", "locked", { friendly_name: "Front Door", device_class: "lock" }),
  st("lock.back_door", "unlocked", { friendly_name: "Back Door", device_class: "lock" }),
  st("lock.garage", "jammed", { friendly_name: "Garage Door", device_class: "lock" }),

  st("switch.porch", "on", { friendly_name: "Porch" }),
  st("scene.movie_night", "unknown", { friendly_name: "Movie Night" }),
  st("scene.good_morning", "unknown", { friendly_name: "Good Morning" }),
  st("sensor.outside_temp", "12.4", {
    friendly_name: "Outside", unit_of_measurement: "°C", device_class: "temperature",
  }),
]);

/** The minimum of `hass` that the panel touches. */
export const demoHass = () => ({
  states: DEMO_STATES,
  themes: {},
  language: "en",
  callService: async (domain, service, data) => console.log("callService", domain, service, data),
  formatEntityState: (s) => s.state,
});

/** An auto tab holding everything, plus an empty custom tab to build in. */
export const demoLayout = (newAutoTab, newTab) => {
  const auto = newAutoTab("All", "mdi:apps");
  auto.entities = Object.keys(DEMO_STATES);
  return { header: { pills: [] }, sidebar: { items: [] }, tabs: [auto, newTab("Home", "mdi:home")] };
};
