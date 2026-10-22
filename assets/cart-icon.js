/**
 * <cart-icon> — header cart link.
 *
 * Shows the native Shopify cart count. The initial value is server-rendered
 * by sections/header.liquid as `{{ cart.item_count }}`; this component keeps
 * it in sync by listening on `document`:
 *
 *   'cart:updated'      detail.cart → boxCount → updateCount
 *   'cart:item-added'   fetch /cart.js → boxCount → updateCount
 *
 * The count is in BOXES, not units: every line carrying the hidden
 * `_custom_box` property (the v2 builder's per-blend lines) is a pack of a
 * custom box; those packs count together, one box per 6. Mirrors the Liquid in header.liquid.
 *
 * When body[data-cart-type="drawer"], clicking the link opens the
 * <cart-drawer> instead of navigating to /cart. When body[data-cart-type
 * ="page"], the native href navigation runs.
 *
 * Uses a data-aria-template attribute (populated via Liquid translation) to
 * keep the aria-label localized when the count updates dynamically.
 *
 * Expected markup:
 *   <cart-icon data-aria-template="{{ 'accessibility.cart_count' | t: count: '__COUNT__' }}">
 *     <a href="{{ routes.cart_url }}" class="header-cart" aria-label="…">
 *       Cart (<span class="cart-count">{{ cart_boxes }}</span>)
 *     </a>
 *   </cart-icon>
 */

class CartIcon extends HTMLElement {
  connectedCallback() {
    this.countElement = this.querySelector('.cart-count');
    this.clickTarget = this.querySelector('a') || this.querySelector('button');
    this.ariaTemplate = this.dataset.ariaTemplate;

    // In drawer mode, intercept clicks to open the global cart drawer.
    if (this.clickTarget && document.body.dataset.cartType === 'drawer') {
      this.clickTarget.addEventListener('click', (e) => {
        const drawer = document.querySelector('cart-drawer');
        if (!drawer) return;
        e.preventDefault();
        drawer.open();
      });
    }

    this._onCartUpdated = (e) => {
      const cart = e.detail?.cart;
      if (cart) this.updateCount(this.boxCount(cart));
    };
    this._onItemAdded = () => this.fetchCount();

    document.addEventListener('cart:updated', this._onCartUpdated);
    document.addEventListener('cart:item-added', this._onItemAdded);
  }

  disconnectedCallback() {
    document.removeEventListener('cart:updated', this._onCartUpdated);
    document.removeEventListener('cart:item-added', this._onItemAdded);
  }

  async fetchCount() {
    try {
      const response = await fetch('/cart.js');
      if (!response.ok) return;
      const cart = await response.json();
      this.updateCount(this.boxCount(cart));
    } catch {
      /* network blip — leave the count stale */
    }
  }

  boxCount(cart) {
    if (!Array.isArray(cart.items)) return cart.item_count;
    let boxes = 0;
    let customPacks = 0;
    for (const item of cart.items) {
      if (item.properties && item.properties._custom_box) customPacks += item.quantity;
      else boxes += item.quantity;
    }
    return boxes + Math.ceil(customPacks / 6);
  }

  updateCount(count) {
    if (this.countElement) {
      this.countElement.textContent = count;
    }
    if (this.clickTarget && this.ariaTemplate) {
      this.clickTarget.setAttribute(
        'aria-label',
        this.ariaTemplate.replace('__COUNT__', count)
      );
    }
  }
}

customElements.define('cart-icon', CartIcon);