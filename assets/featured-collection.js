/**
 * Featured Collection Carousel
 *
 * Embla drag-and-slide carousel for the featured-collection section.
 * Slide width is controlled in CSS via flex-basis (responsive).
 * Prev/next arrow buttons overlay the carousel and are hidden via the
 * `hidden` attribute when there's nothing more to scroll in that direction.
 *
 * Expected markup:
 *   <featured-collection-carousel>
 *     <div class="featured-collection-viewport">
 *       <div class="featured-collection-container">
 *         <div class="featured-collection-slide">...</div>
 *       </div>
 *     </div>
 *     <button class="featured-collection-arrow" data-direction="prev" hidden>...</button>
 *     <button class="featured-collection-arrow" data-direction="next" hidden>...</button>
 *   </featured-collection-carousel>
 */
class FeaturedCollectionCarousel extends HTMLElement {
  connectedCallback() {
    this.viewport = this.querySelector('.featured-collection-viewport');
    this.slides = this.querySelectorAll('.featured-collection-slide');
    this.prevButton = this.querySelector('.featured-collection-arrow[data-direction="prev"]');
    this.nextButton = this.querySelector('.featured-collection-arrow[data-direction="next"]');

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
      align: 'start',
      containScroll: 'trimSnaps',
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

customElements.define('featured-collection-carousel', FeaturedCollectionCarousel);
