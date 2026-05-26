/*
  <bundle-stage> — pure 2D PNG-compositing depth-stack visualiser (v3, NO three.js).

  Layer order, back → front:
    1. box-back   — carton interior + floor (behind the packs). Static <img>.
    2. the packs  — the MOST-RECENTLY-ADDED pack is the front of the stack, drawn
                    at identity (matching the single-pack render that sits
                    correctly in the box). Each older pack is the SAME full-frame
                    image translated up-left by its depth, with a lower z-index,
                    so it peeks out behind.
    3. box-front  — the low front lip (in front of the packs' bases). Static <img>.

  The pack renders are authored in-scale with each other and the box (one locked
  camera, full square frame — see assets render guide), so the stack is
  TRANSLATE-ONLY by default (no depth scaling). All assets share one frame, so a
  single parametric transform places any pack.

  `depth` = how far a pack is from the front: 0 = newest/front, increasing toward
  the oldest at the back.

  ----------------------------------------------------------------------------
  Standalone per theme convention — communicates with <bundle-builder> only via
  `bundle:updated` on `document`:

    detail: { box: [{ key, id, image }, …], filled, capacity, isFull }

  `box` is ordered newest-last; each pack carries its own image URL (resolved by
  <bundle-builder> from the flavour metaobject), so the stage needs no catalogue.
  On connect it dispatches `bundle:request-state` in case it upgraded after the
  builder's first emit.

  The box-layer <img>s are server-rendered (URLs from the section settings); the
  stage only inserts/removes pack slots between them.

  Expected markup (from sections/bundle-builder.liquid):
    <bundle-stage data-capacity>
      <div data-scene>
        <img data-box-back-img> <img data-box-front-img>
      </div>
      <p data-stage-hint></p>
    </bundle-stage>
*/

// Per-step deltas: offsetX/Y are % of the stage (negative X = left, up = negative
// Y); scaleStep/rotateStep default to 0 because the renders are authored in scale.
const STACK = { offsetX: -9.5, offsetY: 0, scaleStep: 0, rotateStep: 0 };

class BundleStage extends HTMLElement {
  connectedCallback() {
    this.capacity = parseInt(this.dataset.capacity, 10) || 4;
    this.scene = this.querySelector('[data-scene]');
    this.boxFront = this.querySelector('[data-box-front-img]');
    this.hint = this.querySelector('[data-stage-hint]');
    this.emptyHint = this.hint ? this.hint.textContent : '';
    this.params = { ...STACK };
    this.leaveTimers = new Map();

    this._onUpdated = (e) => this.render(e.detail);
    document.addEventListener('bundle:updated', this._onUpdated);

    // Handshake — the builder may have emitted before this module upgraded.
    document.dispatchEvent(new CustomEvent('bundle:request-state'));

    if (new URLSearchParams(location.search).has('bundle-calibrate')) this.mountCalibration();
  }

  disconnectedCallback() {
    document.removeEventListener('bundle:updated', this._onUpdated);
  }

  // ---- Rendering --------------------------------------------------------

  packStyle(depth) {
    const { offsetX, offsetY, scaleStep, rotateStep } = this.params;
    const tx = depth * offsetX;
    const ty = depth * offsetY;
    const s = 1 - depth * scaleStep;
    const r = depth * rotateStep;
    return `transform: translate(${tx}%, ${ty}%) scale(${s}) rotate(${r}deg); z-index: ${100 - depth};`;
  }

  render(detail) {
    if (!detail || !this.scene) return;
    const box = detail.box || [];
    const filled = box.length;

    if (this.hint) {
      this.hint.textContent = filled === 0 ? this.emptyHint : `${filled} / ${this.capacity}`;
    }

    const present = new Set(box.map((p) => String(p.key)));

    // Remove slots whose pack is gone (with an exit animation).
    this.scene.querySelectorAll('.bundle-slot').forEach((slot) => {
      if (present.has(slot.dataset.key)) return;
      if (slot.classList.contains('is-leaving')) return;
      slot.classList.add('is-leaving');
      const drop = () => slot.remove();
      slot.addEventListener('transitionend', drop, { once: true });
      this.leaveTimers.set(slot.dataset.key, setTimeout(drop, 240)); // fallback
    });

    // Place each present pack at its current depth (newest = front = depth 0).
    box.forEach((pack, i) => {
      const depth = filled - 1 - i;
      let slot = this.scene.querySelector(`.bundle-slot[data-key="${pack.key}"]`);
      if (!slot) {
        slot = this.makeSlot(pack);
        // box-front must stay last so it paints over the pack bases.
        this.scene.insertBefore(slot, this.boxFront);
        // Trigger the enter transition after layout.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => slot.classList.remove('is-entering'))
        );
      }
      slot.style.cssText = this.packStyle(depth);
    });
  }

  makeSlot(pack) {
    const slot = document.createElement('div');
    slot.className = 'bundle-slot is-entering';
    slot.dataset.key = String(pack.key);

    const img = document.createElement('img');
    img.className = 'bundle-pack';
    img.alt = '';
    if (pack.image) img.src = pack.image;
    img.addEventListener('error', () => {
      img.style.visibility = 'hidden';
    });

    slot.appendChild(img);
    return slot;
  }

  // ---- Dev-only calibration overlay (?bundle-calibrate) -----------------

  mountCalibration() {
    const panel = document.createElement('div');
    panel.className = 'bundle-calib';
    const ranges = [
      ['offsetX', -20, 0, 0.5],
      ['offsetY', -20, 5, 0.5],
      ['scaleStep', 0, 0.15, 0.005],
      ['rotateStep', -10, 10, 0.5]
    ];
    const out = document.createElement('code');
    const sync = () => {
      out.textContent = `STACK = { offsetX: ${this.params.offsetX}, offsetY: ${this.params.offsetY}, scaleStep: ${this.params.scaleStep}, rotateStep: ${this.params.rotateStep} }`;
      this.scene.querySelectorAll('.bundle-slot').forEach((slot, i, list) => {
        slot.style.cssText = this.packStyle(list.length - 1 - i);
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

customElements.define('bundle-stage', BundleStage);
