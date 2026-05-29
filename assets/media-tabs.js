// Image-only tabs have no `ended` event to drive auto-advance, so we fall back
// to a fixed timer. 4s matches the rhythm of a short looping video clip.
const IMAGE_ADVANCE_MS = 4000;

class MediaTabs extends HTMLElement {
  connectedCallback() {
    this.tabs = Array.from(this.querySelectorAll('.media-tab'));
    this.videos = this.tabs.map((tab) => tab.querySelector('video'));
    this.activeIndex = 0;
    this.imageTimer = null;

    if (this.tabs.length === 0) return;

    this.tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => this.setActive(i));
      // Hover (and keyboard focus) jumps to that card. Guard against
      // re-triggering on the already-active card so its video doesn't
      // restart when the mouse lands on it. After hover-leave we do
      // nothing: the active card just plays out and auto-advances normally.
      const activateOnEngage = () => {
        if (this.activeIndex !== i) this.setActive(i);
      };
      tab.addEventListener('mouseenter', activateOnEngage);
      tab.addEventListener('focus', activateOnEngage);
    });

    this.videos.forEach((video, i) => {
      if (!video) return;
      video.addEventListener('ended', () => {
        if (i === this.activeIndex) {
          this.setActive((i + 1) % this.tabs.length);
        }
      });
    });

    // Mobile + tablet (<900px): cards stack vertically, so the card crossing
    // the viewport's vertical midline as the user scrolls becomes active.
    // Gated by matchMedia so desktop (cards side-by-side) is untouched —
    // there, all three cards intersect the center line at the same time,
    // which would be chaotic. rootMargin: '-50% 0px -50% 0px' collapses the
    // observer's "root" to a 1px-tall line at viewport center.
    this.viewportMQ = window.matchMedia('(max-width: 899.98px)');
    this.scrollObserver = new IntersectionObserver(
      (entries) => {
        if (!this.viewportMQ.matches) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const i = this.tabs.indexOf(entry.target);
            if (i !== -1 && i !== this.activeIndex) this.setActive(i);
          }
        }
      },
      { rootMargin: '-50% 0px -50% 0px', threshold: 0 }
    );
    this.tabs.forEach((tab) => this.scrollObserver.observe(tab));

    this.setActive(0);
  }

  disconnectedCallback() {
    this.scrollObserver?.disconnect();
    if (this.imageTimer) clearTimeout(this.imageTimer);
  }

  setActive(index) {
    this.activeIndex = index;

    if (this.imageTimer) {
      clearTimeout(this.imageTimer);
      this.imageTimer = null;
    }

    this.tabs.forEach((tab, i) => {
      const isActive = i === index;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-current', isActive ? 'true' : 'false');

      const video = this.videos[i];
      if (!video) return;

      if (isActive) {
        try {
          video.currentTime = 0;
        } catch (_) {
          // Some browsers throw before metadata loads — safe to ignore.
        }
        video.play().catch(() => {
          // Autoplay blocked; user interaction will resume it.
        });
      } else {
        video.pause();
      }
    });

    if (!this.videos[index]) {
      this.imageTimer = setTimeout(() => {
        if (this.activeIndex === index) {
          this.setActive((index + 1) % this.tabs.length);
        }
      }, IMAGE_ADVANCE_MS);
    }
  }
}

customElements.define('media-tabs', MediaTabs);
