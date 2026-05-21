/**
 * Cart Items Web Component
 *
 * Manages cart line item interactions: quantity changes and item removal.
 * Uses event delegation for change/click events on quantity inputs and
 * remove buttons. After updating via /cart/change.js, dispatches
 * 'cart:updated' with both cart data and pre-rendered section HTML
 * (Shopify bundled section rendering). Self-renders only on the cart
 * page; inside the cart drawer, the drawer handles the section swap.
 *
 * Errors surface per-line in a [data-error] slot (the drawer line item).
 * Messages: a stock clamp (Shopify caps quantity and returns 200), an HTTP
 * error body's `description`, or a generic network message. The localized
 * strings come from data-error-stock / data-error-generic on <cart-items>.
 *
 * Expected markup:
 *   <cart-items data-section-id="main-cart">           (cart page)
 *   <cart-items data-error-stock="…" data-error-generic="…">  (cart drawer)
 *     <div class="cart-drawer-item" data-key="variant_key:hash">
 *       <p data-error role="alert"></p>      (line-level error slot)
 *       <quantity-selector>
 *         <input type="number" data-key="variant_key:hash" min="0" ...>
 *       </quantity-selector>                  (step to 0 = remove; no button)
 *     </div>
 *   </cart-items>
 */
class CartItems extends HTMLElement {
  connectedCallback() {
    this.debounceTimer = null;
    this.sectionId = this.dataset.sectionId || 'cart-drawer';
    this.insideDrawer = !!this.closest('cart-drawer');

    // Delegate change events from quantity inputs (inside quantity-selector)
    this.addEventListener('change', (e) => {
      const input = e.target.closest('input[type="number"]');
      if (input && input.dataset.key) {
        this.debouncedUpdate(input.dataset.key, parseInt(input.value));
      }
    });

    // Delegate click events for remove buttons
    this.addEventListener('click', (e) => {
      const removeButton = e.target.closest('[data-remove]');
      if (removeButton) {
        e.preventDefault();
        this.updateItem(removeButton.dataset.remove, 0);
      }
    });
  }

  /**
   * Debounce quantity updates to prevent rapid-fire requests when the user
   * clicks +/- quickly. Waits 300ms after the last change before sending.
   * @param {string} key - The cart line item key.
   * @param {number} quantity - The new quantity.
   */
  debouncedUpdate(key, quantity) {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.updateItem(key, quantity);
    }, 300);
  }

  /**
   * Update a cart line item quantity via POST to /cart/change.js.
   * A quantity of 0 removes the item. Uses Shopify's bundled section
   * rendering to get pre-rendered HTML in the same response — no
   * additional section fetch needed.
   * @param {string} key - The cart line item key.
   * @param {number} quantity - The new desired quantity (0 to remove).
   */
  async updateItem(key, quantity) {
    // Localized messages, set via data-* on the cart drawer's <cart-items>.
    const errorStock = this.dataset.errorStock || 'Not enough in stock';
    const errorGeneric = this.dataset.errorGeneric || "Couldn't update — try again";
    const requested = quantity;

    this.classList.add('is-loading');

    try {
      const response = await fetch('/cart/change.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          id: key,
          quantity,
          sections: [this.sectionId]
        })
      });

      if (!response.ok) {
        // Shopify returns a JSON body with a human-readable `description`
        // (e.g. stock limits). Surface it on the line, else a generic message.
        let message = errorGeneric;
        try {
          const err = await response.json();
          if (err && err.description) message = err.description;
        } catch {
          /* non-JSON error body — keep the generic message */
        }
        this.classList.remove('is-loading');
        this.showLineError(key, message);
        return;
      }

      const data = await response.json();

      // Notify other components — includes pre-rendered section HTML
      document.dispatchEvent(new CustomEvent('cart:updated', {
        detail: { cart: data, sections: data.sections }
      }));

      // Self-render only on the cart page. Inside the drawer, cart-drawer's
      // synchronous event handler has already replaced this element.
      if (!this.insideDrawer) {
        this.renderFromSections(data.sections);
      }

      // Stock clamp: Shopify silently caps quantity at available stock and
      // returns 200, so a "+" that did nothing needs explaining. Compare the
      // resulting line quantity against what was requested. Runs after the body
      // has been re-rendered above, so it targets the fresh line.
      if (requested > 0) {
        const line = data.items.find((i) => i.key === key);
        if (line && line.quantity < requested) {
          this.showLineError(key, errorStock);
        }
      }
    } catch {
      // Network/parse failure — no cart:updated fired, so this element is still
      // in the DOM; show the error on the line the user was editing.
      this.classList.remove('is-loading');
      this.showLineError(key, errorGeneric);
    }
  }

  /**
   * Show a line-level error in the matching item's [data-error] slot.
   * No-ops gracefully when the slot is absent (the cart page has no per-line
   * error markup). After a drawer refresh `this` is detached, so resolve the
   * live element from the current <cart-drawer>.
   * @param {string} key - The cart line item key.
   * @param {string} message - The message to display.
   */
  showLineError(key, message) {
    const root = this.insideDrawer ? document.querySelector('cart-drawer') : this;
    const slot = root?.querySelector(
      `.cart-drawer-item[data-key="${CSS.escape(key)}"] [data-error]`
    );
    if (slot) slot.textContent = message;
  }

  /**
   * Replace this element's content using pre-rendered section HTML
   * from the bundled sections response.
   * @param {Object} sections - Map of section IDs to rendered HTML strings.
   */
  renderFromSections(sections) {
    const html = sections?.[this.sectionId];
    if (!html) return;

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const newCartItems = doc.querySelector('cart-items');

    if (newCartItems) {
      this.innerHTML = newCartItems.innerHTML;
    }
    this.classList.remove('is-loading');
  }
}

customElements.define('cart-items', CartItems);
