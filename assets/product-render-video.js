/*
  <product-render-video> — wraps the PDP render video so it plays once on load
  and re-plays from the start each time the user scrolls back to it. No looping.

  Markup:
    <product-render-video>
      <video autoplay muted playsinline …>…</video>
    </product-render-video>

  Behaviour:
    - On connect, find the inner <video> and make sure `loop` is off.
    - Observe self with IntersectionObserver (threshold 0.5 — fires when at
      least half of the element is in the viewport). Each enter resets the
      video to 0 and calls play(); autoplay handles the very first start when
      the video happens to be in view at page load.

  Web Components convention: light DOM, ES module, one file per component
  (see .claude/conventions/architecture.md).
*/

class ProductRenderVideo extends HTMLElement {
  connectedCallback() {
    this.video = this.querySelector('video');
    if (!this.video) return;

    this.video.removeAttribute('loop');
    this.video.loop = false;

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.video.currentTime = 0;
            this.video.play().catch(() => {
              /* Autoplay can be blocked when the tab is in the background or
                 the user hasn't interacted. Ignore silently. */
            });
          }
        }
      },
      { threshold: 0.5 }
    );

    this.observer.observe(this);
  }

  disconnectedCallback() {
    this.observer?.disconnect();
  }
}

customElements.define('product-render-video', ProductRenderVideo);
