class ProductRecommendations extends HTMLElement {
  connectedCallback() {
    this.observer = new IntersectionObserver(
      (entries, observer) => {
        if (!entries[0].isIntersecting) return;
        observer.disconnect();
        this.loadRecommendations();
      },
      { rootMargin: '0px 0px 400px 0px' }
    );
    this.observer.observe(this);
  }

  disconnectedCallback() {
    this.observer?.disconnect();
  }

  loadRecommendations() {
    const url = this.dataset.url;
    if (!url) return;

    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((html) => {
        const fragment = document.createElement('div');
        fragment.innerHTML = html;
        const recommendations = fragment.querySelector('product-recommendations');

        if (recommendations && recommendations.innerHTML.trim().length) {
          this.innerHTML = recommendations.innerHTML;
          // <script> tags inserted via innerHTML are inert — browsers will
          // park them in the DOM but never execute. Clone each one into a
          // fresh <script> so the browser actually runs it. This is how the
          // per-card modules emitted by product-card.liquid
          // (product-card-hover-video.js, product-card-quick-add.js) get
          // registered on a PDP that has no other product cards on the page.
          // Module scripts are deduped by URL, so multiple cards emitting
          // the same `<script type="module" src="…">` only evaluate once.
          this.querySelectorAll('script').forEach((oldScript) => {
            const newScript = document.createElement('script');
            for (const attr of oldScript.attributes) {
              newScript.setAttribute(attr.name, attr.value);
            }
            if (oldScript.textContent) newScript.textContent = oldScript.textContent;
            oldScript.replaceWith(newScript);
          });
        } else {
          this.remove();
        }
      })
      .catch(() => {
        this.remove();
      });
  }
}

customElements.define('product-recommendations', ProductRecommendations);
