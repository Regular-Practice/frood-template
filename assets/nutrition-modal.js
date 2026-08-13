/**
 * <nutrition-modal> — opens the full nutrition tables from the PDP's
 * "Nutritional info" accordion.
 *
 * Wraps an `.inline-link` trigger + a hidden `.nutrition-modal` dialog. Click
 * opens it (locks body scroll, traps Tab focus within the dialog); Escape, the
 * close button, or a backdrop click close it and restore focus to the trigger.
 *
 * Modelled on assets/recipe-modal.js — same open/close/trap contract, minus the
 * video machinery. NOTE: this is now the sixth independent focus trap in the
 * theme (recipe-modal, password-modal, cart-drawer, filter-drawer,
 * search-drawer, this). Extracting a shared modal base is worth doing; it was
 * deliberately not bundled into this feature.
 *
 * Public events — bubble to `document`, no detail payload. These have NO
 * internal listener; they are intentional extension points (analytics,
 * integrations) and are safe to leave unused:
 *   'nutrition-modal:opened'  fired after the dialog is shown
 *   'nutrition-modal:closed'  fired after the dialog is hidden
 *
 * Expected markup (snippets/nutrition-modal.liquid):
 *   <nutrition-modal>
 *     <button class="inline-link nutrition-modal-trigger">…</button>
 *     <div class="nutrition-modal" role="dialog" aria-modal="true" hidden>
 *       <div class="nutrition-modal-inner">
 *         <div class="nutrition-modal-header">…title + close…</div>
 *         <div class="nutrition-modal-body">…tables…</div>
 *       </div>
 *     </div>
 *
 * `.nutrition-modal-body` is the scroll container: the overlay pads, the panel
 * caps to what's left, and the tables scroll inside the panel with the header
 * held above them.
 *   </nutrition-modal>
 *
 * Focus is trapped within `.nutrition-modal` (NOT the host element) so the
 * behind-the-dialog trigger stays out of the tab cycle.
 */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/* The real content box. A click anywhere else inside the dialog — the backdrop,
   or the padding around the panel — counts as a backdrop click and closes. */
const CONTENT = '.nutrition-modal-inner';

class NutritionModal extends HTMLElement {
  connectedCallback() {
    this.trigger = this.querySelector('.nutrition-modal-trigger');
    this.modal = this.querySelector('.nutrition-modal');
    this.closeBtn = this.querySelector('.nutrition-modal-close');
    this.body = this.querySelector('.nutrition-modal-body');

    if (!this.trigger || !this.modal) return;

    this.handleOpen = this.open.bind(this);
    this.handleClose = this.close.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handleBackdropClick = this.handleBackdropClick.bind(this);
    this.afterClose = this.afterClose.bind(this);

    this.trigger.addEventListener('click', this.handleOpen);
    this.closeBtn?.addEventListener('click', this.handleClose);
    this.modal.addEventListener('pointerdown', this.handlePointerDown);
    this.modal.addEventListener('click', this.handleBackdropClick);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this.handleKeydown);
    document.body.style.overflow = '';
    clearTimeout(this.closeTimer);
    this.modal?.removeEventListener('transitionend', this.afterClose);
  }

  open() {
    this.previouslyFocused = document.activeElement;
    this.pressedContent = false;
    // Cancel a pending hide if we're re-opening mid fade-out.
    clearTimeout(this.closeTimer);
    this.modal.removeEventListener('transitionend', this.afterClose);
    this.modal.hidden = false;
    // Force a reflow so the browser registers the [hidden]-removed start state
    // (opacity 0 / scale 0.96) before `is-open` flips it — otherwise the two
    // changes batch and the transition is skipped.
    void this.modal.offsetWidth;
    this.modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', this.handleKeydown);
    // Re-opening should start at the top of the table list, not wherever the
    // previous read left the scroll position. The body is the scroll container,
    // not the overlay.
    if (this.body) this.body.scrollTop = 0;
    (this.closeBtn || this.modal.querySelector(FOCUSABLE))?.focus();
    this.dispatchEvent(new CustomEvent('nutrition-modal:opened', { bubbles: true }));
  }

  close() {
    this.modal.classList.remove('is-open');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', this.handleKeydown);
    this.previouslyFocused?.focus?.();

    // Set [hidden] (display:none) once the fade-out finishes, so the closed
    // dialog leaves the tab order. Under reduced motion there's no transition —
    // and thus no transitionend — so hide right away. The setTimeout is a
    // fallback in case transitionend never fires.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.modal.hidden = true;
    } else {
      this.modal.addEventListener('transitionend', this.afterClose);
      this.closeTimer = setTimeout(this.afterClose, 250);
    }

    this.dispatchEvent(new CustomEvent('nutrition-modal:closed', { bubbles: true }));
  }

  afterClose() {
    clearTimeout(this.closeTimer);
    this.modal.removeEventListener('transitionend', this.afterClose);
    // Guard against a re-open that happened during the fade-out.
    if (!this.modal.classList.contains('is-open')) this.modal.hidden = true;
  }

  handleKeydown(e) {
    if (e.key === 'Escape') {
      this.close();
      return;
    }
    if (e.key !== 'Tab') return;

    const focusable = this.modal.querySelectorAll(FOCUSABLE);
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

  handlePointerDown(e) {
    // Remember whether the press began on real content, so a drag that ends on
    // the backdrop does NOT count as a backdrop click. Matters here: people
    // select nutrition figures with the mouse, and releasing outside the panel
    // would otherwise close the dialog mid-selection.
    this.pressedContent = e.target.closest(CONTENT) !== null;
  }

  handleBackdropClick(e) {
    if (this.pressedContent) {
      this.pressedContent = false;
      return;
    }
    if (e.target.closest(CONTENT)) return;
    this.close();
  }
}

customElements.define('nutrition-modal', NutritionModal);
