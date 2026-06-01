/*
 * <store-map> — store locator map for the Stores (stockists) page.
 * Owned by sections/main-stores.liquid.
 *
 * Light DOM web component. Wraps the whole locator (list column + map column).
 * Lazy-loads Mapbox GL from CDN (global `mapboxgl`, not the three.js import map),
 * reads a JSON coordinate blob emitted by the section, drops one pin per store,
 * and auto-fits the view to all pins.
 *
 * Interaction: clicking a list row flies the map to that store's pin and opens
 * its popup; clicking a pin marks the matching row `.is-active`. List rows and
 * the JSON array share the same index, so row[i] ↔ store[i].
 *
 * Config via data-attributes (data, not state — state uses the .is-* classes):
 *   data-token       Mapbox public access token (pk.…)
 *   data-map-style   Mapbox style URL (defaults to light-v11)
 */

const MAPBOX_VERSION = "v3.9.1";
const DEFAULT_STYLE = "mapbox://styles/mapbox/light-v11";
const PIN_COLOR = "#36262B"; // --color-text

class StoreMap extends HTMLElement {
  connectedCallback() {
    this.token = this.getAttribute("data-token") || "";
    this.mapStyle = this.getAttribute("data-map-style") || DEFAULT_STYLE;
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

    if (!this.token || !this.canvas || !this.stores.length) {
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
    if (window.mapboxgl) return Promise.resolve();
    if (StoreMap.loader) return StoreMap.loader;

    StoreMap.loader = new Promise((resolve, reject) => {
      const base = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl`;

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

  initMap() {
    mapboxgl.accessToken = this.token;

    this.map = new mapboxgl.Map({
      container: this.canvas,
      style: this.mapStyle,
      cooperativeGestures: true, // require ctrl / two-finger to zoom — keeps page scroll usable
    });
    this.map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "top-right"
    );

    const bounds = new mapboxgl.LngLatBounds();

    this.stores.forEach((store, i) => {
      const lngLat = this.lngLatOf(store);
      if (!lngLat) return;

      const popup = new mapboxgl.Popup({
        offset: 24,
        closeButton: false,
      }).setHTML(this.popupHtml(store));

      const marker = new mapboxgl.Marker({ color: PIN_COLOR })
        .setLngLat(lngLat)
        .setPopup(popup)
        .addTo(this.map);

      marker.getElement().addEventListener("click", () => this.activate(i));

      this.markers[i] = marker;
      bounds.extend(lngLat);
    });

    if (!bounds.isEmpty()) {
      this.map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 });
    }
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

    if (!this.map) return;

    const lngLat = this.lngLatOf(store);
    if (!lngLat) return;

    this.map.flyTo({
      center: lngLat,
      zoom: 14,
      duration: this.reducedMotion ? 0 : 800,
    });

    // Close any open popups, then open this store's.
    this.markers.forEach((marker, i) => {
      if (i !== index && marker && marker.getPopup().isOpen()) marker.togglePopup();
    });
    const marker = this.markers[index];
    if (marker && !marker.getPopup().isOpen()) marker.togglePopup();
  }

  /* Parse the single "lat, lng" coordinates field (as pasted from a Google Maps
     right-click) into Mapbox's [lng, lat] order. Returns null if blank/invalid. */
  lngLatOf(store) {
    if (!store || typeof store.coordinates !== "string") return null;
    const parts = store.coordinates.split(",");
    if (parts.length < 2) return null;
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lng, lat];
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
