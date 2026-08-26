/*
  <bundle-v2-builder> — state + controls for the "build your box" section.

  Owns ONE flat, ordered list of packs (`this.packs` — one entry per pack). The
  shopper mixes flavours freely via the per-flavour steppers. There is NO upper
  limit and NO box quantum: packs are priced and sold INDIVIDUALLY, subject only
  to an order minimum (`minPacks`, 6). Each pack carries a stable session-local
  `key` so the visualiser can keep its identity across add/remove; the newest pack
  is the front of the visual fan.

  "Add to cart" is gated on meeting the minimum. When valid the whole draft goes
  to the NATIVE Shopify cart as ONE "Build Your Box" line item with quantity =
  the pack count and the chosen flavours as line-item properties. It then clears
  the draft and fires `cart:item-added` (+ a success toast) exactly like
  product-form.js — the native <cart-drawer> / <cart-icon> pick that up (drawer
  does NOT auto-open). The bundle is never the cart.

  PRICING is per pack: the box product's variant price is the SINGLE-PACK price,
  and quantity carries the total. (Until 2026-08-26 the product was priced per box
  of 6 and the section split the draft into one line per full box — if the product
  price ever reverts to a box price, this all has to change with it.)

  ----------------------------------------------------------------------------
  Expected markup (produced by sections/bundle-v2-builder.liquid):

    <bundle-v2-builder
      data-section-id  data-min-packs="6"  data-box-variant-id
      data-i18n-add  data-i18n-add-more  data-i18n-added  data-i18n-error>

      <script type="application/json" class="bundle-v2-flavours">
        [{ id, name, attributes, image, sku }, …]  (id = metaobject handle)
      </script>

      [data-flavour-list]
        [data-flavour-card][data-flavour-id]        (one per flavour)
          [data-qty="<id>"]                         (qty readout)
          [data-action="add"|"remove"][data-flavour-id]
      [data-add] > [data-add-label]                 (add-to-cart button)
      [data-hint]                                   (minimum-order hint)
      [data-error]                                  (inline error, role=alert)

  ----------------------------------------------------------------------------
  Event contract — dispatched on `document`:

    'bundle-v2:updated'  detail: {
      packs:    [{ key, id, image }, …],       // flat, in add order
      counts:   { [id]: qty },                 // totals per flavour
      total:    number,                        // total packs
      shortfall:number,                        // packs still needed to hit the minimum
      minPacks: number,                        // order minimum (6)
      isValid:  boolean                        // shortfall === 0
    }

  Emitted on every mutation and on connect. <bundle-v2-stage> renders from it.
  The store also answers 'bundle-v2:request-state' by re-emitting — the handshake
  for <bundle-v2-stage>, whose module may upgrade after this one.

  localStorage: single key `frood.bundle-v2.v4.<sectionId>` — stores flavour ids
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

// Shopify money formatter — formats an amount in cents using the shop's
// money_format string (e.g. "£{{amount}}"). Mirrors Shopify's reference impl
// so totals match the server-rendered `| money` output. (Same as
// product-subscription.js; duplicated as this is a self-contained module.)
function formatMoney(cents, format) {
  if (typeof cents === 'string') cents = cents.replace('.', '');
  const placeholderRegex = /\{\{\s*(\w+)\s*\}\}/;
  const formatString = format || '${{amount}}';

  function withDelimiters(number, precision, thousands, decimal) {
    precision = precision == null ? 2 : precision;
    thousands = thousands == null ? ',' : thousands;
    decimal = decimal == null ? '.' : decimal;
    if (isNaN(number) || number == null) return '0';
    number = (number / 100.0).toFixed(precision);
    const parts = number.split('.');
    const dollars = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + thousands);
    const centsPart = parts[1] ? decimal + parts[1] : '';
    return dollars + centsPart;
  }

  let value = '';
  switch ((formatString.match(placeholderRegex) || [])[1]) {
    case 'amount': value = withDelimiters(cents, 2); break;
    case 'amount_no_decimals': value = withDelimiters(cents, 0); break;
    case 'amount_with_comma_separator': value = withDelimiters(cents, 2, '.', ','); break;
    case 'amount_with_space_separator': value = withDelimiters(cents, 2, ' ', ','); break;
    case 'amount_no_decimals_with_comma_separator': value = withDelimiters(cents, 0, '.', ','); break;
    case 'amount_no_decimals_with_space_separator': value = withDelimiters(cents, 0, ' '); break;
    default: value = withDelimiters(cents, 2);
  }
  return formatString.replace(placeholderRegex, value);
}

class BundleV2Builder extends HTMLElement {
  connectedCallback() {
    this.minPacks = parseInt(this.dataset.minPacks, 10) || 6;
    this.boxVariantId = this.dataset.boxVariantId || null;
    this.storageKey = `frood.bundle-v2.v4.${this.dataset.sectionId || 'default'}`;
    this.keySeq = 0;

    this.flavours = this.parseFlavours();
    this.packs = this.loadDraft();
    this.hasTrackedStart = this.total > 0;
    this.hasTrackedCompletion = this.isValid;

    this.addButton = this.querySelector('[data-add]');
    this.addLabel = this.querySelector('[data-add-label]');
    this.progressEl = this.querySelector('[data-progress]');
    this.progressFillEl = this.querySelector('[data-progress-fill]');
    this.hintEl = this.querySelector('[data-hint]');
    this.errorEl = this.querySelector('[data-error]');

    // Subscription control — only present if the box product has selling plans.
    this.subModeInputs = this.querySelectorAll('[data-sub-mode]');
    this.subFrequency = this.querySelector('[data-sub-frequency]');
    this.subSelect = this.querySelector('[data-sub-select]');
    this.addPriceEl = this.querySelector('.bundle-v2-add-price');
    this.addWasEl = this.querySelector('[data-add-was]');
    this.boxPriceCents = parseInt(this.dataset.boxPriceCents, 10);
    this.moneyFormat = this.dataset.moneyFormat || '';

    // Needs both the flavour list and [data-sub-select], so it runs after both.
    this.pruneFrequencies();

    this._onClick = (e) => this.handleClick(e);
    this.addEventListener('click', this._onClick);

    this._onChange = (e) => {
      if (e.target.matches('[data-sub-mode]') || e.target.matches('[data-sub-select]')) {
        this.updateSubscription();
      }
    };
    this.addEventListener('change', this._onChange);

    this._onRequestState = () => this.emit();
    document.addEventListener('bundle-v2:request-state', this._onRequestState);

    this.render();
    this.emit();
    this.track('bundle_builder_viewed', {
      min_packs: this.minPacks,
      flavour_count: Object.keys(this.flavours).length,
      filled: this.total,
      has_draft: this.total > 0
    });
  }

  disconnectedCallback() {
    this.removeEventListener('click', this._onClick);
    this.removeEventListener('change', this._onChange);
    document.removeEventListener('bundle-v2:request-state', this._onRequestState);
  }

  // ---- Config / persistence --------------------------------------------

  parseFlavours() {
    const map = {};
    const blob = this.querySelector('.bundle-v2-flavours');
    if (!blob) return map;
    try {
      for (const f of JSON.parse(blob.textContent)) {
        if (f && f.id != null) map[String(f.id)] = f;
      }
    } catch (err) {
      console.error('[bundle-v2-builder] failed to parse flavours blob:', err);
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

  // Packs still needed to reach the order minimum (0 once it's met).
  get shortfall() {
    return Math.max(0, this.minPacks - this.total);
  }

  // Packs are priced and sold INDIVIDUALLY — there is no box quantum. The only
  // constraint is the order minimum, so any total at or above it is valid.
  get isValid() {
    return this.shortfall === 0;
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
    const wasEmpty = this.total === 0;
    this.packs.push({ key: this.keySeq++, id });
    this.commit();

    if (!this.hasTrackedStart && wasEmpty) {
      this.hasTrackedStart = true;
      this.track('bundle_builder_started', {
        min_packs: this.minPacks
      });
    }

    this.track('bundle_pack_added', {
      flavour_id: id,
      flavour_name: this.flavours[id]?.name || '',
      filled: this.total,
      min_packs: this.minPacks,
      composition: this.composition
    });

    if (!this.hasTrackedCompletion && this.isValid) {
      this.hasTrackedCompletion = true;
      this.track('bundle_builder_completed', {
        min_packs: this.minPacks,
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
        min_packs: this.minPacks,
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
      new CustomEvent('bundle-v2:updated', {
        detail: {
          packs: this.packs.map((p) => ({
            key: p.key,
            id: p.id,
            image: this.flavours[p.id]?.image || ''
          })),
          counts: this.counts,
          total: this.total,
          shortfall: this.shortfall,
          minPacks: this.minPacks,
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

    const flavourLink = e.target.closest('.bundle-v2-flavour-link');
    if (flavourLink && this.contains(flavourLink)) {
      const card = flavourLink.closest('[data-flavour-card]');
      const id = card?.dataset.flavourId || '';
      this.track('bundle_flavour_link_clicked', {
        flavour_id: id,
        flavour_name: this.flavours[id]?.name || '',
        filled: this.total,
        min_packs: this.minPacks
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

    this.querySelectorAll('[data-flavour-card]').forEach((card) => {
      const id = card.dataset.flavourId;
      const qty = counts[id] || 0;
      const qtyEl = card.querySelector('[data-qty]');
      if (qtyEl) qtyEl.textContent = qty;
      card.classList.toggle('is-active', qty > 0);
      const addBtn = card.querySelector('[data-action="add"]');
      const removeBtn = card.querySelector('[data-action="remove"]');
      if (removeBtn) removeBtn.disabled = qty === 0;
    });

    if (this.addButton) this.addButton.disabled = !this.isValid || !this.hasVariants;
    if (this.addLabel) this.addLabel.textContent = this.dataset.i18nAdd || 'Add to cart';

    // Hint counts the shopper up to the order minimum, then goes quiet — above
    // it any quantity is addable, so there is nothing left to nudge toward.
    if (this.hintEl) {
      if (this.shortfall > 0) {
        const tmpl = this.dataset.i18nAddMore || 'Add {count} more';
        this.hintEl.textContent = tmpl.replace('{count}', String(this.shortfall));
      } else {
        this.hintEl.textContent = '';
      }
    }

    // Progress bar fills toward the minimum and then stays full.
    if (this.progressFillEl) {
      this.progressFillEl.style.width = `${Math.min(100, (this.total / this.minPacks) * 100)}%`;
    }
    if (this.progressEl) {
      this.progressEl.classList.toggle('is-complete', this.isValid);
      this.progressEl.setAttribute('aria-valuenow', String(Math.min(this.total, this.minPacks)));
    }

    this.updateSubscription();
    this.updateAddPrice();
  }

  // ---- Subscription -----------------------------------------------------

  get isSubscription() {
    const checked = this.querySelector('[data-sub-mode]:checked');
    return checked ? checked.value === 'subscription' : false;
  }

  // The chosen selling_plan id when subscribing, else null (one-time).
  // The chosen frequency, identified by plan NAME. Ids are per-variant and can
  // differ between blends, so the name is the only key that maps across them.
  get planName() {
    if (!this.isSubscription || !this.subSelect) return null;
    return this.subSelect.value || null;
  }

  // That frequency's plan ON A GIVEN BLEND — its own id, its own prices.
  planFor(flavourId) {
    const name = this.planName;
    if (!name) return null;
    return this.flavours[flavourId]?.plans?.find((p) => p.name === name) || null;
  }

  // Frequencies every blend in the draft actually offers. A plan missing from one
  // blend can't be used, because that line would have no valid id — so it's
  // dropped from the dropdown rather than failing at add-to-cart.
  commonPlanNames() {
    const ids = Object.keys(this.flavours);
    if (!ids.length) return [];
    const lists = ids.map((id) => (this.flavours[id].plans || []).map((p) => p.name));
    if (lists.some((l) => !l.length)) return [];
    return lists[0].filter((name) => lists.every((l) => l.includes(name)));
  }

  // Prune frequencies not shared by every blend. Runs once on connect — the
  // flavour list is fixed for the life of the section.
  pruneFrequencies() {
    if (!this.subSelect) return;
    const common = this.commonPlanNames();
    for (const option of [...this.subSelect.options]) {
      if (!common.includes(option.value)) option.remove();
    }
    // Nothing shared: subscriptions aren't offerable for this mix at all.
    if (!this.subSelect.options.length) {
      this.querySelector('[data-subscription]')?.setAttribute('hidden', '');
    }
  }

  // Toggles selected styling and shows/hides the frequency dropdown. No-op when
  // the box product has no plans (control not rendered).
  updateSubscription() {
    if (!this.subModeInputs || this.subModeInputs.length === 0) return;
    const isSub = this.isSubscription;

    this.querySelectorAll('.bundle-v2-sub-option').forEach((opt) => {
      const input = opt.querySelector('input[type="radio"]');
      opt.classList.toggle('is-selected', !!input && input.checked);
    });

    if (this.subFrequency) this.subFrequency.hidden = !isSub;
  }

  // Add-button price = the sum of the blend lines. An empty draft previews the
  // minimum order at the cheapest blend rather than £0. Subscriptions show the
  // discounted total plus the struck-through original.
  updateAddPrice() {
    if (!this.addPriceEl) return;
    const fullCents = this.draftCents();
    if (fullCents == null) return;

    // Each blend carries its own plan price, so a subscription total is summed
    // per blend rather than derived from one rate.
    const subCents = this.isSubscription ? this.draftCents({ subscription: true }) : null;
    const showCents = subCents == null ? fullCents : subCents;

    this.addPriceEl.textContent = formatMoney(showCents, this.moneyFormat);

    if (this.addWasEl) {
      const showWas = subCents != null && subCents < fullCents;
      this.addWasEl.textContent = showWas ? formatMoney(fullCents, this.moneyFormat) : '';
      this.addWasEl.hidden = !showWas;
    }
  }

  // Summed price of the draft, from each blend's own variant price. An empty
  // draft previews the minimum order at the cheapest available blend, so the
  // button reads as a starting price rather than £0.
  draftCents({ subscription = false } = {}) {
    const priceOf = (id) => {
      if (subscription) {
        const plan = this.planFor(id);
        return plan ? plan.priceCents : undefined;
      }
      return this.flavours[id]?.priceCents;
    };
    if (this.total === 0) {
      const prices = Object.keys(this.flavours)
        .map(priceOf)
        .filter((c) => typeof c === 'number');
      if (!prices.length) return null;
      return Math.min(...prices) * this.minPacks;
    }
    let cents = 0;
    for (const [id, qty] of Object.entries(this.counts)) {
      const unit = priceOf(id);
      if (typeof unit !== 'number') return null;
      cents += unit * qty;
    }
    return cents;
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

  // ONE cart line PER BLEND — the blends are the products now, and the custom
  // box is a line-item property on each of them. The box product itself is no
  // longer purchased.
  //
  // Every line carries the same visible property, so:
  //   - the cart can collect them into one block by looking for it
  //   - Shopify merges repeat adds of the same blend into one line, which is
  //     what "you only get one custom box" should mean
  //   - a blend bought outside a box never merges with a box line
  //
  // Superseded two earlier shapes: one line per full box of 6, then a single
  // box line carrying the flavours as text.
  buildItems() {
    const key = this.dataset.boxPropertyKey || 'Part of';
    const value = this.dataset.boxPropertyValue || 'Custom Box';
    const items = [];
    for (const [id, qty] of Object.entries(this.counts)) {
      const flavour = this.flavours[id];
      if (!qty || !flavour?.variantId) continue;
      const item = {
        id: flavour.variantId,
        quantity: qty,
        properties: {
          // Visible: carries through cart, checkout and the order confirmation.
          [key]: value,
          // Hidden. `_custom_box` is the STABLE grouping key the cart matches on —
          // the visible pair above is translated, so it can't be relied on. The
          // other two carry the display, because a cart line has no route back to
          // its flavour metaobject: shop.metaobjects isn't exposed to the
          // storefront here, and the blend product knows nothing about flavours.
          _custom_box: '1',
          _flavour_name: flavour.name || '',
          _flavour_colour: flavour.colour || ''
        }
      };
      const plan = this.planFor(id);
      if (plan) item.selling_plan = plan.id;
      items.push(item);
    }
    return items;
  }

  // Every flavour in the draft has to resolve to a purchasable variant, or the
  // add would silently drop packs the shopper chose.
  get hasVariants() {
    return Object.keys(this.counts).every((id) => this.flavours[id]?.variantId);
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
    if (!this.isValid || !this.hasVariants) {
      this.track('bundle_add_validation_failed', {
        reason: this.isValid ? 'missing_variant' : 'incomplete',
        filled: this.total,
        min_packs: this.minPacks,
        composition: this.composition
      });
      return;
    }

    this.clearError();
    this.addButton.classList.add('is-loading');
    this.addButton.disabled = true;
    const trackedComposition = this.composition;
    const trackedFlavourCount = Object.keys(this.counts).length;

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
        min_packs: this.minPacks,
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
        min_packs: this.minPacks,
        composition: trackedComposition
      });
      this.showError(error.message);
    } finally {
      this.addButton.classList.remove('is-loading');
      this.addButton.disabled = !this.isValid || !this.hasVariants;
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

customElements.define('bundle-v2-builder', BundleV2Builder);
