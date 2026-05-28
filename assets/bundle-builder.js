/*
  <bundle-builder> — state + controls for the v3 "build your box" section.

  Owns ONE draft box: an ordered list of packs (one entry per pack), capped at
  `capacity` (4). Each pack carries a stable session-local `key` so the
  visualiser can keep its identity across add/remove. The newest pack is the
  front of the visual stack. Order is add-order: box[0] oldest, box[last] newest.

  Unlike the old v2 store, there is NO multi-box draft, no discount tiers, and
  no cross-page shared state — the box lives only here. When the box is full,
  "Add to cart" POSTs the single box product to the NATIVE Shopify cart with the
  chosen flavours as a line-item property, clears the draft, and fires
  `cart:item-added` (+ a success toast) exactly like product-form.js. The native
  <cart-drawer> / <cart-icon> pick that up — the bundle is never the cart.

  ----------------------------------------------------------------------------
  Expected markup (produced by sections/bundle-builder.liquid):

    <bundle-builder
      data-section-id  data-capacity="4"  data-box-variant-id
      data-i18n-add  data-i18n-add-more  data-i18n-added  data-i18n-error>

      <script type="application/json" class="bundle-flavours">
        [{ id, name, attributes, image, sku }, …]  (id = metaobject handle)
      </script>

      [data-flavour-list]
        [data-flavour-card][data-flavour-id]        (one per flavour)
          [data-qty="<id>"]                         (qty readout)
          [data-action="add"|"remove"][data-flavour-id]
      [data-add] > [data-add-label]                 (add-to-cart button)
      [data-error]                                  (inline error, role=alert)

  ----------------------------------------------------------------------------
  Event contract — dispatched on `document`:

    'bundle:updated'  detail: {
      box:      [{ key, id, image }, …],   // ordered, newest last
      counts:   { [id]: qty },
      filled:   number,
      capacity: number,
      isFull:   boolean
    }

  Emitted on every mutation and on connect. <bundle-stage> renders from it.
  The store also answers 'bundle:request-state' by re-emitting — the handshake
  for <bundle-stage>, whose module may upgrade after this one.

  localStorage: single key `frood.bundle.v3.<sectionId>` — stores flavour ids
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
    this.boxVariantId = this.dataset.boxVariantId || null;
    this.storageKey = `frood.bundle.v3.${this.dataset.sectionId || 'default'}`;
    this.keySeq = 0;

    this.flavours = this.parseFlavours();
    this.box = this.loadDraft();
    this.hasTrackedStart = this.box.length > 0;
    this.hasTrackedCompletion = this.isFull;

    this.addButton = this.querySelector('[data-add]');
    this.addLabel = this.querySelector('[data-add-label]');
    this.progressEl = this.querySelector('[data-progress]');
    this.progressFillEl = this.querySelector('[data-progress-fill]');
    this.errorEl = this.querySelector('[data-error]');

    this._onClick = (e) => this.handleClick(e);
    this.addEventListener('click', this._onClick);

    this._onRequestState = () => this.emit();
    document.addEventListener('bundle:request-state', this._onRequestState);

    this.render();
    this.emit();
    this.track('bundle_builder_viewed', {
      capacity: this.capacity,
      flavour_count: Object.keys(this.flavours).length,
      filled: this.filled,
      has_draft: this.filled > 0
    });
  }

  disconnectedCallback() {
    this.removeEventListener('click', this._onClick);
    document.removeEventListener('bundle:request-state', this._onRequestState);
  }

  // ---- Config / persistence --------------------------------------------

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
        .slice(0, this.capacity)
        .map((id) => ({ key: this.keySeq++, id }));
    } catch {
      return [];
    }
  }

  save() {
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(this.box.map((p) => p.id)));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }

  // ---- Derived ----------------------------------------------------------

  get filled() {
    return this.box.length;
  }

  get isFull() {
    return this.box.length >= this.capacity;
  }

  get counts() {
    const out = {};
    for (const p of this.box) out[p.id] = (out[p.id] || 0) + 1;
    return out;
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
    if (this.box.length >= this.capacity) return;
    const wasEmpty = this.box.length === 0;
    this.box.push({ key: this.keySeq++, id });
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
      filled: this.filled,
      capacity: this.capacity,
      composition: this.composition
    });

    if (!this.hasTrackedCompletion && this.isFull) {
      this.hasTrackedCompletion = true;
      this.track('bundle_builder_completed', {
        capacity: this.capacity,
        flavour_count: Object.keys(this.counts).length,
        composition: this.composition
      });
    }
  }

  // Removes the LAST-added pack of this flavour — drives the per-flavour stepper.
  remove(id) {
    let removed = false;
    for (let i = this.box.length - 1; i >= 0; i--) {
      if (this.box[i].id === id) {
        this.box.splice(i, 1);
        removed = true;
        break;
      }
    }
    this.commit();

    if (removed) {
      this.track('bundle_pack_removed', {
        flavour_id: id,
        flavour_name: this.flavours[id]?.name || '',
        filled: this.filled,
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
          box: this.box.map((p) => ({
            key: p.key,
            id: p.id,
            image: this.flavours[p.id]?.image || ''
          })),
          counts: this.counts,
          filled: this.filled,
          capacity: this.capacity,
          isFull: this.isFull
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
        filled: this.filled,
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
    const atCap = this.isFull;

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

    if (this.addButton) this.addButton.disabled = !atCap || !this.boxVariantId;
    if (this.addLabel) {
      this.addLabel.textContent = this.dataset.i18nAdd || 'Add to cart';
    }
    if (this.progressFillEl) {
      const pct = Math.min(100, (this.filled / this.capacity) * 100);
      this.progressFillEl.style.width = `${pct}%`;
    }
    if (this.progressEl) {
      this.progressEl.setAttribute('aria-valuenow', String(this.filled));
    }
  }

  // ---- Add to cart (native Shopify cart) --------------------------------

  // Builds the line-item properties for the box, ordered by the flavour list:
  //
  //   • One VISIBLE entry per flavour (key = flavour name, value = "× N") so the
  //     cart drawer, cart page, and native checkout all show a readable
  //     per-flavour list with no string parsing.
  //   • One HIDDEN `_bundle` entry — the leading underscore tells Shopify to
  //     keep it off the customer-facing cart/checkout while still saving it on
  //     the order. It carries handle + name + qty + sku per flavour as JSON,
  //     the machine-readable payload for fulfilment / reconstruction.
  buildProperties() {
    const counts = this.counts;
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
    if (!this.isFull || !this.boxVariantId) {
      this.track('bundle_add_validation_failed', {
        reason: this.isFull ? 'missing_box_variant' : 'not_full',
        filled: this.filled,
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

    const item = {
      id: parseInt(this.boxVariantId, 10),
      quantity: 1,
      properties: this.buildProperties()
    };

    try {
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ items: [item], sections: ['cart-drawer'] })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.description || this.dataset.i18nError || 'Could not add to cart');
      }

      const data = await response.json();

      this.track('bundle_added_to_cart', {
        capacity: this.capacity,
        flavour_count: trackedFlavourCount,
        composition: trackedComposition
      });

      // Box is now in the native cart — drop the local draft so returning to
      // the page doesn't re-add it.
      this.box = [];
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
        filled: this.filled,
        capacity: this.capacity,
        composition: trackedComposition
      });
      this.showError(error.message);
    } finally {
      this.addButton.classList.remove('is-loading');
      this.addButton.disabled = !this.isFull || !this.boxVariantId;
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
