/*
  <bundle-builder> — state + controls for the "build your box" section (Model B,
  multi-box).

  Owns ONE flat, ordered list of packs (`this.packs` — one entry per pack), capped
  at `maxBoxes × capacity`. The shopper mixes flavours freely via the per-flavour
  steppers; the packs are auto-chunked into boxes of `capacity` (4) in ADD ORDER:
  packs[0..3] = box 1, packs[4..7] = box 2, … The last chunk may be partial (the
  in-progress box). Each pack carries a stable session-local `key` so the
  visualiser can keep its identity across add/remove. Within a box the newest pack
  is the front of the visual stack.

  "Add to cart" is gated on a VALID selection — at least one pack and the total
  divisible by `capacity` (no half-built box). When valid, every complete box is
  POSTed to the NATIVE Shopify cart as its own "Build Your Box" line item with the
  chosen flavours as line-item properties; boxes with an identical flavour mix are
  merged into one line with quantity N. It then clears the draft and fires
  `cart:item-added` (+ a success toast) exactly like product-form.js — the native
  <cart-drawer> / <cart-icon> pick that up (drawer does NOT auto-open). The bundle
  is never the cart.

  ----------------------------------------------------------------------------
  Expected markup (produced by sections/bundle-builder.liquid):

    <bundle-builder
      data-section-id  data-capacity="4"  data-max-boxes="6"  data-box-variant-id
      data-i18n-add  data-i18n-add-more  data-i18n-added  data-i18n-error>

      <script type="application/json" class="bundle-flavours">
        [{ id, name, attributes, image, sku }, …]  (id = metaobject handle)
      </script>

      [data-flavour-list]
        [data-flavour-card][data-flavour-id]        (one per flavour)
          [data-qty="<id>"]                         (qty readout)
          [data-action="add"|"remove"][data-flavour-id]
      [data-add] > [data-add-label]                 (add-to-cart button)
                 > [data-add-multiplier]            (× N boxes multiplier)
      [data-hint]                                   (build-progress hint)
      [data-error]                                  (inline error, role=alert)

  ----------------------------------------------------------------------------
  Event contract — dispatched on `document`:

    'bundle:updated'  detail: {
      boxes:    [[{ key, id, image }, …], …],  // chunked, last may be partial
      counts:   { [id]: qty },                 // totals across all packs
      total:    number,                        // total packs
      remainder:number,                        // packs in the in-progress box
      completeBoxes: number,                   // full boxes
      capacity: number,                        // packs per box (4)
      maxBoxes: number,
      isValid:  boolean                        // total > 0 && remainder === 0
    }

  Emitted on every mutation and on connect. <bundle-stage> renders from it.
  The store also answers 'bundle:request-state' by re-emitting — the handshake
  for <bundle-stage>, whose module may upgrade after this one.

  localStorage: single key `frood.bundle.v4.<sectionId>` — stores flavour ids
  only (keys are ephemeral). Filtered to known flavours + capped on load.
*/

// Size a Shopify CDN image URL for the 30×30 toast thumbnail (2× = 60px).
// Inlined rather than imported from toast.js so this module never depends on a
// toast.js export — keeps add-to-cart resilient to a stale cached toast.js.
// Same helper as product-form.js / product-card-quick-add.js.
function toastThumb(url, size = 60) {
  if (!url) return undefined;
  return `${url}${url.includes('?') ? '&' : '?'}width=${size}`;
}

class BundleBuilder extends HTMLElement {
  connectedCallback() {
    this.capacity = parseInt(this.dataset.capacity, 10) || 4;
    this.maxBoxes = parseInt(this.dataset.maxBoxes, 10) || 4;
    this.boxVariantId = this.dataset.boxVariantId || null;
    this.storageKey = `frood.bundle.v4.${this.dataset.sectionId || 'default'}`;
    this.keySeq = 0;

    this.flavours = this.parseFlavours();
    this.packs = this.loadDraft();
    this.hasTrackedStart = this.total > 0;
    this.hasTrackedCompletion = this.isValid;

    this.addButton = this.querySelector('[data-add]');
    this.addLabel = this.querySelector('[data-add-label]');
    this.addMultiplier = this.querySelector('[data-add-multiplier]');
    this.progressEl = this.querySelector('[data-progress]');
    this.progressFillEl = this.querySelector('[data-progress-fill]');
    this.hintEl = this.querySelector('[data-hint]');
    this.errorEl = this.querySelector('[data-error]');

    this._onClick = (e) => this.handleClick(e);
    this.addEventListener('click', this._onClick);

    this._onRequestState = () => this.emit();
    document.addEventListener('bundle:request-state', this._onRequestState);

    this.render();
    this.emit();
    this.track('bundle_builder_viewed', {
      capacity: this.capacity,
      max_boxes: this.maxBoxes,
      flavour_count: Object.keys(this.flavours).length,
      filled: this.total,
      has_draft: this.total > 0
    });
  }

  disconnectedCallback() {
    this.removeEventListener('click', this._onClick);
    document.removeEventListener('bundle:request-state', this._onRequestState);
  }

  // ---- Config / persistence --------------------------------------------

  get cap() {
    return this.maxBoxes * this.capacity;
  }

  parseFlavours() {
    const map = {};
    const blob = this.querySelector('.bundle-flavours');
    if (!blob) return map;
    try {
      for (const f of JSON.parse(blob.textContent)) {
        if (f && f.id != null) map[String(f.id)] = f;
      }
    } catch (err) {
      console.error('[bundle-builder] failed to parse flavours blob:', err);
    }
    return map;
  }

  loadDraft() {
    let raw;
    try {
      raw = window.localStorage.getItem(this.storageKey);
    } catch {
      return [];
    }
    if (!raw) return [];
    try {
      const ids = JSON.parse(raw);
      if (!Array.isArray(ids)) return [];
      return ids
        .filter((id) => typeof id === 'string' && this.flavours[id])
        .slice(0, this.cap)
        .map((id) => ({ key: this.keySeq++, id }));
    } catch {
      return [];
    }
  }

  save() {
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(this.packs.map((p) => p.id)));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }

  // ---- Derived ----------------------------------------------------------

  get total() {
    return this.packs.length;
  }

  // Packs chunked into boxes of `capacity`, in add order. The last chunk may be
  // partial (the in-progress box). Drives both the visualiser and the cart.
  get boxes() {
    const out = [];
    for (let i = 0; i < this.packs.length; i += this.capacity) {
      out.push(this.packs.slice(i, i + this.capacity));
    }
    return out;
  }

  get completeBoxes() {
    return Math.floor(this.total / this.capacity);
  }

  // Packs sitting in the not-yet-full box (0 when the total divides cleanly).
  get remainder() {
    return this.total % this.capacity;
  }

  get isValid() {
    return this.total > 0 && this.remainder === 0;
  }

  get atCap() {
    return this.total >= this.cap;
  }

  countsFor(packs) {
    const out = {};
    for (const p of packs) out[p.id] = (out[p.id] || 0) + 1;
    return out;
  }

  get counts() {
    return this.countsFor(this.packs);
  }

  get composition() {
    const counts = this.counts;
    return Object.keys(this.flavours)
      .filter((id) => counts[id])
      .map((id) => `${id}:${counts[id]}`)
      .join('|');
  }

  track(eventName, data = {}) {
    const payload = {
      section_id: this.dataset.sectionId || 'default',
      box_variant_id: this.boxVariantId || '',
      ...data
    };

    if (window.froodTrack) {
      window.froodTrack(eventName, payload);
      return;
    }

    if (window.umami?.track) {
      window.umami.track(eventName, payload);
    }

    if (new URLSearchParams(window.location.search).has('umami-debug')) {
      console.info('[umami]', eventName, payload);
    }
  }

  // ---- Mutations --------------------------------------------------------

  add(id) {
    if (!this.flavours[id]) return;
    if (this.atCap) return;
    const wasEmpty = this.total === 0;
    this.packs.push({ key: this.keySeq++, id });
    this.commit();

    if (!this.hasTrackedStart && wasEmpty) {
      this.hasTrackedStart = true;
      this.track('bundle_builder_started', {
        capacity: this.capacity
      });
    }

    this.track('bundle_pack_added', {
      flavour_id: id,
      flavour_name: this.flavours[id]?.name || '',
      filled: this.total,
      capacity: this.capacity,
      composition: this.composition
    });

    if (!this.hasTrackedCompletion && this.isValid) {
      this.hasTrackedCompletion = true;
      this.track('bundle_builder_completed', {
        capacity: this.capacity,
        complete_boxes: this.completeBoxes,
        flavour_count: Object.keys(this.counts).length,
        composition: this.composition
      });
    }
  }

  // Removes the LAST-added pack of this flavour — drives the per-flavour stepper.
  remove(id) {
    let removed = false;
    for (let i = this.packs.length - 1; i >= 0; i--) {
      if (this.packs[i].id === id) {
        this.packs.splice(i, 1);
        removed = true;
        break;
      }
    }
    this.commit();

    if (removed) {
      this.track('bundle_pack_removed', {
        flavour_id: id,
        flavour_name: this.flavours[id]?.name || '',
        filled: this.total,
        capacity: this.capacity,
        composition: this.composition
      });
    }
  }

  commit() {
    this.save();
    this.render();
    this.emit();
  }

  emit() {
    document.dispatchEvent(
      new CustomEvent('bundle:updated', {
        detail: {
          boxes: this.boxes.map((box) =>
            box.map((p) => ({
              key: p.key,
              id: p.id,
              image: this.flavours[p.id]?.image || ''
            }))
          ),
          counts: this.counts,
          total: this.total,
          remainder: this.remainder,
          completeBoxes: this.completeBoxes,
          capacity: this.capacity,
          maxBoxes: this.maxBoxes,
          isValid: this.isValid
        }
      })
    );
  }

  // ---- Events -----------------------------------------------------------

  handleClick(e) {
    const trigger = e.target.closest('[data-action]');
    if (trigger && this.contains(trigger)) {
      const { action, flavourId } = trigger.dataset;
      if (action === 'add') this.add(flavourId);
      else if (action === 'remove') this.remove(flavourId);
      return;
    }

    const flavourLink = e.target.closest('.bundle-flavour-link');
    if (flavourLink && this.contains(flavourLink)) {
      const card = flavourLink.closest('[data-flavour-card]');
      const id = card?.dataset.flavourId || '';
      this.track('bundle_flavour_link_clicked', {
        flavour_id: id,
        flavour_name: this.flavours[id]?.name || '',
        filled: this.total,
        capacity: this.capacity
      });
      return;
    }

    if (e.target.closest('[data-add]')) {
      this.addToCart();
    }
  }

  // ---- Rendering --------------------------------------------------------

  render() {
    const counts = this.counts;
    const atCap = this.atCap;

    this.querySelectorAll('[data-flavour-card]').forEach((card) => {
      const id = card.dataset.flavourId;
      const qty = counts[id] || 0;
      const qtyEl = card.querySelector('[data-qty]');
      if (qtyEl) qtyEl.textContent = qty;
      card.classList.toggle('is-active', qty > 0);
      const addBtn = card.querySelector('[data-action="add"]');
      const removeBtn = card.querySelector('[data-action="remove"]');
      if (addBtn) addBtn.disabled = atCap;
      if (removeBtn) removeBtn.disabled = qty === 0;
    });

    if (this.addButton) this.addButton.disabled = !this.isValid || !this.boxVariantId;
    if (this.addLabel) this.addLabel.textContent = this.dataset.i18nAdd || 'Add to cart';

    // × N multiplier next to the unit price — only when the order is a valid
    // multi-box selection (no JS currency formatting; cart shows the real total).
    if (this.addMultiplier) {
      const show = this.isValid && this.completeBoxes > 1;
      this.addMultiplier.textContent = show ? `× ${this.completeBoxes}` : '';
      this.addMultiplier.hidden = !show;
    }

    // Hint nudges the shopper to finish the in-progress box.
    if (this.hintEl) {
      if (this.remainder > 0) {
        const tmpl = this.dataset.i18nAddMore || 'Add {count} more';
        this.hintEl.textContent = tmpl.replace('{count}', String(this.capacity - this.remainder));
      } else {
        this.hintEl.textContent = '';
      }
    }

    // Progress bar tracks the in-progress box (full + "complete" when valid).
    if (this.progressFillEl) {
      const pct = this.isValid ? 100 : (this.remainder / this.capacity) * 100;
      this.progressFillEl.style.width = `${pct}%`;
    }
    if (this.progressEl) {
      this.progressEl.classList.toggle('is-complete', this.isValid);
      this.progressEl.setAttribute(
        'aria-valuenow',
        String(this.isValid ? this.capacity : this.remainder)
      );
    }
  }

  // ---- Add to cart (native Shopify cart) --------------------------------

  // Builds the line-item properties for one box from its per-flavour counts,
  // ordered by the flavour list:
  //
  //   • One VISIBLE entry per flavour (key = flavour name, value = "× N") so the
  //     cart drawer, cart page, and native checkout all show a readable
  //     per-flavour list with no string parsing.
  //   • One HIDDEN `_bundle` entry — the leading underscore tells Shopify to
  //     keep it off the customer-facing cart/checkout while still saving it on
  //     the order. It carries handle + name + qty + sku per flavour as JSON,
  //     the machine-readable payload for fulfilment / reconstruction.
  buildProperties(counts) {
    const properties = {};
    const structured = [];
    for (const id of Object.keys(this.flavours)) {
      const qty = counts[id];
      if (!qty) continue;
      const flavour = this.flavours[id];
      properties[flavour.name] = `× ${qty}`;
      structured.push({ handle: id, name: flavour.name, qty, sku: flavour.sku || '' });
    }
    properties._bundle = JSON.stringify(structured);
    return properties;
  }

  // One cart item per DISTINCT box composition; identical mixes merge to qty N.
  buildItems() {
    const variantId = parseInt(this.boxVariantId, 10);
    const merged = new Map();
    for (const box of this.boxes) {
      if (box.length !== this.capacity) continue; // skip a partial box (shouldn't exist when valid)
      const counts = this.countsFor(box);
      const sig = JSON.stringify(
        Object.keys(counts)
          .sort()
          .map((id) => [id, counts[id]])
      );
      const existing = merged.get(sig);
      if (existing) {
        existing.quantity += 1;
      } else {
        merged.set(sig, { id: variantId, quantity: 1, properties: this.buildProperties(counts) });
      }
    }
    return [...merged.values()];
  }

  addFailureReason(message = '') {
    const lower = message.toLowerCase();
    if (lower.includes('sold') || lower.includes('stock') || lower.includes('available')) {
      return 'out_of_stock';
    }
    if (lower.includes('network') || lower.includes('fetch')) {
      return 'network_error';
    }
    if (message) {
      return 'shopify_error';
    }
    return 'unknown';
  }

  async addToCart() {
    if (!this.isValid || !this.boxVariantId) {
      this.track('bundle_add_validation_failed', {
        reason: this.isValid ? 'missing_box_variant' : 'incomplete',
        filled: this.total,
        capacity: this.capacity,
        composition: this.composition
      });
      return;
    }

    this.clearError();
    this.addButton.classList.add('is-loading');
    this.addButton.disabled = true;
    const trackedComposition = this.composition;
    const trackedFlavourCount = Object.keys(this.counts).length;
    const trackedCompleteBoxes = this.completeBoxes;

    const items = this.buildItems();

    try {
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ items, sections: ['cart-drawer'] })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.description || this.dataset.i18nError || 'Could not add to cart');
      }

      const data = await response.json();

      this.track('bundle_added_to_cart', {
        capacity: this.capacity,
        complete_boxes: trackedCompleteBoxes,
        flavour_count: trackedFlavourCount,
        composition: trackedComposition
      });

      // Boxes are now in the native cart — drop the local draft so returning to
      // the page doesn't re-add them.
      this.packs = [];
      this.hasTrackedStart = false;
      this.hasTrackedCompletion = false;
      this.save();
      this.render();
      this.emit();

      // Same contract as product-form.js: refresh the drawer from the bundled
      // section, then page-redirect or success-toast per the cart-type pref.
      document.dispatchEvent(
        new CustomEvent('cart:item-added', { detail: { sections: data.sections } })
      );

      if (document.body.dataset.cartType === 'page') {
        window.location.href = '/cart';
      } else {
        document.dispatchEvent(
          new CustomEvent('toast:show', {
            detail: {
              message: this.dataset.i18nAdded || 'Box added to cart',
              variant: 'success',
              image: toastThumb(data.items?.[0]?.image)
            }
          })
        );
      }
    } catch (error) {
      this.track('bundle_add_failed', {
        reason: this.addFailureReason(error.message),
        filled: this.total,
        capacity: this.capacity,
        composition: trackedComposition
      });
      this.showError(error.message);
    } finally {
      this.addButton.classList.remove('is-loading');
      this.addButton.disabled = !this.isValid || !this.boxVariantId;
    }
  }

  showError(message) {
    if (!this.errorEl) return;
    this.errorEl.textContent = message;
    this.errorEl.hidden = false;
  }

  clearError() {
    if (!this.errorEl) return;
    this.errorEl.textContent = '';
    this.errorEl.hidden = true;
  }
}

customElements.define('bundle-builder', BundleBuilder);
