/*
  <bundle-v2-stage> — the "Your box" pack strip (pure 2D, NO three.js).

  Renders the draft as ONE horizontal row of pouches, side by side in add order,
  that never wraps. There is no box quantum in v2 — packs are priced and sold
  individually above an order minimum — so the row simply runs as long as the
  draft.

  Pouches keep a CONSTANT size (--pack-size) however many there are. The track
  scrolls horizontally once the row outgrows its container, and the newest pack
  (the right-hand end) is pinned in view after every update (scrollToFront), so
  older pouches run off to the left and stay reachable by dragging or scrolling.

  While the draft is empty the host carries `.is-empty`, which the section
  stylesheet uses to show a centred prompt over the reserved strip.

  The row is cloned from a <template> in the section markup.

  ----------------------------------------------------------------------------
  Standalone per theme convention — communicates with <bundle-v2-builder> only via
  `bundle-v2:updated` on `document`:

    detail: { packs: [{ key, id, image }, …], counts, total,
              shortfall, minPacks, isValid }

  `packs` is the flat draft in add order; each pack carries its own image URL
  (resolved by <bundle-v2-builder> from the flavour metaobject), so the stage
  needs no catalogue. Pack `key`s are stable, so a pack keeps its slot when an
  earlier one is removed rather than being torn down. On connect it dispatches
  `bundle-v2:request-state` in case it upgraded after the builder's first emit.

  Expected markup (from sections/bundle-v2-builder.liquid):
    <bundle-v2-stage>
      <div data-stage></div>                 (the row gets appended here)
      <template data-box-template>
        <div class="bundle-v2-row" data-scene></div>
      </template>
    </bundle-v2-stage>
*/

class BundleV2Stage extends HTMLElement {
  connectedCallback() {
    this.track = this.querySelector('[data-stage]');
    this.template = this.querySelector('[data-box-template]');
    this.leaveTimers = new Map();

    this._onUpdated = (e) => this.render(e.detail);
    document.addEventListener('bundle-v2:updated', this._onUpdated);
    this.initDrag();
    this.observePanel();

    // Handshake — the builder may have emitted before this module upgraded.
    document.dispatchEvent(new CustomEvent('bundle-v2:request-state'));
  }

  disconnectedCallback() {
    document.removeEventListener('bundle-v2:updated', this._onUpdated);
    if (this.panelObserver) this.panelObserver.disconnect();
  }

  // Publishes the "Your box" panel's height as --panel-h on the panel. The section
  // stylesheet uses it to keep the sticky panel vertically centred in the window on
  // desktop, which CSS alone can't do for a sticky box of varying height (the panel
  // grows when the subscription options open, the hint text appears, and so on).
  observePanel() {
    const panel = this.closest('.bundle-v2-panel');
    if (!panel || !('ResizeObserver' in window)) return;
    this.panelObserver = new ResizeObserver(() => {
      panel.style.setProperty('--panel-h', `${Math.round(panel.getBoundingClientRect().height)}px`);
    });
    this.panelObserver.observe(panel);
  }

  // ---- Browsing ---------------------------------------------------------

  // Click-and-drag along the strip. Mouse only — touch and trackpad already scroll
  // the container natively, and hijacking those fights the platform. The pack
  // slots are pointer-events: none, so drags starting on a pouch land here too.
  initDrag() {
    let startX = 0;
    let startScroll = 0;
    let dragging = false;

    this.track.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startScroll = this.track.scrollLeft;
      try {
        this.track.setPointerCapture(e.pointerId);
      } catch {
        /* capture unavailable — the drag still tracks via pointermove */
      }
      this.classList.add('is-dragging');
    });

    this.track.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      this.track.scrollLeft = startScroll - (e.clientX - startX);
    });

    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      this.classList.remove('is-dragging');
      try {
        this.track.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
    };
    this.track.addEventListener('pointerup', end);
    this.track.addEventListener('pointercancel', end);
  }


  // Pin the strip's right edge — the newest pouch — in view. Once the row is
  // wider than the track the older pouches run off to the LEFT and stay
  // reachable by scrolling back; adding always happens at the end, so that is
  // what must never be scrolled out of sight.
  scrollToFront() {
    // Deliberately INSTANT. Both scrollTo({behavior:'smooth'}) and CSS
    // scroll-behavior silently fail to run in some contexts (an unfocused tab
    // among them), which would strand the newest pouch off-screen — the one
    // thing this must never do. Overshooting to scrollWidth is fine; the
    // browser clamps to the maximum offset.
    this.track.scrollLeft = this.track.scrollWidth;
  }

  // ---- Rendering --------------------------------------------------------

  render(detail) {
    if (!detail || !this.track || !this.template) return;
    this.lastDetail = detail;

    // The draft arrives as one flat, ordered list — add order is the row order.
    const packs = detail.packs || [];

    // One row, always — it never wraps.
    this.syncScenes(1);
    const row = this.track.querySelector('[data-scene]');
    if (!row) return;

    // Desired packs, keyed by their stable key.
    const desired = new Map();
    packs.forEach((pack) => {
      desired.set(String(pack.key), { image: pack.image });
    });
    const present = new Set(desired.keys());

    // Drives the empty-state message in the section stylesheet, which would
    // otherwise be a blank strip.
    this.classList.toggle('is-empty', desired.size === 0);

    // Remove slots whose pack is gone (with an exit animation).
    this.track.querySelectorAll('.bundle-v2-slot').forEach((slot) => {
      if (present.has(slot.dataset.key)) return;
      if (slot.classList.contains('is-leaving')) return;
      this.exitSlot(slot);
    });

    // Add a slot for each pack that doesn't have one yet. Reconciled by key, so
    // existing slots keep their identity (and DOM order = add order) when an
    // earlier pack is removed.
    desired.forEach((target, key) => {
      if (this.track.querySelector(`.bundle-v2-slot[data-key="${key}"]`)) return;
      const slot = this.makeSlot({ key, image: target.image });
      row.appendChild(slot);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => slot.classList.remove('is-entering'))
      );
    });

    this.scrollToFront();
  }

  // Match the number of rows to `n`, cloning the template / trimming.
  syncScenes(n) {
    const scenes = this.track.querySelectorAll('[data-scene]');
    if (scenes.length < n) {
      for (let i = scenes.length; i < n; i++) {
        this.track.appendChild(this.template.content.cloneNode(true));
      }
    } else if (scenes.length > n) {
      for (let i = scenes.length - 1; i >= n; i--) {
        scenes[i].remove();
      }
    }
  }

  exitSlot(slot) {
    slot.classList.add('is-leaving');
    const drop = () => slot.remove();
    slot.addEventListener('transitionend', drop, { once: true });
    this.leaveTimers.set(slot.dataset.key, setTimeout(drop, 240)); // fallback
  }

  makeSlot(pack) {
    const slot = document.createElement('div');
    slot.className = 'bundle-v2-slot is-entering';
    slot.dataset.key = String(pack.key);

    const img = document.createElement('img');
    img.className = 'bundle-v2-pack';
    img.alt = '';
    if (pack.image) img.src = pack.image;
    img.addEventListener('error', () => {
      img.style.visibility = 'hidden';
    });

    slot.appendChild(img);
    return slot;
  }
}

customElements.define('bundle-v2-stage', BundleV2Stage);
