/**
 * Image Carousel
 *
 * Embla infinite-loop carousel that autoplays through image slides and
 * supports drag-and-slide. Autoplay pauses on hover, when the tab is hidden,
 * and when the user has prefers-reduced-motion.
 *
 * Expected markup:
 *   <image-carousel data-interval="4000">
 *     <div class="image-carousel-viewport">
 *       <div class="image-carousel-container">
 *         <div class="image-carousel-slide">...</div>
 *       </div>
 *     </div>
 *   </image-carousel>
 */
class ImageCarousel extends HTMLElement {
  connectedCallback() {
    this.viewport = this.querySelector('.image-carousel-viewport');
    this.slides = this.querySelectorAll('.image-carousel-slide');

    if (!this.viewport || this.slides.length < 2) return;

    this.interval = parseInt(this.dataset.interval, 10) || 4000;

    if (typeof window.EmblaCarousel === 'undefined') {
      const script = document.querySelector('script[src*="embla-carousel"]');
      if (script) {
        script.addEventListener('load', () => this._init(), { once: true });
      }
      return;
    }

    this._init();
  }

  _init() {
    this.embla = window.EmblaCarousel(this.viewport, {
      loop: true,
      watchDrag: true,
      align: 'start',
      containScroll: false,
    });
    this.classList.add('is-initialized');

    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!this.reducedMotion.matches) this._startAutoplay();

    this._onEnter = () => this._stopAutoplay();
    this._onLeave = () => { if (!this.reducedMotion.matches) this._startAutoplay(); };
    this._onVisibility = () => {
      if (document.hidden) this._stopAutoplay();
      else if (!this.reducedMotion.matches) this._startAutoplay();
    };
    this._onMotionChange = () => {
      if (this.reducedMotion.matches) this._stopAutoplay();
      else this._startAutoplay();
    };

    this.addEventListener('mouseenter', this._onEnter);
    this.addEventListener('mouseleave', this._onLeave);
    this.addEventListener('focusin', this._onEnter);
    this.addEventListener('focusout', this._onLeave);
    document.addEventListener('visibilitychange', this._onVisibility);
    this.reducedMotion.addEventListener('change', this._onMotionChange);

    // Pause while the user is actively dragging; resume when they let go.
    this.embla.on('pointerDown', () => this._stopAutoplay());
    this.embla.on('pointerUp', () => {
      if (!this.reducedMotion.matches) this._startAutoplay();
    });
  }

  _startAutoplay() {
    this._stopAutoplay();
    this.timer = setInterval(() => this.embla?.scrollNext(), this.interval);
  }

  _stopAutoplay() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  disconnectedCallback() {
    this._stopAutoplay();
    this.removeEventListener('mouseenter', this._onEnter);
    this.removeEventListener('mouseleave', this._onLeave);
    this.removeEventListener('focusin', this._onEnter);
    this.removeEventListener('focusout', this._onLeave);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.reducedMotion?.removeEventListener('change', this._onMotionChange);
    if (this.embla) this.embla.destroy();
  }
}

customElements.define('image-carousel', ImageCarousel);
