/**
 * Product Form Web Component
 *
 * Wraps the product info column on the product page. Contains variant
 * selectors, quantity input, and the add-to-cart form as descendants.
 * Handles add-to-cart via AJAX POST to /cart/add.js. Listens for variant
 * radio input changes to update the hidden variant ID. On variant change,
 * fetches server-rendered HTML via Shopify's Section Rendering API and
 * swaps in updated regions (price, buy buttons) marked with
 * data-variant-render attributes. Dispatches 'cart:item-added' on
 * document after successful add. Respects document.body.dataset.cartType:
 * 'page' redirects to /cart; 'drawer' fires a success toast (the cart drawer
 * no longer auto-opens — it opens on cart-icon click).
 *
 * Expected markup:
 *   <product-form data-section-id="{{ section.id }}" data-added-message="{{ 'products.product.added_to_cart' | t: product: product.title }}">
 *     <script type="application/json" class="product-json">{ "variants": [...] }</script>
 *     <fieldset class="variant-options">...</fieldset>
 *     <quantity-selector>
 *       <input type="number" name="quantity" value="1" min="1">
 *     </quantity-selector>
 *     <form action="/cart/add" method="post">
 *       <input type="hidden" name="id" value="VARIANT_ID">
 *       <div data-variant-render="buy-buttons">
 *         <button type="submit">Add to cart</button>
 *       </div>
 *       <div data-error class="form-error" role="alert" hidden></div>
 *     </form>
 *   </product-form>
 */

// Size a Shopify CDN image URL for the 30×30 toast thumbnail (2× = 60px).
// Mirrors toastThumb() in toast.js — duplicated because this is a classic
// script (loaded without type="module") and can't import.
function toastThumb(url, size = 60) {
  if (!url) return undefined;
  return `${url}${url.includes('?') ? '&' : '?'}width=${size}`;
}

class ProductForm extends HTMLElement {
  connectedCallback() {
    this.form = this.querySelector('form');
    if (!this.form) return;

    this.submitButton = this.form.querySelector('[type="submit"]');
    this.errorContainer = this.querySelector('[data-error]');
    this.sectionId = this.dataset.sectionId;
    this.addedMessage = this.dataset.addedMessage;
    this.renderRequestId = 0;

    // Parse the product JSON for variant lookup
    const jsonScript = this.querySelector('.product-json');
    this.productData = jsonScript ? JSON.parse(jsonScript.textContent) : null;

    // Listen for form submission
    this.form.addEventListener('submit', (e) => this.handleSubmit(e));

    // Listen for variant radio changes anywhere inside this component
    // (radios live in the variant-selector block, outside the <form>)
    this.addEventListener('change', (e) => {
      if (e.target.matches('input[type="radio"]')) {
        this.handleVariantChange();
      }
    });
  }

  /**
   * When a variant radio changes, find the matching variant from the product
   * JSON and update the hidden id input. Also dispatches 'product:variant-changed'
   * for other components (gallery) to react, then fetches server-rendered HTML
   * to update price and buy button regions.
   */
  handleVariantChange() {
    if (!this.productData || !this.productData.variants) return;

    // Collect all currently selected option values from fieldsets in this component
    const selectedOptions = [];
    const optionFieldsets = this.querySelectorAll('fieldset');
    optionFieldsets.forEach((fieldset) => {
      const checked = fieldset.querySelector('input[type="radio"]:checked');
      if (checked) {
        selectedOptions.push(checked.value);
      }
    });

    // Find the variant that matches all selected options
    const matchedVariant = this.productData.variants.find((variant) => {
      return variant.options.every((option, index) => option === selectedOptions[index]);
    });

    if (matchedVariant) {
      this.currentVariant = matchedVariant;
      // Update the hidden variant ID input
      const idInput = this.form.querySelector('input[name="id"]');
      if (idInput) {
        idInput.value = matchedVariant.id;
      }

      const url = new URL(window.location);
      url.searchParams.set('variant', matchedVariant.id);
      window.history.replaceState({}, '', url);

      this.renderVariantSections(matchedVariant.id);

      // Notify other components (gallery) about the variant change
      document.dispatchEvent(new CustomEvent('product:variant-changed', {
        detail: { variant: matchedVariant }
      }));
    }
  }

  /**
   * Fetch the section's server-rendered HTML for the given variant and swap
   * in all regions marked with data-variant-render attributes. Uses an
   * incrementing request ID to guard against race conditions from rapid
   * variant switching.
   * @param {number} variantId
   */
  async renderVariantSections(variantId) {
    if (!this.sectionId) return;

    const requestId = ++this.renderRequestId;
    this.classList.add('is-loading');

    try {
      const response = await fetch(
        `${window.location.pathname}?variant=${variantId}&section_id=${this.sectionId}`
      );

      if (!response.ok || requestId !== this.renderRequestId) return;

      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');

      this.querySelectorAll('[data-variant-render]').forEach((el) => {
        const newEl = doc.querySelector(`[data-variant-render="${el.dataset.variantRender}"]`);
        if (newEl) el.innerHTML = newEl.innerHTML;
      });

      // Re-cache submit button (lives inside swapped buy-buttons region)
      this.submitButton = this.form.querySelector('[type="submit"]');
    } finally {
      if (requestId === this.renderRequestId) {
        this.classList.remove('is-loading');
      }
    }
  }

  /**
   * Handle form submission via AJAX.
   * POST to /cart/add.js with JSON body containing items array.
   * On success: dispatch 'cart:item-added', then redirect to /cart (page mode)
   * or fire a success toast (drawer mode). On error: show inline error message.
   * @param {SubmitEvent} e
   */
  async handleSubmit(e) {
    e.preventDefault();
    this.clearError();
    this.submitButton.classList.add('is-loading');
    this.submitButton.disabled = true;

    try {
      const variantId = this.form.querySelector('input[name="id"]').value;

      // Read quantity from the quantity-selector within this component
      // (lives outside the <form> in its own block)
      const quantityInput = this.querySelector('input[name="quantity"]');
      const quantity = (quantityInput && parseInt(quantityInput.value)) || 1;

      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          items: [{ id: parseInt(variantId), quantity }],
          sections: ['cart-drawer']
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.description || 'Failed to add to cart');
      }

      const data = await response.json();

      // Dispatch immediately — drawer opens and refreshes from the bundled
      // section HTML. cart-icon self-fetches /cart.js for the new count if
      // detail.cart is missing, so we don't block the drawer-open path on it.
      document.dispatchEvent(new CustomEvent('cart:item-added', {
        detail: { sections: data.sections }
      }));

      // Cart type preference: 'page' redirects to /cart; 'drawer' shows a
      // success toast (the cart drawer no longer auto-opens — it opens on
      // cart-icon click). This is a classic script, so we dispatch the
      // toast:show event directly rather than importing showToast().
      const cartType = document.body.dataset.cartType;
      if (cartType === 'page') {
        window.location.href = '/cart';
      } else {
        document.dispatchEvent(new CustomEvent('toast:show', {
          detail: {
            message: this.addedMessage || 'Added to cart',
            variant: 'success',
            image: toastThumb(data.items?.[0]?.image)
          }
        }));
      }

    } catch (error) {
      this.showError(error.message);
    } finally {
      this.submitButton.classList.remove('is-loading');
      // Re-enable only if the current variant is available
      // (server-rendered buy buttons may have disabled it for sold-out variants)
      if (this.currentVariant?.available !== false) {
        this.submitButton.disabled = false;
      }
    }
  }

  /**
   * Display an inline error message near the form.
   * @param {string} message
   */
  showError(message) {
    if (this.errorContainer) {
      this.errorContainer.textContent = message;
      this.errorContainer.hidden = false;
    }
  }

  /**
   * Clear any previously displayed error message.
   */
  clearError() {
    if (this.errorContainer) {
      this.errorContainer.textContent = '';
      this.errorContainer.hidden = true;
    }
  }
}

customElements.define('product-form', ProductForm);
