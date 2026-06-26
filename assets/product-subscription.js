/**
 * Product Subscription Selector
 *
 * Native one-time / subscribe-&-save picker for the PDP, rendered by
 * snippets/product-subscription.liquid. Replaces Recharge's sealed shadow-DOM
 * widget with Frood-styled markup we control, while still driving Recharge's
 * native Shopify selling plans underneath.
 *
 * Responsibilities:
 *   - Toggle the selected-option styling (.is-selected) as the radios change.
 *   - Show/hide the delivery-frequency dropdown for subscriptions.
 *   - Write the chosen selling_plan id into the hidden <input name="selling_plan">
 *     (empty = one-time). product-form.js reads this on add-to-cart.
 *   - Update the add-to-cart button price (.buy-button-price) to reflect the
 *     selected mode/frequency.
 *
 * Scope note: subscription products in this store are single-variant (boxes),
 * so prices are read from the Liquid-rendered strings rather than reformatted
 * from cents in JS. If multi-variant subscription products are added later,
 * listen for 'product:variant-changed' and recompute prices here.
 *
 * Expected markup:
 *   <product-subscription data-onetime-money="£12.00">
 *     <fieldset class="subscription-options">
 *       <label class="subscription-option"><input type="radio" name="purchase_option" value="onetime" checked>…</label>
 *       <label class="subscription-option"><input type="radio" name="purchase_option" value="subscription">…</label>
 *     </fieldset>
 *     <div class="subscription-frequency" hidden>
 *       <select data-subscription-frequency>
 *         <option value="SELLING_PLAN_ID" data-price-money="£10.80">1 month</option>
 *       </select>
 *     </div>
 *     <input type="hidden" name="selling_plan" value="">
 *   </product-subscription>
 */

class ProductSubscription extends HTMLElement {
  connectedCallback() {
    this.frequency = this.querySelector('.subscription-frequency');
    this.frequencySelect = this.querySelector('[data-subscription-frequency]');
    this.sellingPlanInput = this.querySelector('input[name="selling_plan"]');
    this.options = this.querySelectorAll('.subscription-option');
    this.oneTimeMoney = this.dataset.onetimeMoney || '';

    this.addEventListener('change', (e) => {
      if (e.target.name === 'purchase_option' || e.target.matches('[data-subscription-frequency]')) {
        this.update();
      }
    });

    // Sync initial state (defaults to one-time).
    this.update();
  }

  get isSubscription() {
    const checked = this.querySelector('input[name="purchase_option"]:checked');
    return checked ? checked.value === 'subscription' : false;
  }

  update() {
    const isSub = this.isSubscription;

    // Selected-box styling (also handled by CSS where supported; this is the
    // reliable cross-browser source of truth).
    this.options.forEach((opt) => {
      const input = opt.querySelector('input[type="radio"]');
      opt.classList.toggle('is-selected', !!input && input.checked);
    });

    // Frequency dropdown is only relevant for subscriptions.
    if (this.frequency) this.frequency.hidden = !isSub;

    // Hidden input drives the cart POST. Empty => one-time.
    if (this.sellingPlanInput) {
      this.sellingPlanInput.value = isSub && this.frequencySelect ? this.frequencySelect.value : '';
    }

    this.updateButtonPrice(isSub);
  }

  updateButtonPrice(isSub) {
    const priceEl = document.querySelector('.buy-button-price');
    if (!priceEl) return;

    if (isSub && this.frequencySelect) {
      const opt = this.frequencySelect.selectedOptions[0];
      if (opt && opt.dataset.priceMoney) priceEl.textContent = opt.dataset.priceMoney;
    } else if (this.oneTimeMoney) {
      priceEl.textContent = this.oneTimeMoney;
    }
  }
}

customElements.define('product-subscription', ProductSubscription);
