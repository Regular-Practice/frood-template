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

  Markup:
    <product-render-video [loop-delay="10000"]>
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

    const loopDelayAttr = this.getAttribute('loop-delay');
    this.loopDelay = loopDelayAttr === null ? null : parseInt(loopDelayAttr, 10);
    this.loopTimeout = null;
    this.isInView = false;

    if (this.loopDelay !== null && !Number.isNaN(this.loopDelay)) {
      this.handleEnded = () => {
        if (!this.isInView) return;
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
            if (this.loopTimeout) {
              clearTimeout(this.loopTimeout);
              this.loopTimeout = null;
            }
            this.video.currentTime = 0;
            this.video.play().catch(() => {
              /* Autoplay can be blocked when the tab is in the background or
                 the user hasn't interacted. Ignore silently. */
            });
          } else if (this.loopTimeout) {
            clearTimeout(this.loopTimeout);
            this.loopTimeout = null;
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
    if (this.handleEnded) this.video?.removeEventListener('ended', this.handleEnded);
  }
}

customElements.define('product-render-video', ProductRenderVideo);
