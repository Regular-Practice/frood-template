/**
 * <recipe-modal> — opens a video modal from a recipe card.
 *
 * Wraps a `.recipe-card-link` trigger + a hidden `.recipe-modal` dialog. Click
 * opens it (locks body scroll, plays the video, traps Tab focus within the
 * dialog); Escape, the close button, or a backdrop click close it and restore
 * focus to the trigger.
 *
 * Public events — bubble to `document`, no detail payload. These have NO
 * internal listener; they are intentional extension points (analytics,
 * integrations) and are safe to leave unused:
 *   'recipe-modal:opened'  fired after the modal is shown
 *   'recipe-modal:closed'  fired after the modal is hidden
 *
 * Expected markup (snippets/recipe-card.liquid):
 *   <recipe-modal>
 *     <button class="recipe-card-link">…</button>
 *     <div class="recipe-modal" hidden>
 *       <button class="recipe-modal-close">…</button>
 *       <div class="recipe-modal-inner">
 *         <div class="recipe-modal-video"><media-controller>…<video>…</media-controller></div>
 *         <div class="recipe-modal-info">…</div>
 *       </div>
 *     </div>
 *   </recipe-modal>
 *
 * Focus is trapped within `.recipe-modal` (NOT the host element) so the
 * behind-the-dialog `.recipe-card-link` trigger stays out of the tab cycle.
 * media-chrome's play/mute buttons are tabbable (they expose a non-negative
 * tabindex) so they take part in the trap automatically.
 */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/* The real content boxes. A click anywhere else inside the dialog — backdrop,
   or the transparent layout wrappers (flex gaps, the space around the cards) —
   counts as a backdrop click and closes the modal. */
const CONTENT = '.recipe-modal-video, .recipe-info-card, .recipe-madewith-card, .recipe-modal-close';

class RecipeModal extends HTMLElement {
  connectedCallback() {
    this.trigger = this.querySelector('.recipe-card-link');
    this.modal = this.querySelector('.recipe-modal');
    this.closeBtn = this.querySelector('.recipe-modal-close');
    this.video = this.querySelector('.recipe-modal-video video');

    if (!this.trigger || !this.modal) return;

    this.handleOpen = this.open.bind(this);
    this.handleClose = this.close.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handleBackdropClick = this.handleBackdropClick.bind(this);

    this.trigger.addEventListener('click', this.handleOpen);
    this.closeBtn?.addEventListener('click', this.handleClose);
    this.modal.addEventListener('pointerdown', this.handlePointerDown);
    this.modal.addEventListener('click', this.handleBackdropClick);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this.handleKeydown);
    document.body.style.overflow = '';
    // Safety net: if the element is torn down while open (e.g. a theme-editor
    // section re-render), don't leave the video playing in the background.
    this.video?.pause();
  }

  open() {
    this.previouslyFocused = document.activeElement;
    this.pressedContent = false;
    this.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', this.handleKeydown);
    (this.closeBtn || this.modal.querySelector(FOCUSABLE))?.focus();
    this.video?.play().catch(() => {});
    this.dispatchEvent(new CustomEvent('recipe-modal:opened', { bubbles: true }));
  }

  close() {
    this.modal.hidden = true;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', this.handleKeydown);
    if (this.video) {
      this.video.pause();
      this.video.currentTime = 0;
    }
    this.previouslyFocused?.focus?.();
    this.dispatchEvent(new CustomEvent('recipe-modal:closed', { bubbles: true }));
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
    // the backdrop (e.g. selecting description text and releasing outside) is
    // NOT treated as a backdrop click.
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

customElements.define('recipe-modal', RecipeModal);
