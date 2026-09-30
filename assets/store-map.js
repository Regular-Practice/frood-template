/*
 * <store-map> — store locator for the Stores (stockists) page.
 * Owned by sections/main-stores.liquid.
 *
 * Light DOM web component wrapping the whole locator (search + list column + map
 * column). Lazy-loads MapLibre GL from CDN (global `maplibregl`) and renders
 * OpenFreeMap vector tiles — keyless: no account or access token. The map style is
 * authored here from the live Frood brand tokens (read off :root at runtime), so
 * every feature — land, water, buildings, parks, roads — is brand-coloured rather
 * than a default basemap. (Approach translated from the 68 Newman Street MapLibre
 * map, recoloured for Frood's warm light palette.)
 *
 * Built for hundreds of stores:
 *   - A metaobject list holds at most 250 entries per page, so the section renders
 *     page 1 and puts the next page's URL on `data-next-url`. We fetch the rest,
 *     merge the rows + JSON blobs, sort A–Z (retailer, then branch) and re-index.
 *   - Pins are a clustered GeoJSON layer (one canvas layer, not hundreds of DOM
 *     nodes). Only the *active* store gets a DOM marker (the enlarged inverted pin)
 *     plus a popup.
 *   - The search box filters rows and pins together (every typed word must match
 *     the retailer or branch name) and refits the map to the matches.
 *
 * Row ↔ store link: each entry owns its <li>; `data-store-index` on the row button
 * is the entry's position in `this.entries` and is rewritten after every merge/sort.
 *
 * State uses the .is-* classes (not data attributes). Data attributes carry
 * config/data only: [data-store-data] (JSON), [data-store-row], [data-map-canvas],
 * [data-store-list], [data-store-search], [data-no-results], data-next-url.
 */

const MAPLIBRE_VERSION = "4.7.1";
const TILE_URL = "https://tiles.openfreemap.org/planet";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://openfreemap.org">OpenFreeMap</a>';
const MAX_EXTRA_PAGES = 20;

class StoreMap extends HTMLElement {
  connectedCallback() {
    this.canvas = this.querySelector("[data-map-canvas]");
    this.list = this.querySelector("[data-store-list]");
    this.searchInput = this.querySelector("[data-store-search]");
    this.noResults = this.querySelector("[data-no-results]");
    this.query = "";
    this.activeIndex = -1;

    this.entries = this.readEntries(this);
    this.finishEntries();
    this.applyFilter();

    // List + search work even if the map (or later pages) can't load.
    this.list.addEventListener("click", (event) => {
      const button = event.target.closest("[data-store-row]");
      if (button) this.activate(Number(button.dataset.storeIndex));
    });
    if (this.searchInput) {
      let timer;
      this.searchInput.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => this.applyFilter(this.searchInput.value), 120);
      });
    }

    this.reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const libraryReady = this.canvas
      ? this.loadLibrary()
      : Promise.reject(new Error("no canvas"));
    libraryReady.catch(() => this.classList.add("is-map-unavailable"));

    this.loadRemotePages()
      .then(() => libraryReady)
      .then(() => this.initMap())
      .catch(() => this.classList.add("is-map-unavailable"));
  }

  disconnectedCallback() {
    if (this.map) this.map.remove();
  }

  /* Zip a page's rows with its JSON blob into entries. `root` is this element
     (page 1) or the <store-map> of a fetched page. */
  readEntries(root) {
    const rows = Array.from(root.querySelectorAll("[data-store-list] > li"));
    const dataEl = root.querySelector("[data-store-data]");
    let stores = [];
    try {
      stores = dataEl ? JSON.parse(dataEl.textContent) : [];
    } catch {
      stores = [];
    }
    return rows.map((row, i) => {
      const data = stores[i] || {};
      return {
        row,
        button: row.querySelector("[data-store-row]"),
        data,
        lngLat: this.lngLatOf(data),
        text: this.normalise(`${data.retailer || ""} ${data.location || ""}`),
        visible: true,
      };
    });
  }

  /* Fetch pages 2..n (if any) and fold them into this.entries. */
  async loadRemotePages() {
    let url = this.dataset.nextUrl;
    let pages = 0;
    while (url && pages < MAX_EXTRA_PAGES) {
      pages += 1;
      let doc;
      try {
        const response = await fetch(url);
        if (!response.ok) break;
        doc = new DOMParser().parseFromString(await response.text(), "text/html");
      } catch {
        break;
      }
      const remote = doc.querySelector("store-map");
      if (!remote) break;
      const more = this.readEntries(remote).map((entry) => {
        this.list.appendChild(document.adoptNode(entry.row));
        return entry;
      });
      this.entries = this.entries.concat(more);
      url = remote.dataset.nextUrl;
    }
    if (pages) {
      this.finishEntries();
      this.applyFilter(this.query);
    }
  }

  /* Sort A–Z, rebuild the list in that order, and rewrite the row indexes. */
  finishEntries() {
    const active = this.entries[this.activeIndex];
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    this.entries.sort(
      (a, b) =>
        collator.compare(a.data.retailer || "", b.data.retailer || "") ||
        collator.compare(a.data.location || "", b.data.location || "")
    );
    const fragment = document.createDocumentFragment();
    this.entries.forEach((entry, i) => {
      if (entry.button) entry.button.dataset.storeIndex = i;
      fragment.appendChild(entry.row);
    });
    this.list.appendChild(fragment);
    // Sorting moves entries; keep the selection pointing at the same store.
    if (active) this.activeIndex = this.entries.indexOf(active);
  }

  normalise(value) {
    return String(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* Show only entries whose name contains every typed word; refit the map. */
  applyFilter(value) {
    const changed = value !== undefined && this.normalise(value) !== this.query;
    if (value !== undefined) this.query = this.normalise(value);
    const terms = this.query ? this.query.split(" ") : [];

    let firstVisible = null;
    let count = 0;
    this.entries.forEach((entry) => {
      entry.visible = terms.every((term) => entry.text.includes(term));
      entry.row.classList.toggle("is-filtered-out", !entry.visible);
      entry.row.classList.remove("is-first-visible");
      if (entry.visible) {
        count += 1;
        if (!firstVisible) firstVisible = entry;
      }
    });
    if (firstVisible) firstVisible.row.classList.add("is-first-visible");

    if (this.noResults) this.noResults.hidden = count > 0;

    const active = this.entries[this.activeIndex];
    if (active && !active.visible) this.clearActive();

    if (this.map && this.map.getSource("stores")) {
      this.map.getSource("stores").setData(this.geojson());
      if (changed) this.fitToVisible(true);
    }
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
    if (!this.entries.some((entry) => entry.lngLat)) {
      this.classList.add("is-map-unavailable");
      return;
    }

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
    this.popup = new maplibregl.Popup({ offset: 18, closeButton: false });

    this.fitToVisible(false);
    this.map.on("load", () => this.addPinLayers());
  }

  /* Clustered pins as GeoJSON layers, coloured from the brand tokens. */
  addPinLayers() {
    const accent = this.token("--color-accent", "#FFE74B");
    const text = this.token("--color-text", "#36262B");

    this.map.addSource("stores", {
      type: "geojson",
      data: this.geojson(),
      cluster: true,
      clusterRadius: 40,
      clusterMaxZoom: 12,
    });
    this.map.addLayer({
      id: "store-clusters",
      type: "circle",
      source: "stores",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": accent,
        "circle-stroke-color": text,
        "circle-stroke-width": 2,
        "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 22],
      },
    });
    this.map.addLayer({
      id: "store-cluster-count",
      type: "symbol",
      source: "stores",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
        "text-allow-overlap": true,
      },
      paint: { "text-color": text },
    });
    this.map.addLayer({
      id: "store-points",
      type: "circle",
      source: "stores",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": accent,
        "circle-stroke-color": text,
        "circle-stroke-width": 2,
        "circle-radius": 7,
      },
    });

    this.map.on("click", "store-clusters", (event) => {
      const feature = event.features[0];
      this.map
        .getSource("stores")
        .getClusterExpansionZoom(feature.properties.cluster_id)
        .then((zoom) =>
          this.map.easeTo({
            center: feature.geometry.coordinates,
            zoom: zoom + 0.5,
            duration: this.reducedMotion ? 0 : 500,
          })
        );
    });
    this.map.on("click", "store-points", (event) =>
      this.activate(event.features[0].properties.i)
    );
    ["store-clusters", "store-points"].forEach((layer) => {
      this.map.on("mouseenter", layer, () => (this.map.getCanvas().style.cursor = "pointer"));
      this.map.on("mouseleave", layer, () => (this.map.getCanvas().style.cursor = ""));
    });
  }

  geojson() {
    return {
      type: "FeatureCollection",
      features: this.entries
        .map((entry, i) => ({ entry, i }))
        .filter(({ entry }) => entry.visible && entry.lngLat)
        .map(({ entry, i }) => ({
          type: "Feature",
          properties: { i },
          geometry: { type: "Point", coordinates: entry.lngLat },
        })),
    };
  }

  fitToVisible(animate) {
    if (!this.map) return;
    const bounds = new maplibregl.LngLatBounds();
    this.entries.forEach((entry) => {
      if (entry.visible && entry.lngLat) bounds.extend(entry.lngLat);
    });
    if (bounds.isEmpty()) return;
    this.map.fitBounds(bounds, {
      padding: 56,
      maxZoom: 15,
      duration: animate && !this.reducedMotion ? 600 : 0,
    });
  }

  activate(index) {
    const entry = this.entries[index];
    if (!entry) return;

    this.activeIndex = index;
    this.entries.forEach((other, i) =>
      other.button && other.button.classList.toggle("is-active", i === index)
    );
    this.scrollRowIntoView(entry.row);

    if (!this.map || !entry.lngLat) return;

    this.showActiveMarker(entry);
    this.map.flyTo({
      center: entry.lngLat,
      zoom: 15,
      duration: this.reducedMotion ? 0 : 800,
    });
  }

  /* One DOM marker + popup for the selected store (the rest are canvas layers). */
  showActiveMarker(entry) {
    if (this.activeMarker) this.activeMarker.remove();
    const element = this.pinElement();
    element.classList.add("is-active");
    this.activeMarker = new maplibregl.Marker({ element })
      .setLngLat(entry.lngLat)
      .addTo(this.map);
    this.popup
      .setLngLat(entry.lngLat)
      .setHTML(this.popupHtml(entry.data))
      .addTo(this.map);
  }

  clearActive() {
    this.activeIndex = -1;
    this.entries.forEach((entry) => entry.button && entry.button.classList.remove("is-active"));
    if (this.activeMarker) this.activeMarker.remove();
    this.activeMarker = null;
    if (this.popup) this.popup.remove();
  }

  /* Scroll the list (not the page) just enough to reveal the row. */
  scrollRowIntoView(row) {
    const listRect = this.list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < listRect.top) this.list.scrollTop -= listRect.top - rowRect.top;
    else if (rowRect.bottom > listRect.bottom) this.list.scrollTop += rowRect.bottom - listRect.bottom;
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
