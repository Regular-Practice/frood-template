/**
 * Search Drawer Web Component
 *
 * Slide-from-right drawer with predictive search. Fetches results from
 * Shopify's Predictive Search API (/search/suggest.json) as the user types,
 * with debounce and race-condition guarding. The form still submits to
 * /search as a progressive-enhancement fallback.
 *
 * Expected markup:
 *   <search-drawer id="search-drawer" role="dialog" aria-modal="true" aria-hidden="true"
 *     data-products-heading="Products" data-articles-heading="Articles"
 *     data-pages-heading="Pages" data-view-all-text="View all results"
 *     data-no-results-template='No results for "__TERMS__"'>
 *     <div class="search-drawer-overlay" data-overlay></div>
 *     <div class="search-drawer-panel">
 *       <div class="search-drawer-header">...</div>
 *       <div class="search-drawer-body">
 *         <form role="search">
 *           <input data-input type="search" name="q">
 *         </form>
 *         <div data-results aria-live="polite"></div>
 *         <div data-empty hidden></div>
 *       </div>
 *     </div>
 *   </search-drawer>
 */
class SearchDrawer extends HTMLElement {
  connectedCallback() {
    this.overlay = this.querySelector('[data-overlay]');
    this.closeBtn = this.querySelector('[data-close]');
    this.input = this.querySelector('[data-input]');
    this.resultsContainer = this.querySelector('[data-results]');
    this.emptyContainer = this.querySelector('[data-empty]');
    this.previouslyFocused = null;
    this.requestId = 0;
    this.debounceTimer = null;

    this.handleKeydown = this.handleKeydown.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);

    this.closeBtn?.addEventListener('click', () => this.close());
    this.overlay?.addEventListener('click', () => this.close());

    this.input?.addEventListener('input', () => this.onInput());
    this.querySelector('form')?.addEventListener('submit', this.handleSubmit);

    // Wire up the trigger button in the header
    this.trigger = document.querySelector('[aria-controls="search-drawer"]');
    if (this.trigger) {
      this.trigger.addEventListener('click', (e) => {
        e.preventDefault();
        this.open();
      });
    }
  }

  disconnectedCallback() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.querySelector('form')?.removeEventListener('submit', this.handleSubmit);
  }

  get isOpen() {
    return this.classList.contains('is-open');
  }

  open() {
    this.previouslyFocused = document.activeElement;

    this.classList.add('is-open');
    this.setAttribute('aria-hidden', 'false');
    document.body.classList.add('search-drawer-open');

    if (this.trigger) {
      this.trigger.setAttribute('aria-expanded', 'true');
    }

    document.addEventListener('keydown', this.handleKeydown);

    // Focus the search input so user can start typing immediately
    if (this.input) {
      this.input.focus();
      this.input.select();
    }

    window.froodTrack?.('search_opened');
  }

  handleSubmit() {
    const query = this.input?.value.trim() || '';
    window.froodTrack?.('search_submitted', {
      q_length: query.length,
      has_query: query.length > 0
    });
  }

  close() {
    this.classList.remove('is-open');
    this.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('search-drawer-open');

    if (this.trigger) {
      this.trigger.setAttribute('aria-expanded', 'false');
    }

    document.removeEventListener('keydown', this.handleKeydown);

    if (this.previouslyFocused) {
      this.previouslyFocused.focus();
      this.previouslyFocused = null;
    }
  }

  handleKeydown(e) {
    if (e.key === 'Escape') {
      this.close();
      return;
    }

    if (e.key !== 'Tab') return;

    const focusableElements = this.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return;

    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === firstFocusable) {
      e.preventDefault();
      lastFocusable.focus();
    } else if (!e.shiftKey && document.activeElement === lastFocusable) {
      e.preventDefault();
      firstFocusable.focus();
    }
  }

  onInput() {
    const query = this.input.value.trim();

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    if (query.length < 2) {
      this.clearResults();
      return;
    }

    this.debounceTimer = setTimeout(() => this.fetchResults(query), 300);
  }

  async fetchResults(query) {
    const currentRequest = ++this.requestId;

    this.classList.add('is-loading');

    try {
      const url = `/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product,article,page&resources[limit]=4`;
      const response = await fetch(url, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });

      if (!response.ok || currentRequest !== this.requestId) return;

      const data = await response.json();
      this.renderResults(data, query);
    } finally {
      if (currentRequest === this.requestId) {
        this.classList.remove('is-loading');
      }
    }
  }

  renderResults(data, query) {
    const resources = data.resources?.results;
    if (!resources) {
      this.clearResults();
      return;
    }

    const products = resources.products || [];
    const articles = resources.articles || [];
    const pages = resources.pages || [];

    if (products.length === 0 && articles.length === 0 && pages.length === 0) {
      this.resultsContainer.innerHTML = '';
      this.emptyContainer.hidden = false;
      const template = this.dataset.noResultsTemplate || 'No results for "__TERMS__"';
      this.emptyContainer.textContent = template.replace('__TERMS__', query);
      return;
    }

    this.emptyContainer.hidden = true;
    let html = '';

    if (products.length > 0) {
      html += this.renderGroup(
        this.dataset.productsHeading || 'Products',
        products.map(p => this.renderProductItem(p))
      );
    }

    if (articles.length > 0) {
      html += this.renderGroup(
        this.dataset.articlesHeading || 'Articles',
        articles.map(a => this.renderLinkItem(a.url, a.title))
      );
    }

    if (pages.length > 0) {
      html += this.renderGroup(
        this.dataset.pagesHeading || 'Pages',
        pages.map(p => this.renderLinkItem(p.url, p.title))
      );
    }

    // "View all results" link
    const viewAllText = this.dataset.viewAllText || 'View all results';
    html += `<a href="/search?q=${encodeURIComponent(query)}" class="search-drawer-view-all">${this.escapeHtml(viewAllText)}</a>`;

    this.resultsContainer.innerHTML = html;
  }

  renderGroup(heading, itemsHtml) {
    return `<div class="search-drawer-results-group">
      <h3 class="search-drawer-results-heading">${this.escapeHtml(heading)}</h3>
      ${itemsHtml.join('')}
    </div>`;
  }

  renderProductItem(product) {
    const imageHtml = product.image
      ? `<img class="search-drawer-result-image" src="${this.escapeHtml(product.image)}" alt="" width="48" height="48" loading="lazy">`
      : '';

    const priceHtml = product.price
      ? `<span class="search-drawer-result-price">${this.escapeHtml(product.price)}</span>`
      : '';

    return `<a href="${this.escapeHtml(product.url)}" class="search-drawer-result-item">
      ${imageHtml}
      <span class="search-drawer-result-info">
        <span class="search-drawer-result-title">${this.escapeHtml(product.title)}</span>
        ${priceHtml}
      </span>
    </a>`;
  }

  renderLinkItem(url, title) {
    return `<a href="${this.escapeHtml(url)}" class="search-drawer-result-item">
      <span class="search-drawer-result-info">
        <span class="search-drawer-result-title">${this.escapeHtml(title)}</span>
      </span>
    </a>`;
  }

  clearResults() {
    this.resultsContainer.innerHTML = '';
    this.emptyContainer.hidden = true;
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

customElements.define('search-drawer', SearchDrawer);
