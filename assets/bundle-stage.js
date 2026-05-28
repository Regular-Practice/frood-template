/*
  <bundle-stage> — pure 2D PNG-compositing depth-stack visualiser (Model B,
  multi-box, NO three.js).

  Renders one box "scene" per box in the draft (at least one, even when empty).
  Each scene layers, back → front:
    1. box-back   — carton interior + floor (behind the packs). Static <img>.
    2. the packs  — the MOST-RECENTLY-ADDED pack in that box is the front of the
                    stack, drawn at identity. Each older pack is the SAME
                    full-frame image translated up-left by its depth, with a lower
                    z-index, so it peeks out behind.
    3. box-front  — the low front lip (in front of the packs' bases). Static <img>.

  Scenes are cloned from a <template> in the section markup (so the box-layer
  image URLs / dimensions stay server-rendered in Liquid). The stage adds/removes
  scenes as the box count changes and lays them out in a wrapping row.

  The pack renders are authored in-scale with each other and the box (one locked
  camera, full square frame), so the stack is TRANSLATE-ONLY by default.

  `depth` = how far a pack is from the front of ITS box: 0 = newest/front,
  increasing toward the oldest at the back.

  ----------------------------------------------------------------------------
  Standalone per theme convention — communicates with <bundle-builder> only via
  `bundle:updated` on `document`:

    detail: { boxes: [[{ key, id, image }, …], …], total, remainder,
              completeBoxes, capacity, maxBoxes, isValid }

  `boxes` is chunked (last box may be partial); each pack carries its own image
  URL (resolved by <bundle-builder> from the flavour metaobject), so the stage
  needs no catalogue. Pack `key`s are unique across all boxes, so a pack that
  shifts box on removal keeps its identity (the slot moves scenes). On connect it
  dispatches `bundle:request-state` in case it upgraded after the builder's first
  emit.

  Expected markup (from sections/bundle-builder.liquid):
    <bundle-stage data-capacity>
      <div data-stage></div>                 (scenes get appended here)
      <template data-box-template>
        <div class="bundle-scene">
          <img class="bundle-box-back"> <img class="bundle-box-front">
        </div>
      </template>
    </bundle-stage>
*/

// Per-step deltas: offsetX/Y are % of the scene (negative X = left, up = negative
// Y); scaleStep/rotateStep default to 0 because the renders are authored in scale.
const STACK = { offsetX: -9.5, offsetY: 0, scaleStep: 0, rotateStep: 0 };

class BundleStage extends HTMLElement {
  connectedCallback() {
    this.capacity = parseInt(this.dataset.capacity, 10) || 4;
    this.track = this.querySelector('[data-stage]');
    this.template = this.querySelector('[data-box-template]');
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
    if (!detail || !this.track || !this.template) return;
    const boxes = detail.boxes || [];

    // Always show at least one (empty) box frame so there's something on screen.
    const frameCount = Math.max(1, boxes.length);
    this.syncScenes(frameCount);
    const scenes = [...this.track.querySelectorAll('[data-scene]')];

    // Desired placement for every pack currently in the draft, keyed by its
    // stable key: which scene it belongs to + its depth within that box.
    const desired = new Map();
    boxes.forEach((box, sceneIndex) => {
      box.forEach((pack, j) => {
        desired.set(String(pack.key), {
          sceneIndex,
          depth: box.length - 1 - j,
          image: pack.image
        });
      });
    });
    const present = new Set(desired.keys());

    // Remove slots whose pack is gone (with an exit animation).
    this.track.querySelectorAll('.bundle-slot').forEach((slot) => {
      if (present.has(slot.dataset.key)) return;
      if (slot.classList.contains('is-leaving')) return;
      this.exitSlot(slot);
    });

    // Place each present pack: create it, move it to its current box, and set
    // its depth transform. Reconciled by key so identity survives box shuffles.
    desired.forEach((target, key) => {
      const scene = scenes[target.sceneIndex];
      if (!scene) return;
      let slot = this.track.querySelector(`.bundle-slot[data-key="${key}"]`);
      if (!slot) {
        slot = this.makeSlot({ key, image: target.image });
        scene.insertBefore(slot, this.frontOf(scene));
        requestAnimationFrame(() =>
          requestAnimationFrame(() => slot.classList.remove('is-entering'))
        );
      } else if (slot.parentElement !== scene) {
        // Pack shifted to a different box (e.g. a middle pack was removed) —
        // move it; box-front must stay last so it paints over the pack bases.
        scene.insertBefore(slot, this.frontOf(scene));
      }
      slot.style.cssText = this.packStyle(target.depth);
    });
  }

  // Match the number of box scenes to `n`, cloning the template / trimming.
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

  frontOf(scene) {
    return scene.querySelector('.bundle-box-front');
  }

  exitSlot(slot) {
    slot.classList.add('is-leaving');
    const drop = () => slot.remove();
    slot.addEventListener('transitionend', drop, { once: true });
    this.leaveTimers.set(slot.dataset.key, setTimeout(drop, 240)); // fallback
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
      this.track.querySelectorAll('[data-scene]').forEach((scene) => {
        const slots = scene.querySelectorAll('.bundle-slot');
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

customElements.define('bundle-stage', BundleStage);
