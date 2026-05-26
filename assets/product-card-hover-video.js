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

  Canvas paint (mirrors <product-render-video> in assets/product-render-video.js):
    The inner <video> is hidden (1px / opacity:0, kept in-DOM for correctness)
    and a sibling <canvas> is painted from it on a setTimeout loop (~33fps)
    while the card is hovered or rewinding. The canvas uses the browser's
    IMAGE colour path, so the video's baked-in flat background blends
    seamlessly with the surrounding CSS hex on macOS / wide-gamut displays —
    fixes the macOS <video> colour-management drift, while keeping the
    existing Shopify-hosted MP4 untouched.

    Start/stop of the paint loop is decoupled from the hover code: a
    MutationObserver watches the host's `class` attribute and toggles the
    loop on `.is-active`. The hover/reverse methods don't need to know the
    canvas exists — they already add/remove `.is-active` at the right
    moments. Idle cards burn no CPU; only the hovered one paints at a time.
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

    // --- Canvas paint setup (see header comment for why) ---
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    Object.assign(this.canvas.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      objectFit: 'cover',
    });
    // Hide the <video> without removing it from the DOM. Inline styles
    // override the .product-card-video class rules.
    Object.assign(this.video.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    });
    this.insertBefore(this.canvas, this.video);

    this.handleLoadedMetadata = () => {
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;
      if (this.video.readyState >= 2) {
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      }
    };
    this.video.addEventListener('loadedmetadata', this.handleLoadedMetadata);

    this.paintTimeout = null;
    this.isPainting = false;
    this.paintFrame = () => {
      if (!this.isPainting) return;
      if (!document.hidden && this.video.readyState >= 2 && this.canvas.width > 0) {
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      }
      // ~33fps; lighter than rAF for this use.
      this.paintTimeout = setTimeout(this.paintFrame, 30);
    };

    // MutationObserver toggles the paint loop off `.is-active` so the hover
    // and reverse logic below stays untouched. .is-active is set by
    // startPlay() and removed by reverseStep() at frame 0 — exactly the
    // window in which the canvas needs to be painting.
    this.classObserver = new MutationObserver(() => {
      if (this.classList.contains('is-active')) {
        if (!this.isPainting) {
          this.isPainting = true;
          this.paintFrame();
        }
      } else if (this.isPainting) {
        this.isPainting = false;
        if (this.paintTimeout) {
          clearTimeout(this.paintTimeout);
          this.paintTimeout = null;
        }
      }
    });
    this.classObserver.observe(this, { attributes: true, attributeFilter: ['class'] });

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
    this.classObserver?.disconnect();
    if (this.paintTimeout) clearTimeout(this.paintTimeout);
    this.video?.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
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
