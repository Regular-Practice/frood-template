/**
 * Product Subscription Selector
 *
 * Native one-time / subscribe-&-save picker for the PDP, rendered by
 * snippets/product-subscription.liquid. Replaces Recharge's sealed shadow-DOM
 * widget with Frood-styled markup we control, while still driving Recharge's
 * native Shopify selling plans underneath.
 *
 * Responsibilities:
 *   - Gate the subscription option: it only appears when the PDP quantity is at
 *     or above data-min-subscription-qty (Frood: subscribe only at 2+ boxes).
 *   - Toggle the selected-option styling and show/hide the frequency dropdown.
 *   - Write the chosen selling_plan id into <input name="selling_plan"> (empty =
 *     one-time). product-form.js reads this on add-to-cart.
 *   - Keep the add-to-cart button price (.buy-button-price) in sync with the
 *     selected mode/frequency AND the quantity: total = unit price × quantity.
 *
 * Scope note: subscription products in this store are single-variant (boxes),
 * so unit prices are read from data-*-cents attributes rendered by Liquid and
 * formatted client-side via formatMoney(). If multi-variant subscription
 * products are added later, listen for 'product:variant-changed' and refresh
 * those attributes here.
 */

/**
 * Standard Shopify money formatter. Formats an amount in cents using the shop's
 * money_format string (e.g. "£{{amount}}"). Mirrors Shopify's reference
 * implementation so totals match the server-rendered `| money` output.
 */
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

class ProductSubscription extends HTMLElement {
  connectedCallback() {
    this.frequency = this.querySelector('.subscription-frequency');
    this.frequencySelect = this.querySelector('[data-subscription-frequency]');
    this.sellingPlanInput = this.querySelector('input[name="selling_plan"]');
    this.options = this.querySelectorAll('.subscription-option');
    this.subscriptionOption = this.querySelector('.subscription-option[data-purchase-option="subscription"]');

    this.oneTimeCents = parseInt(this.dataset.onetimeCents);
    this.oneTimeMoney = this.dataset.onetimeMoney || '';
    this.moneyFormat = this.dataset.moneyFormat || '';
    this.minQty = parseInt(this.dataset.minSubscriptionQty) || 2;

    // The quantity input lives in the buy row (a sibling box inside <product-form>).
    const form = this.closest('product-form');
    this.qtyInput = form ? form.querySelector('input[name="quantity"]') : null;

    this.addEventListener('change', (e) => {
      if (e.target.name === 'purchase_option' || e.target.matches('[data-subscription-frequency]')) {
        this.update();
      }
    });

    // React to quantity changes (quantity-selector dispatches a bubbling change).
    if (this.qtyInput) this.qtyInput.addEventListener('change', () => this.update());

    this.update();
  }

  get quantity() {
    const v = this.qtyInput ? parseInt(this.qtyInput.value) : 1;
    return !v || v < 1 ? 1 : v;
  }

  get isSubscriptionChecked() {
    const checked = this.querySelector('input[name="purchase_option"]:checked');
    return checked ? checked.value === 'subscription' : false;
  }

  update() {
    const qty = this.quantity;
    const canSubscribe = qty >= this.minQty;

    // Gate the subscription option: greyed out + not selectable below min qty
    // (the tooltip explains why on hover).
    if (this.subscriptionOption) {
      this.subscriptionOption.classList.toggle('is-disabled', !canSubscribe);
      const subRadio = this.subscriptionOption.querySelector('input[type="radio"]');
      if (subRadio) subRadio.disabled = !canSubscribe;
    }

    // If subscribing is no longer allowed but was selected, revert to one-time.
    if (!canSubscribe && this.isSubscriptionChecked) {
      const oneTime = this.querySelector('input[value="onetime"]');
      if (oneTime) oneTime.checked = true;
    }

    const isSub = this.isSubscriptionChecked && canSubscribe;

    // Selected-box styling (CSS also handles :checked; this is the reliable source).
    this.options.forEach((opt) => {
      const input = opt.querySelector('input[type="radio"]');
      opt.classList.toggle('is-selected', !!input && input.checked);
    });

    // Frequency dropdown is only relevant for an active subscription.
    if (this.frequency) this.frequency.hidden = !isSub;

    // Hidden input drives the cart POST. Empty => one-time.
    if (this.sellingPlanInput) {
      this.sellingPlanInput.value = isSub && this.frequencySelect ? this.frequencySelect.value : '';
    }

    this.updateButtonPrice(isSub, qty);
  }

  updateButtonPrice(isSub, qty) {
    const priceEl = document.querySelector('.buy-button-price');
    if (!priceEl) return;

    // Pick the relevant unit price (in cents).
    let unitCents = this.oneTimeCents;
    if (isSub && this.frequencySelect) {
      const opt = this.frequencySelect.selectedOptions[0];
      if (opt && opt.dataset.priceCents) unitCents = parseInt(opt.dataset.priceCents);
    }

    if (!isNaN(unitCents)) {
      priceEl.textContent = formatMoney(unitCents * qty, this.moneyFormat);
    } else if (this.oneTimeMoney) {
      priceEl.textContent = this.oneTimeMoney; // fallback (qty 1, no cents/format)
    }
  }
}

customElements.define('product-subscription', ProductSubscription);
