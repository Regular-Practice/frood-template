/*
 * <store-map> — store locator map for the Stores (stockists) page.
 * Owned by sections/main-stores.liquid.
 *
 * Light DOM web component wrapping the whole locator (list column + map column).
 * Lazy-loads MapLibre GL from CDN (global `maplibregl`) and renders OpenFreeMap
 * vector tiles — keyless: no account or access token. The map style is authored
 * here from the live Frood brand tokens (read off :root at runtime), so every
 * feature — land, water, buildings, parks, roads — is brand-coloured rather than
 * a default basemap. (Approach translated from the 68 Newman Street MapLibre map,
 * recoloured for Frood's warm light palette.)
 *
 * Reads a JSON coordinate blob emitted by the section, drops one pin per store,
 * auto-fits the view to all pins. Clicking a list row flies to that store's pin
 * and opens its popup; clicking a pin marks the matching row + pin `.is-active`.
 * List rows and the JSON array share the index, so row[i] ↔ store[i].
 *
 * State uses the .is-* classes (not data attributes). Data attributes carry
 * config/data only: [data-store-data] (JSON), [data-store-row], [data-map-canvas].
 */

const MAPLIBRE_VERSION = "4.7.1";
const TILE_URL = "https://tiles.openfreemap.org/planet";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://openfreemap.org">OpenFreeMap</a>';

class StoreMap extends HTMLElement {
  connectedCallback() {
    this.canvas = this.querySelector("[data-map-canvas]");
    this.rows = Array.from(this.querySelectorAll("[data-store-row]"));
    this.markers = [];

    const dataEl = this.querySelector("[data-store-data]");
    try {
      this.stores = dataEl ? JSON.parse(dataEl.textContent) : [];
    } catch {
      this.stores = [];
    }

    // List interaction works even if the map can't load.
    this.bindRows();

    if (!this.canvas || !this.stores.length) {
      this.classList.add("is-map-unavailable");
      return;
    }

    this.reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    this.loadLibrary()
      .then(() => this.initMap())
      .catch(() => this.classList.add("is-map-unavailable"));
  }

  disconnectedCallback() {
    if (this.map) this.map.remove();
  }

  loadLibrary() {
    if (window.maplibregl) return Promise.resolve();
    if (StoreMap.loader) return StoreMap.loader;

    StoreMap.loader = new Promise((resolve, reject) => {
      const base = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl`;

      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = `${base}.css`;
      document.head.appendChild(css);

      const script = document.createElement("script");
      script.src = `${base}.js`;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });

    return StoreMap.loader;
  }

  /* Read a CSS custom property off :root, with a fallback. */
  token(name, fallback) {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return value || fallback;
  }

  /* Frood basemap style — translated from the Newman MapLibre layer set, but
     recoloured from live brand tokens for a warm, light, on-brand map. */
  buildStyle() {
    const bg = this.token("--color-bg", "#FFFEF9");
    const bgDark = this.token("--color-bg-dark", "#DFDCD4");
    const accentLight = this.token("--color-accent-light", "#F7F0C1");
    const text = this.token("--color-text", "#36262B");
    const textAccent = this.token("--color-text-accent", "#979193");

    return {
      version: 8,
      // Font source — required for any text (place labels) to render.
      glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      sources: {
        openmaptiles: { type: "vector", url: TILE_URL, attribution: ATTRIBUTION },
      },
      layers: [
        { id: "background", type: "background", paint: { "background-color": bg } },
        {
          id: "landuse",
          type: "fill",
          source: "openmaptiles",
          "source-layer": "landuse",
          paint: { "fill-color": accentLight, "fill-opacity": 0.45 },
        },
        {
          id: "park",
          type: "fill",
          source: "openmaptiles",
          "source-layer": "park",
          paint: { "fill-color": accentLight, "fill-opacity": 0.55 },
        },
        {
          id: "water",
          type: "fill",
          source: "openmaptiles",
          "source-layer": "water",
          paint: { "fill-color": bgDark },
        },
        {
          id: "building",
          type: "fill",
          source: "openmaptiles",
          "source-layer": "building",
          paint: { "fill-color": bgDark, "fill-opacity": 0.55 },
        },
        {
          id: "road-minor",
          type: "line",
          source: "openmaptiles",
          "source-layer": "transportation",
          filter: ["in", "class", "minor", "service", "path", "track"],
          paint: { "line-color": accentLight, "line-width": 1, "line-opacity": 0.8 },
        },
        {
          id: "road-secondary",
          type: "line",
          source: "openmaptiles",
          "source-layer": "transportation",
          filter: ["in", "class", "secondary", "tertiary"],
          paint: { "line-color": accentLight, "line-width": 1.5 },
        },
        {
          id: "road-primary",
          type: "line",
          source: "openmaptiles",
          "source-layer": "transportation",
          filter: ["in", "class", "primary", "trunk"],
          paint: { "line-color": accentLight, "line-width": 2.5 },
        },
        {
          id: "road-major",
          type: "line",
          source: "openmaptiles",
          "source-layer": "transportation",
          filter: ["==", "class", "motorway"],
          paint: { "line-color": accentLight, "line-width": 3.5 },
        },
        {
          // Main place wording (London + major districts) for orientation —
          // limited to city/town/suburb so it stays uncluttered.
          id: "place-labels",
          type: "symbol",
          source: "openmaptiles",
          "source-layer": "place",
          filter: ["in", "class", "city", "town", "suburb"],
          layout: {
            "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
            "text-font": ["Noto Sans Regular"],
            "text-transform": "uppercase",
            "text-letter-spacing": 0.08,
            "text-size": [
              "match",
              ["get", "class"],
              "city", 15,
              "town", 12,
              "suburb", 11,
              11,
            ],
          },
          paint: {
            "text-color": text,
            "text-halo-color": bg,
            "text-halo-width": 1.5,
          },
        },
      ],
    };
  }

  initMap() {
    this.map = new maplibregl.Map({
      container: this.canvas,
      style: this.buildStyle(),
      cooperativeGestures: true, // require ctrl / two-finger to zoom — keeps page scroll usable
      attributionControl: { compact: true },
    });
    this.map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right"
    );

    const bounds = new maplibregl.LngLatBounds();

    this.stores.forEach((store, i) => {
      const lngLat = this.lngLatOf(store);
      if (!lngLat) return;

      const popup = new maplibregl.Popup({
        offset: 18,
        closeButton: false,
      }).setHTML(this.popupHtml(store));

      const marker = new maplibregl.Marker({ element: this.pinElement() })
        .setLngLat(lngLat)
        .setPopup(popup)
        .addTo(this.map);

      marker.getElement().addEventListener("click", () => this.activate(i));

      this.markers[i] = marker;
      bounds.extend(lngLat);
    });

    if (bounds.isEmpty()) {
      this.classList.add("is-map-unavailable");
      return;
    }

    this.map.fitBounds(bounds, { padding: 56, maxZoom: 15, duration: 0 });
  }

  bindRows() {
    this.rows.forEach((row, i) => {
      row.addEventListener("click", () => this.activate(i));
    });
  }

  activate(index) {
    const store = this.stores[index];
    if (!store) return;

    this.rows.forEach((row, i) => row.classList.toggle("is-active", i === index));
    this.markers.forEach((marker, i) => {
      const el = marker && marker.getElement();
      if (el) el.classList.toggle("is-active", i === index);
    });

    if (!this.map) return;

    const lngLat = this.lngLatOf(store);
    if (!lngLat) return;

    this.map.flyTo({
      center: lngLat,
      zoom: 15,
      duration: this.reducedMotion ? 0 : 800,
    });

    const marker = this.markers[index];
    if (marker) marker.togglePopup();
  }

  /* Parse the single "lat, lng" coordinates field (as pasted from a Google Maps
     right-click) into MapLibre's [lng, lat]. Returns null if blank/invalid. */
  lngLatOf(store) {
    if (!store || typeof store.coordinates !== "string") return null;
    const parts = store.coordinates.split(",");
    if (parts.length < 2) return null;
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lng, lat];
  }

  pinElement() {
    const el = document.createElement("div");
    el.className = "store-pin";
    const dot = document.createElement("span");
    dot.className = "store-pin-dot";
    el.appendChild(dot);
    return el;
  }

  popupHtml(store) {
    const lines = [];
    if (store.retailer) lines.push(this.escape(store.retailer));
    if (store.location) lines.push(`<strong>${this.escape(store.location)}</strong>`);
    return `<div class="store-map-popup text-body">${lines.join("<br>")}</div>`;
  }

  escape(value) {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : value;
    return div.innerHTML;
  }
}

customElements.define("store-map", StoreMap);
