/*
  <product-card-hover-video>

  Pattern: <source data-src=...> ships zero MP4 bytes per card. First hover
  (after an 80ms intent debounce) promotes data-src → src and calls
  video.load() + play(). After that the file is cached for the session, so
  subsequent hovers are instant.

  Hover in  → 80ms intent debounce → play forward (native, smooth)
  Hover out → play in REVERSE back to frame 0, then fade to the poster

  MP4 has no native reverse, so the rewind is faked: an rAF loop decrements
  video.currentTime by the real elapsed delta each frame (time-based, so the
  rewind mirrors the forward play at natural 1× speed and is FPS-agnostic).
  When it reaches frame 0 we drop .is-active and the CSS opacity fade hands
  back to the always-visible poster <img> underneath.

  Visibility is JS-driven via .is-active (set on enter, cleared when reverse
  completes) rather than pure :hover — otherwise CSS would fade the video out
  the instant the cursor leaves and the rewind would play invisibly. See the
  matching CSS in snippets/product-card.liquid.

  We swallow the inevitable AbortError from pause()-while-play()-pending via
  .catch() on the stored playPromise.

  prefers-reduced-motion: reduce → skip play and reverse entirely. CSS also
  keeps the video hidden, so the user just sees the static <img>.
*/

const INTENT_DELAY_MS = 80;

class ProductCardHoverVideo extends HTMLElement {
  connectedCallback() {
    this.video = this.querySelector('video');
    this.source = this.video?.querySelector('source');
    this.card = this.closest('.product-card');
    if (!this.video || !this.source || !this.card) return;

    this.playPromise = null;
    this.intentTimeout = null;
    this.reverseRaf = 0;
    this.reverseLastTs = 0;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.handleEnter = this.handleEnter.bind(this);
    this.handleLeave = this.handleLeave.bind(this);
    this.reverseStep = this.reverseStep.bind(this);
    this.card.addEventListener('mouseenter', this.handleEnter);
    this.card.addEventListener('mouseleave', this.handleLeave);
  }

  disconnectedCallback() {
    this.card?.removeEventListener('mouseenter', this.handleEnter);
    this.card?.removeEventListener('mouseleave', this.handleLeave);
    if (this.intentTimeout) clearTimeout(this.intentTimeout);
    this.stopReverse();
  }

  handleEnter() {
    if (this.reducedMotion) return;

    if (this.intentTimeout) clearTimeout(this.intentTimeout);
    this.intentTimeout = setTimeout(() => {
      this.intentTimeout = null;
      this.startPlay();
    }, INTENT_DELAY_MS);
  }

  startPlay() {
    if (!this.source.src && this.source.dataset.src) {
      this.source.src = this.source.dataset.src;
      this.video.load();
    }

    // Resuming forward cancels any in-flight rewind and reveals the video.
    this.stopReverse();
    this.classList.add('is-active');

    const promise = this.video.play();
    if (promise !== undefined) {
      this.playPromise = promise;
      promise.catch(() => {});
    }
  }

  handleLeave() {
    if (this.reducedMotion || !this.video) return;

    // Cursor moved out before the intent timer fired — never committed to
    // loading this video. Cancel and bail without any fetch or playback.
    if (this.intentTimeout) {
      clearTimeout(this.intentTimeout);
      this.intentTimeout = null;
      return;
    }

    if (this.playPromise) {
      this.playPromise.catch(() => {});
      this.playPromise = null;
    }

    this.video.pause();
    this.startReverse();
  }

  startReverse() {
    if (this.reverseRaf) return;
    this.reverseLastTs = 0;
    this.reverseRaf = requestAnimationFrame(this.reverseStep);
  }

  reverseStep(ts) {
    if (!this.reverseLastTs) this.reverseLastTs = ts;
    const dt = (ts - this.reverseLastTs) / 1000;
    this.reverseLastTs = ts;

    const next = this.video.currentTime - dt;
    if (next <= 0) {
      this.video.currentTime = 0;
      this.reverseRaf = 0;
      // Rewind done — release to the static poster (CSS fades it back).
      this.classList.remove('is-active');
      return;
    }

    this.video.currentTime = next;
    this.reverseRaf = requestAnimationFrame(this.reverseStep);
  }

  stopReverse() {
    if (this.reverseRaf) cancelAnimationFrame(this.reverseRaf);
    this.reverseRaf = 0;
  }
}

customElements.define('product-card-hover-video', ProductCardHoverVideo);
