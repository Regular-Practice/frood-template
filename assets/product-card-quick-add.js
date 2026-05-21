/*
  <product-card-quick-add>

  Lightweight quick-add for product cards. Intercepts the wrapped <form>'s
  submission, POSTs to /cart/add.js for the default variant, and dispatches
  'cart:item-added' so the cart icon updates and the drawer refreshes (it no
  longer auto-opens). On success, shows an "Added to cart" toast.

  Why a separate component (not <product-form>): the PDP form handles variant
  selectors, quantity input, server-rendered region swaps, and product JSON
  parsing. None of that applies on a card — there's no variant picker, no
  quantity, just one button → first available variant.

  Expected markup (emitted by snippets/product-card.liquid):

    <product-card-quick-add data-added-message="{{ 'products.product.added_to_cart' | t: product: product.title }}">
      <form action="/cart/add" method="post">
        <input type="hidden" name="id" value="{{ variant.id }}">
        <button type="submit" class="button">Shop now</button>
      </form>
    </product-card-quick-add>

  No-JS fallback: the <form action="/cart/add"> POSTs normally and the
  browser navigates to /cart after submit. Works without the component.
*/

import { showToast } from './toast.js';

// Size a Shopify CDN image URL for the 30×30 toast thumbnail (2× = 60px).
// Inlined rather than imported from toast.js so a stale cached toast.js can't
// break this module's import link (Shopify resolves `./toast.js` versionless).
// Same helper as product-form.js / bundle-builder.js.
function toastThumb(url, size = 60) {
  if (!url) return undefined;
  return `${url}${url.includes('?') ? '&' : '?'}width=${size}`;
}

class ProductCardQuickAdd extends HTMLElement {
  connectedCallback() {
    this.form = this.querySelector('form');
    if (!this.form) return;

    this.button = this.form.querySelector('button[type="submit"]');
    this.addedMessage = this.dataset.addedMessage;
    this.handleSubmit = this.handleSubmit.bind(this);
    this.form.addEventListener('submit', this.handleSubmit);
  }

  disconnectedCallback() {
    this.form?.removeEventListener('submit', this.handleSubmit);
  }

  async handleSubmit(e) {
    e.preventDefault();
    if (!this.button || this.button.disabled) return;

    this.button.classList.add('is-loading');
    this.button.disabled = true;

    try {
      const variantId = this.form.querySelector('input[name="id"]')?.value;
      if (!variantId) throw new Error('Missing variant id');

      const addResponse = await fetch('/cart/add.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          items: [{ id: parseInt(variantId, 10), quantity: 1 }],
          sections: ['cart-drawer']
        })
      });

      if (!addResponse.ok) {
        const err = await addResponse.json().catch(() => ({}));
        throw new Error(err.description || 'Failed to add to cart');
      }

      const addData = await addResponse.json();

      // Dispatch immediately — drawer opens and refreshes from the bundled
      // section HTML. cart-icon self-fetches /cart.js for the new count if
      // detail.cart is missing, so we don't block the drawer-open path on it.
      document.dispatchEvent(new CustomEvent('cart:item-added', {
        detail: { sections: addData.sections }
      }));

      // Page mode redirects to /cart; drawer mode shows a success toast
      // (the cart drawer no longer auto-opens). Matches product-form.js.
      if (document.body.dataset.cartType === 'page') {
        window.location.href = '/cart';
      } else {
        showToast(this.addedMessage || 'Added to cart', {
          variant: 'success',
          image: toastThumb(addData.items?.[0]?.image)
        });
      }
    } catch (err) {
      console.error('[product-card-quick-add]', err);
      // Cards are too small for inline error UI. Failures are rare in practice
      // (default variant is always available unless product is sold out, in
      // which case the button is disabled at render time).
    } finally {
      this.button.classList.remove('is-loading');
      this.button.disabled = false;
    }
  }
}

customElements.define('product-card-quick-add', ProductCardQuickAdd);