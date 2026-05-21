/**
 * <cart-drawer> — floating "island" overlay that mirrors the native Shopify cart.
 *
 * Body markup is server-rendered by sections/cart-drawer.liquid; this component
 * keeps it in sync via Shopify's Section Rendering API. Listens on `document`:
 *
 *   'cart:updated'      detail.sections['cart-drawer'] → swap body
 *   'cart:item-added'   detail.sections['cart-drawer'] → swap body (does NOT
 *                       auto-open; the add-to-cart view shows a success toast,
 *                       and the drawer opens on cart-icon click). If no sections
 *                       payload, fetch /?section_id=cart-drawer to stay current.
 *
 * Quantity/remove inside the drawer go through the embedded <cart-items>
 * (assets/cart-items.js), which POSTs /cart/change.js with `sections:
 * ['cart-drawer']` and re-dispatches 'cart:updated' with the bundled HTML.
 *
 * If the event detail carries sections['cart-drawer'], the drawer swaps from
 * that. Otherwise it falls back to a Section Rendering API fetch.
 *
 * Expected markup:
 *   <cart-drawer id="cart-drawer" class="cart-drawer" aria-hidden="true"
 *     role="dialog" aria-modal="true" aria-label="Cart">
 *     <div class="cart-drawer-overlay" data-overlay></div>
 *     <div class="cart-drawer-panel">
 *       <header class="cart-drawer-header">          (static — not swapped)
 *         <span class="cart-drawer-title">…</span>
 *         <button class="cart-drawer-close" data-close>×</button>
 *       </header>
 *       <div class="cart-drawer-main" data-drawer-body>   (swapped on refresh)
 *         <cart-items>…line items…</cart-items>
 *         <div class="cart-drawer-footer">…totals…</div>
 *         <a class="cart-drawer-checkout" href="/checkout">…</a>
 *       </div>
 *     </div>
 *   </cart-drawer>
 */

class CartDrawer extends HTMLElement {
  connectedCallback() {
    this.overlay = this.querySelector('[data-overlay]');
    this.closeBtn = this.querySelector('[data-close]');
    this.body = this.querySelector('[data-drawer-body]');
    this.previouslyFocused = null;

    this.handleKeydown = this.handleKeydown.bind(this);

    this.closeBtn?.addEventListener('click', () => this.close());
    this.overlay?.addEventListener('click', () => this.close());

    this._onCartUpdated = (e) => this.refresh(e.detail?.sections?.['cart-drawer']);
    this._onItemAdded = (e) => this.handleItemAdded(e);

    document.addEventListener('cart:updated', this._onCartUpdated);
    document.addEventListener('cart:item-added', this._onItemAdded);
  }

  disconnectedCallback() {
    document.removeEventListener('cart:updated', this._onCartUpdated);
    document.removeEventListener('cart:item-added', this._onItemAdded);
    document.removeEventListener('keydown', this.handleKeydown);
  }

  get isOpen() {
    return this.classList.contains('is-open');
  }

  // ---- Refresh ----------------------------------------------------------

  // Swap the drawer body with the [data-drawer-body] content from a fresh
  // server-rendered cart-drawer section. `html` is the raw section string
  // from Shopify's Section Rendering API.
  refresh(html) {
    if (!html || !this.body) return;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const fresh = doc.querySelector('[data-drawer-body]');
    if (fresh) this.body.innerHTML = fresh.innerHTML;
    // Public hook — bubbles to `document`, no detail. No internal listener;
    // an extension point for analytics/integrations to re-init after a swap.
    this.dispatchEvent(new CustomEvent('content:loaded', { bubbles: true }));
  }

  async handleItemAdded(e) {
    const html = e.detail?.sections?.['cart-drawer'];
    if (html) {
      this.refresh(html);
    } else {
      // Sender didn't bundle sections — fetch the section ourselves so the
      // body is current the next time the drawer is opened (via the cart icon).
      // Dim the current items while the fetch is in flight (visible if the
      // drawer is already open).
      const cartItems = this.body?.querySelector('cart-items');
      cartItems?.classList.add('is-loading');
      try {
        const response = await fetch('/?section_id=cart-drawer');
        if (response.ok) this.refresh(await response.text());
      } catch {
        /* network blip — leave the body stale until the next refresh */
      } finally {
        cartItems?.classList.remove('is-loading');
      }
    }
    // No auto-open: add-to-cart feedback is a success toast fired by the
    // add-to-cart view (product-form / product-card-quick-add / bundle-builder).
    // The drawer opens on cart-icon click.
  }

  // ---- Open / close -----------------------------------------------------

  /**
   * Open the cart drawer. Locks body scroll, traps focus, listens for Escape.
   */
  open() {
    this.previouslyFocused = document.activeElement;

    this.classList.add('is-open');
    this.setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');

    document.addEventListener('keydown', this.handleKeydown);
    this.trapFocus();
  }

  close() {
    this.classList.remove('is-open');
    this.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('drawer-open');

    document.removeEventListener('keydown', this.handleKeydown);

    if (this.previouslyFocused) {
      this.previouslyFocused.focus();
      this.previouslyFocused = null;
    }
  }

  handleKeydown(e) {
    if (e.key === 'Escape') {
      this.close();
      return;
    }

    if (e.key !== 'Tab') return;

    const focusable = this.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  trapFocus() {
    const focusable = this.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      focusable[0].focus();
    }
  }
}

customElements.define('cart-drawer', CartDrawer);