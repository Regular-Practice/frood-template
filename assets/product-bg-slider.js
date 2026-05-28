/**
 * Product Background Slider Web Component
 *
 * Embla slide-and-drag carousel that sits as the background of the
 * main-product section. Source media is product.media from index 2 onwards
 * (the first two media entries are reserved for the foreground gallery).
 *
 * Expected markup (rendered by sections/main-product.liquid):
 *   <product-bg-slider class="product-bg-slider" aria-hidden="true">
 *     <div class="product-bg-slider-viewport">
 *       <div class="product-bg-slider-container">
 *         <div class="product-bg-slider-slide">...</div>
 *       </div>
 *     </div>
 *   </product-bg-slider>
 */
class ProductBgSlider extends HTMLElement {
  connectedCallback() {
    this.viewport = this.querySelector('.product-bg-slider-viewport');
    this.slides = this.querySelectorAll('.product-bg-slider-slide');

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
      loop: true,
      watchDrag: true,
      duration: 30,
    });
    this.classList.add('is-initialized');

    // Nav buttons — pills pinned to the bottom-right of the slider, styled
    // like the recipe video play/pause pill. Only wired once embla is up so
    // a single-slide slider (where embla bails) doesn't get dead controls.
    this.prevBtn = this.querySelector('.product-bg-slider-prev');
    this.nextBtn = this.querySelector('.product-bg-slider-next');
    this._onPrev = () => this.embla.scrollPrev();
    this._onNext = () => this.embla.scrollNext();
    this.prevBtn?.addEventListener('click', this._onPrev);
    this.nextBtn?.addEventListener('click', this._onNext);
  }

  disconnectedCallback() {
    this.prevBtn?.removeEventListener('click', this._onPrev);
    this.nextBtn?.removeEventListener('click', this._onNext);
    if (this.embla) {
      this.embla.destroy();
    }
  }
}

customElements.define('product-bg-slider', ProductBgSlider);
