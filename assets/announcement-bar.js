/**
 * Announcement Bar Web Component
 *
 * Dismissible banner above the header for promotions or notices.
 * On connect, checks localStorage — if previously dismissed, removes itself
 * immediately. The dismiss button stores the flag and removes the element.
 *
 * Uses a data-dismiss-key attribute (set from Liquid via md5 of the text)
 * to scope dismissal to the current announcement content. When the merchant
 * changes the text, the key changes and the bar reappears for all visitors.
 *
 * Expected markup:
 *   <announcement-bar class="announcement-bar"
 *     data-dismiss-key="abc123">
 *     <p class="announcement-bar-content">Free shipping on orders over $50</p>
 *     <button class="announcement-bar-close" data-dismiss aria-label="Dismiss announcement">
 *       <svg>...</svg>
 *     </button>
 *   </announcement-bar>
 */
class AnnouncementBar extends HTMLElement {
  connectedCallback() {
    const storageKey = this.getDismissKey();

    // If previously dismissed, remove immediately
    try {
      if (localStorage.getItem(storageKey)) {
        this.remove();
        return;
      }
    } catch {
      // localStorage unavailable (private browsing, quota exceeded) —
      // show the bar, dismiss just won't persist across sessions
    }

    // Listen for dismiss button click
    const dismissButton = this.querySelector('[data-dismiss]');
    dismissButton?.addEventListener('click', () => {
      try {
        localStorage.setItem(storageKey, 'true');
      } catch {
        // Storage failed — dismiss still works visually this session
      }

      // Fade out then remove
      this.style.transition = 'opacity 0.3s ease';
      this.style.opacity = '0';

      // Remove after the transition completes
      this.addEventListener('transitionend', () => this.remove(), { once: true });

      // Fallback removal if transitionend never fires (e.g. reduced motion)
      setTimeout(() => {
        if (this.parentNode) this.remove();
      }, 350);
    });
  }

  /**
   * Build the localStorage key for dismiss state. Uses data-dismiss-key
   * (set from Liquid) if available, otherwise falls back to a hash of the
   * element's text content so key changes when the announcement changes.
   * @returns {string}
   */
  getDismissKey() {
    if (this.dataset.dismissKey) {
      return `dismissed-announcement-${this.dataset.dismissKey}`;
    }

    // Fallback: simple hash of text content
    const text = this.textContent.trim();
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return `dismissed-announcement-${hash}`;
  }
}

customElements.define('announcement-bar', AnnouncementBar);
