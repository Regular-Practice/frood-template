/**
 * Product Recommendations Carousel
 *
 * Embla drag-and-slide carousel for the product-recommendations section.
 * Slide width is controlled in CSS via flex-basis (responsive).
 * Prev/next arrow buttons overlay the carousel and are hidden via the
 * `hidden` attribute when there's nothing more to scroll in that direction.
 *
 * Nests inside the outer <product-recommendations> element. When the
 * Section Rendering API swap replaces innerHTML, the old instance gets
 * disconnected (cleanup) and the new one connected (init).
 */
class ProductRecommendationsCarousel extends HTMLElement {
  connectedCallback() {
    this.viewport = this.querySelector('.product-recommendations-viewport');
    this.slides = this.querySelectorAll('.product-recommendations-slide');
    this.prevButton = this.querySelector('.product-recommendations-arrow[data-direction="prev"]');
    this.nextButton = this.querySelector('.product-recommendations-arrow[data-direction="next"]');

    if (!this.viewport || this.slides.length < 2) return;

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
      loop: false,
      watchDrag: true,
      align: 'center',
      containScroll: '',
      breakpoints: {
        '(min-width: 600px)': { align: 'start', containScroll: 'trimSnaps' },
        '(min-width: 900px)': { active: false },
      },
    });
    this.classList.add('is-initialized');

    this._onPrevClick = () => this.embla.scrollPrev();
    this._onNextClick = () => this.embla.scrollNext();
    this._onSelect = () => this._updateButtonVisibility();

    if (this.prevButton) this.prevButton.addEventListener('click', this._onPrevClick);
    if (this.nextButton) this.nextButton.addEventListener('click', this._onNextClick);

    this.embla.on('select', this._onSelect);
    this.embla.on('reInit', this._onSelect);

    this._updateButtonVisibility();
  }

  _updateButtonVisibility() {
    if (!this.embla) return;
    if (this.prevButton) this.prevButton.hidden = !this.embla.canScrollPrev();
    if (this.nextButton) this.nextButton.hidden = !this.embla.canScrollNext();
  }

  disconnectedCallback() {
    if (this.prevButton && this._onPrevClick) {
      this.prevButton.removeEventListener('click', this._onPrevClick);
    }
    if (this.nextButton && this._onNextClick) {
      this.nextButton.removeEventListener('click', this._onNextClick);
    }
    if (this.embla) this.embla.destroy();
  }
}

customElements.define('product-recommendations-carousel', ProductRecommendationsCarousel);
