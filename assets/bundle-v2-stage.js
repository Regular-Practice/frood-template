/*
  <bundle-v2-stage> — pure 2D PNG-compositing depth-stack visualiser (NO three.js).

  Renders the draft as ONE continuous horizontal fan that never wraps. There is no
  box quantum in v2 — packs are priced and sold individually above an order
  minimum — so the fan simply runs as long as the draft.

  The MOST-RECENTLY-ADDED pack is the front of the fan, drawn at identity against
  the row's right edge; each older pack is the SAME full-frame image translated
  left by its depth, with a lower z-index, so it peeks out behind.

  Pouches keep a CONSTANT size (--pack-max) however many there are. The row grows
  rightward and the track scrolls horizontally once it outgrows its container —
  the fan's right edge is pinned in view after every update (scrollToFront), so
  the shopper always adds at the front and older pouches recede off to the left.

  While the draft is empty the host carries `.is-empty`, which the section
  stylesheet uses to show a centred prompt over the reserved scene square.

  Scenes are cloned from a <template> in the section markup. The stage adds/removes
  scenes as the box count changes and lays them out in a wrapping row.

  The pack renders are authored in-scale with each other (one locked camera, full
  square frame), so the stack is TRANSLATE-ONLY by default.

  `depth` = how far a pack is from the front of ITS box: 0 = newest/front,
  increasing toward the oldest at the back.

  ----------------------------------------------------------------------------
  Standalone per theme convention — communicates with <bundle-v2-builder> only via
  `bundle-v2:updated` on `document`:

    detail: { packs: [{ key, id, image }, …], counts, total,
              shortfall, minPacks, isValid }

  `packs` is the flat draft in add order; each pack carries its own image URL
  (resolved by <bundle-v2-builder> from the flavour metaobject), so the stage
  needs no catalogue. Pack `key`s are stable, so a pack whose depth shifts when
  an earlier one is removed keeps its slot rather than being torn down. On connect
  it dispatches `bundle-v2:request-state` in case it upgraded after the builder's
  first emit.

  Expected markup (from sections/bundle-v2-builder.liquid):
    <bundle-v2-stage>
      <div data-stage></div>                 (scenes get appended here)
      <template data-box-template>
        <div class="bundle-v2-row">
        </div>
      </template>
    </bundle-v2-stage>
*/

// Per-step deltas: offsetX/Y are % of the scene (negative X = left, up = negative
// Y); scaleStep/rotateStep default to 0 because the renders are authored in scale.
const STACK = { offsetX: -9.5, offsetY: 0, scaleStep: 0, rotateStep: 0 };

// Fraction of a pouch's own width that each step of depth shifts it left. Must
// match STACK.offsetX so the CSS width reservation and the transforms agree.
const STEP = Math.abs(STACK.offsetX) / 100;

class BundleV2Stage extends HTMLElement {
  connectedCallback() {
    this.track = this.querySelector('[data-stage]');
    this.template = this.querySelector('[data-box-template]');
    this.params = { ...STACK };
    this.leaveTimers = new Map();

    this._onUpdated = (e) => this.render(e.detail);
    document.addEventListener('bundle-v2:updated', this._onUpdated);
    this.backButton = this.querySelector('[data-scroll="back"]');
    this.forwardButton = this.querySelector('[data-scroll="forward"]');
    this.backButton?.addEventListener('click', () => this.step(-1));
    this.forwardButton?.addEventListener('click', () => this.step(1));

    this._onScroll = () => this.updateScrollState();
    this.track.addEventListener('scroll', this._onScroll, { passive: true });
    this.initDrag();


    // Handshake — the builder may have emitted before this module upgraded.
    document.dispatchEvent(new CustomEvent('bundle-v2:request-state'));

    if (new URLSearchParams(location.search).has('bundle-v2-calibrate')) this.mountCalibration();
  }

  disconnectedCallback() {
    document.removeEventListener('bundle-v2:updated', this._onUpdated);
    this.track.removeEventListener('scroll', this._onScroll);
  }

  // ---- Browsing ---------------------------------------------------------

  // Two flags for the stylesheet:
  //   is-scrollable — the fan overflows, so the arrows are worth showing
  //   is-browsing   — scrolled away from the front, i.e. the shopper is looking
  //                   back through the fan rather than adding to it
  //
  // `is-browsing` lifts the depth dimming: the dimming exists to shade the
  // pouches running off the start edge, which is unhelpful when those are the
  // ones being inspected. Derived from scroll position rather than tracked as
  // state, so adding (which re-pins to the front) restores the dimming for
  // free, with no need to tell a programmatic scroll from a user one.
  updateScrollState() {
    const max = this.track.scrollWidth - this.track.clientWidth;
    const offset = this.track.scrollLeft;
    this.classList.toggle('is-scrollable', max > 1);
    this.classList.toggle('is-browsing', max - offset > 1);
    if (this.backButton) this.backButton.disabled = offset <= 1;
    if (this.forwardButton) this.forwardButton.disabled = max - offset <= 1;
  }

  // One arrow press moves most of a viewport, keeping a little overlap for
  // context rather than jumping a clean screenful.
  step(direction) {
    this.track.scrollBy({ left: direction * this.track.clientWidth * 0.6, behavior: 'smooth' });
  }

  // Click-and-drag along the fan. Mouse only — touch and trackpad already scroll
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


  // Pin the fan's right edge — the newest pouch — in view. Once the row is wider
  // than the track the older pouches run off to the LEFT and stay reachable by
  // scrolling back; adding always happens at the front, so the front is what
  // must never be scrolled out of sight.
  scrollToFront() {
    // Deliberately INSTANT. Both scrollTo({behavior:'smooth'}) and CSS
    // scroll-behavior silently fail to run in some contexts (an unfocused tab
    // among them), which would strand the newest pouch off-screen — the one
    // thing this must never do. Each add only shifts the fan by one step
    // (~32px), so the jump is barely perceptible. Overshooting to scrollWidth is
    // fine; the browser clamps to the maximum offset.
    this.track.scrollLeft = this.track.scrollWidth;
    this.updateScrollState();
  }

  // ---- Rendering --------------------------------------------------------

  packStyle(depth) {
    const { offsetX, offsetY, scaleStep, rotateStep } = this.params;
    const tx = depth * offsetX;
    const ty = depth * offsetY;
    const s = 1 - depth * scaleStep;
    const r = depth * rotateStep;
    return `--depth: ${depth}; transform: translate(${tx}%, ${ty}%) scale(${s}) rotate(${r}deg); z-index: ${100 - depth};`;
  }

  render(detail) {
    if (!detail || !this.track || !this.template) return;
    this.lastDetail = detail;

    // The draft arrives as one flat, ordered list — add order is all the fan
    // depends on.
    const packs = detail.packs || [];

    // One row, always — it never wraps. Pouches keep a constant size and the row
    // simply grows; the track scrolls once it outgrows its container.
    this.syncScenes(1);
    const row = this.track.querySelector('[data-scene]');
    if (!row) return;
    row.style.setProperty('--n', String(Math.max(1, packs.length)));

    // Desired placement for every pack, keyed by its stable key. Depth counts
    // back from the newest pack, which sits at the row's right edge.
    const desired = new Map();
    packs.forEach((pack, j) => {
      desired.set(String(pack.key), {
        sceneIndex: 0,
        depth: packs.length - 1 - j,
        image: pack.image
      });
    });
    const present = new Set(desired.keys());
    const scenes = [row];

    // Drives the empty-state message in the section stylesheet. No carton art in
    // v2, so an empty draft would otherwise render a blank square.
    this.classList.toggle('is-empty', desired.size === 0);

    // Remove slots whose pack is gone (with an exit animation).
    this.track.querySelectorAll('.bundle-v2-slot').forEach((slot) => {
      if (present.has(slot.dataset.key)) return;
      if (slot.classList.contains('is-leaving')) return;
      this.exitSlot(slot);
    });

    // Place each present pack: create it, move it to its current box, and set
    // its depth transform. Reconciled by key so identity survives box shuffles.
    desired.forEach((target, key) => {
      const scene = scenes[target.sceneIndex];
      if (!scene) return;
      let slot = this.track.querySelector(`.bundle-v2-slot[data-key="${key}"]`);
      if (!slot) {
        slot = this.makeSlot({ key, image: target.image });
        scene.appendChild(slot);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => slot.classList.remove('is-entering'))
        );
      } else if (slot.parentElement !== scene) {
        // Pack shifted to a different row (e.g. an earlier pack was removed).
        scene.appendChild(slot);
      }
      slot.style.cssText = this.packStyle(target.depth);
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

  // ---- Dev-only calibration overlay (?bundle-v2-calibrate) -----------------

  mountCalibration() {
    const panel = document.createElement('div');
    panel.className = 'bundle-v2-calib';
    const ranges = [
      ['offsetX', -20, 0, 0.5],
      ['offsetY', -20, 5, 0.5],
      ['scaleStep', 0, 0.15, 0.005],
      ['rotateStep', -10, 10, 0.5]
    ];
    const out = document.createElement('code');
    const sync = () => {
      out.textContent = `STACK = { offsetX: ${this.params.offsetX}, offsetY: ${this.params.offsetY}, scaleStep: ${this.params.scaleStep}, rotateStep: ${this.params.rotateStep} }`;
      this.track.querySelectorAll('[data-scene]').forEach((scene) => {
        const slots = scene.querySelectorAll('.bundle-v2-slot');
        slots.forEach((slot, i) => {
          slot.style.cssText = this.packStyle(slots.length - 1 - i);
        });
      });
    };
    for (const [name, min, max, step] of ranges) {
      const label = document.createElement('label');
      label.textContent = name;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min;
      input.max = max;
      input.step = step;
      input.value = this.params[name];
      input.addEventListener('input', () => {
        this.params[name] = parseFloat(input.value);
        sync();
      });
      label.appendChild(input);
      panel.appendChild(label);
    }
    panel.appendChild(out);
    this.appendChild(panel);
    sync();
  }
}

customElements.define('bundle-v2-stage', BundleV2Stage);
