/**
 * <password-modal> — centered modal holding Shopify's storefront-password form.
 *
 * The password page shows only a public newsletter signup; the actual "enter the
 * store" form ({% form 'storefront_password' %}) lives in here, hidden behind a
 * quiet trigger button so staff/owners can get in without exposing it.
 *
 * Open/close/Escape/focus-trap mirror <cart-drawer> (assets/cart-drawer.js) but
 * with no Section Rendering API — the form is static and submits a normal POST.
 *
 * Triggers: any element with [data-password-open] anywhere on the page opens it.
 * Server-rendered open: a wrong password reloads the page with form.errors, and
 * the section renders the modal already carrying `is-open` — connectedCallback
 * picks that up and engages focus + scroll lock so the error is shown in place.
 *
 * Expected markup:
 *   <password-modal class="password-modal" role="dialog" aria-modal="true"
 *     aria-hidden="true" aria-label="Password">
 *     <div class="password-modal-overlay" data-overlay></div>
 *     <div class="password-modal-panel">
 *       <header class="password-modal-header">
 *         <span class="password-modal-title">…</span>
 *         <button class="password-modal-close" data-close>×</button>
 *       </header>
 *       <div class="password-modal-body">{% form 'storefront_password' %}…{% endform %}</div>
 *     </div>
 *   </password-modal>
 */

class PasswordModal extends HTMLElement {
  connectedCallback() {
    this.overlay = this.querySelector('[data-overlay]');
    this.closeBtn = this.querySelector('[data-close]');
    this.previouslyFocused = null;

    this.handleKeydown = this.handleKeydown.bind(this);
    this._onTriggerClick = () => this.open();

    this.closeBtn?.addEventListener('click', () => this.close());
    this.overlay?.addEventListener('click', () => this.close());

    // Quiet trigger button(s) live outside this element — wire them up here.
    this.triggers = document.querySelectorAll('[data-password-open]');
    this.triggers.forEach((t) => t.addEventListener('click', this._onTriggerClick));

    // A failed attempt reloads with the modal already open — engage it.
    if (this.isOpen) this.open();
  }

  disconnectedCallback() {
    this.triggers?.forEach((t) => t.removeEventListener('click', this._onTriggerClick));
    document.removeEventListener('keydown', this.handleKeydown);
    document.body.classList.remove('password-modal-open');
  }

  get isOpen() {
    return this.classList.contains('is-open');
  }

  open() {
    // Guarded so re-opening an already-open modal (server-rendered case) doesn't
    // clobber previouslyFocused or re-toggle the class.
    if (!this.classList.contains('is-open')) {
      this.previouslyFocused = document.activeElement;
      this.classList.add('is-open');
      this.setAttribute('aria-hidden', 'false');
    }

    document.body.classList.add('password-modal-open');
    document.addEventListener('keydown', this.handleKeydown);
    this.focusFirstField();
  }

  close() {
    this.classList.remove('is-open');
    this.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('password-modal-open');

    document.removeEventListener('keydown', this.handleKeydown);

    if (this.previouslyFocused) {
      this.previouslyFocused.focus();
      this.previouslyFocused = null;
    }
  }

  // Prefer the password input so the cursor lands where the user types.
  focusFirstField() {
    const input = this.querySelector('input[name="password"]');
    if (input) {
      input.focus();
      return;
    }
    this.getFocusable()[0]?.focus();
  }

  getFocusable() {
    return this.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
  }

  handleKeydown(e) {
    if (e.key === 'Escape') {
      this.close();
      return;
    }

    if (e.key !== 'Tab') return;

    const focusable = this.getFocusable();
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
}

customElements.define('password-modal', PasswordModal);
