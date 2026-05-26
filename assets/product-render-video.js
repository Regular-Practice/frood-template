/*
  <product-render-video> — wraps a product render video.

  Default behaviour (no attributes):
    Plays once on load and re-plays from 0 each time the user scrolls back to it.
    No looping. Used by the PDP.

  With loop-delay="<ms>":
    After the video ends, waits <ms> milliseconds and replays from 0, so long as
    the element is still in view. If the element leaves the viewport during the
    pause, the pending replay is cancelled; re-entering resets the cycle (plays
    from 0 immediately). Used by the hero product feature card.

  With defer-first-play-until="<selector>":
    Pauses the video immediately on mount and waits for the closest ancestor
    matching <selector> to fire `animationend` before the first play. Used by
    the hero to sync video start with the card's staggered fade-in (otherwise
    the video is well into playback by the time the card becomes visible).
    Pair with preload="auto" on the <video> so the file is buffered and ready
    by the time the animation ends.

  Canvas paint (always on):
    The inner <video> is hidden (1px / opacity:0, kept in-DOM so iOS Safari
    plays it inline) and a sibling <canvas> is painted from it on a setTimeout
    loop (~33fps). The canvas uses the browser's IMAGE colour path, so the
    video's baked-in flat background blends seamlessly with the surrounding
    CSS hex on macOS / wide-gamut displays — fixes the well-known macOS
    <video> colour-management drift, while keeping the existing Shopify-hosted
    MP4 untouched (no re-encode, no transparency, no CORS setup — we only
    draw, never read pixels). Painting is gated by IntersectionObserver +
    document.hidden so offscreen / tab-hidden instances don't burn CPU.

  Markup:
    <product-render-video [loop-delay="10000"] [defer-first-play-until=".card"]>
      <video autoplay muted playsinline …>…</video>
    </product-render-video>

  Web Components convention: light DOM, ES module, one file per component
  (see .claude/conventions/architecture.md).
*/

class ProductRenderVideo extends HTMLElement {
  connectedCallback() {
    this.video = this.querySelector('video');
    if (!this.video) return;

    this.video.removeAttribute('loop');
    this.video.loop = false;

    // --- Canvas paint setup (see header comment for why) ---
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    Object.assign(this.canvas.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      objectFit: 'cover',
    });
    // Hide the <video> without removing it: iOS Safari needs it in-document
    // for inline playback. 1px + opacity:0 + pointer-events:none = visually
    // gone but still decoding.
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
      // Paint frame 0 immediately so the canvas isn't blank before IO triggers.
      if (this.video.readyState >= 2) {
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      }
    };
    if (this.video.readyState >= 1) {
      this.handleLoadedMetadata();
    } else {
      this.video.addEventListener('loadedmetadata', this.handleLoadedMetadata);
    }

    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    this.startPainting = () => {
      if (this.isPainting) return;
      this.isPainting = true;
      this.paintFrame();
    };
    this.stopPainting = () => {
      this.isPainting = false;
      if (this.paintTimeout) {
        clearTimeout(this.paintTimeout);
        this.paintTimeout = null;
      }
    };

    // --- Play / loop / IO setup ---
    const loopDelayAttr = this.getAttribute('loop-delay');
    this.loopDelay = loopDelayAttr === null ? null : parseInt(loopDelayAttr, 10);
    this.loopTimeout = null;
    this.isInView = false;

    const deferSelector = this.getAttribute('defer-first-play-until');
    const deferTarget = deferSelector ? this.closest(deferSelector) : null;
    this.deferFirstPlay = !!deferTarget;

    if (this.deferFirstPlay) {
      // Cancel the <video autoplay> race so the file buffers in the background
      // but no frames burn until the parent animation finishes.
      this.video.pause();
      this.video.currentTime = 0;
      this.handleAnimationEnd = () => {
        this.deferFirstPlay = false;
        if (this.isInView && !this.reducedMotion) {
          this.video.currentTime = 0;
          this.video.play().catch(() => {});
        }
      };
      deferTarget.addEventListener('animationend', this.handleAnimationEnd, { once: true });
      this.deferTarget = deferTarget;
    }

    if (this.reducedMotion) {
      // Show a still frame only — don't autoplay, don't loop.
      this.video.pause();
      this.video.currentTime = 0;
    }

    if (this.loopDelay !== null && !Number.isNaN(this.loopDelay)) {
      this.handleEnded = () => {
        if (!this.isInView || this.reducedMotion) return;
        this.loopTimeout = setTimeout(() => {
          this.loopTimeout = null;
          if (!this.isInView) return;
          this.video.currentTime = 0;
          this.video.play().catch(() => {});
        }, this.loopDelay);
      };
      this.video.addEventListener('ended', this.handleEnded);
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          this.isInView = entry.isIntersecting;
          if (entry.isIntersecting) {
            this.startPainting();
            if (this.loopTimeout) {
              clearTimeout(this.loopTimeout);
              this.loopTimeout = null;
            }
            if (this.deferFirstPlay || this.reducedMotion) continue;
            this.video.currentTime = 0;
            this.video.play().catch(() => {
              /* Autoplay can be blocked when the tab is in the background or
                 the user hasn't interacted. Ignore silently. */
            });
          } else {
            this.stopPainting();
            if (this.loopTimeout) {
              clearTimeout(this.loopTimeout);
              this.loopTimeout = null;
            }
          }
        }
      },
      { threshold: 0.5 }
    );

    this.observer.observe(this);
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    if (this.loopTimeout) clearTimeout(this.loopTimeout);
    if (this.paintTimeout) clearTimeout(this.paintTimeout);
    if (this.handleEnded) this.video?.removeEventListener('ended', this.handleEnded);
    if (this.handleAnimationEnd && this.deferTarget) {
      this.deferTarget.removeEventListener('animationend', this.handleAnimationEnd);
    }
    if (this.handleLoadedMetadata && this.video) {
      this.video.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
    }
  }
}

customElements.define('product-render-video', ProductRenderVideo);
