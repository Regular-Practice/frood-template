# Architecture Conventions

> CSS, JavaScript, Liquid, animation, layout, and i18n patterns. For rationale behind choices, see `decisions.md`.

---

## CSS

### Approach

- Vanilla CSS with custom properties — no preprocessor, no build step
- Mobile-first responsive design
- Simple semantic class names — **no BEM, no utility classes**

### Class Naming

```css
/* DO: Descriptive, flat names */
.product-card { }
.product-card-title { }
.product-card-price { }

/* DON'T: BEM notation */
.product-card__title { }
.product-card--featured { }

/* DON'T: Utility classes */
.mt-4 { }
.flex { }
```

Modifiers use plain compound selectors:
```css
.product-card.sold-out { opacity: 0.6; }
.product-card.featured { border: 2px solid var(--color-text); }
```

### Breakpoints (mobile-first)

| Name | Min-width | Usage |
|------|-----------|-------|
| Mobile | 0 (default) | Base styles |
| Tablet | `600px` | Two-column layouts |
| Desktop | `900px` | Three-column grids, typography bumps |
| Large | `1500px` | Wide content areas, max-width constraints |

Typography also responds at `1600px`.

### Z-Index Scale

Raw numbers (not tokens):

| Element | Z-index |
|---------|---------|
| Header | `9` |
| Footer | `10` |
| Mobile menu | `99` |
| Lightbox / modals | `999` |
| Skip link | `9999` |

### Background Tint

**There is no merchant color-scheme picker.** The old Shopify `color_scheme_group` system (5 schemes + a `theme.liquid` generator emitting `.color-scheme-N` rules) was removed — in practice only one section ever used a non-default scheme, and the brand locks buttons/accents/inputs regardless. Backgrounds are now brand-locked to two tones:

| Tone | Variable | Class |
|------|----------|-------|
| Default | `--color-bg` (warm off-white `#fffef9`) | none |
| Tinted | `--color-bg-dark` (warm beige/stone `#dfdcd4`) | `.bg-tinted` |

**How it works:**

1. `base.css` §3 defines `.bg-tinted { --color-bg: var(--color-bg-dark); }` — that's the whole mechanism.
2. Component styles already use semantic tokens (`var(--color-bg)`, `var(--color-text)`), so adding `.bg-tinted` to a section wrapper swaps just the background; text and other tokens stay on `:root` values.
3. The tint is **hardcoded in markup**, not a setting. Currently only `product-recommendations` carries it.

**Critical:** Don't add a `color_scheme` setting, a `color-` / `color-scheme-N` class, or any per-section background control. If a section needs the beige tone, put `.bg-tinted` in its markup; if it needs to be merchant-toggleable, that's a design decision — don't reintroduce the multi-scheme picker.

### Section Styles

Section-specific CSS lives inside section files using `{% stylesheet %}` (not `<style>`):

```liquid
{% stylesheet %}
  .hero-banner {
    min-height: 60vh;
    padding: var(--spacing-xl) var(--spacing-base);
  }
  @media (min-width: 600px) {
    .hero-banner { min-height: 80vh; }
  }
{% endstylesheet %}
```

**Why `{% stylesheet %}`:** Shopify deduplicates when sections repeat on a page and extracts styles for optimization. Section styles handle layout, positioning, grid/flex structure, responsive behavior, and section-specific overrides.

### Base Styles (`base.css`)

Contains: CSS reset, `:root` token definitions, typography defaults, button styles, component styles (nav-link, photograph, grids), and `.visually-hidden`. This is the single global CSS file. Design tokens are defined here — read `base.css` directly for current values.

### Focus States

```css
:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
:focus:not(:focus-visible) {
  outline: none;
}
```

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## JavaScript

### Web Components

All interactive elements are Web Components. Light DOM only — no Shadow DOM.

```js
class ComponentName extends HTMLElement {
  connectedCallback() { /* setup */ }
  disconnectedCallback() { /* cleanup */ }
}
customElements.define('component-name', ComponentName);
```

- One file per component: `assets/cart-drawer.js` = `<cart-drawer>`
- Loaded per-section: `<script type="module" src="{{ 'cart-drawer.js' | asset_url }}"></script>`
- No base class — each component is standalone
- ES modules: automatic defer, module scope, native import/export

### State Management

Use CSS classes for visual state — not data attributes:

```js
this.classList.add('is-open');      // open state
this.classList.remove('is-open');   // closed state
this.classList.toggle('is-loading', loading);  // loading state
document.body.classList.add('drawer-open');     // body-level state
```

Standard state classes: `is-open`, `is-loading`, `is-active`.

### Event Naming

`namespace:action` format with kebab-case:

```js
'cart:updated'           // after any cart change
'cart:item-added'        // after add-to-cart
'cart:item-removed'      // after item removed
'product:variant-changed' // after variant selection
'drawer:opened'          // after drawer opens
'drawer:closed'          // after drawer closes
```

### Communication Patterns

| Situation | Pattern |
|-----------|---------|
| Parent controls child | Direct method call: `drawer.open()` |
| Child notifies parent | Custom event with `bubbles: true` |
| Unrelated components react | Custom event on `document` |
| Component API | Public methods on the element |

### Fetch Pattern

Use async/await with try/catch/finally:

```js
async addToCart(variantId, quantity) {
  this.setLoading(true);
  try {
    const response = await fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: variantId, quantity })
    });
    if (!response.ok) throw new Error('Failed to add to cart');
    const data = await response.json();
    this.dispatchEvent(new CustomEvent('cart:item-added', { bubbles: true, detail: data }));
  } catch (error) {
    this.showError(error.message);
  } finally {
    this.setLoading(false);
  }
}
```

### Section Rendering API

Use Shopify's Section Rendering API to update page regions with server-rendered HTML instead of building markup in JS:

```js
const response = await fetch(`${url}?variant=${variantId}&section_id=${this.sectionId}`);
const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
this.querySelectorAll('[data-variant-render]').forEach((el) => {
  const newEl = doc.querySelector(`[data-variant-render="${el.dataset.variantRender}"]`);
  if (newEl) el.innerHTML = newEl.innerHTML;
});
```

Use when a user action changes which Liquid data should display (variant selection, cart updates) and markup involves translations or money formatting. Use an incrementing counter as a race condition guard.

### Error & Feedback Handling

Two channels, by scope:

- **Field-level / contextual validation → inline.** Errors tied to a specific input (e.g. "Only 3 available" by the quantity selector) display next to that field:

  ```liquid
  <div data-error class="form-error" role="alert" hidden></div>
  ```

  Show/hide by toggling `hidden` and setting `textContent`. Use `role="alert"` for screen reader announcement.

- **Action-level / global feedback → toast.** Success confirmations and action failures with no single field to attach to (add-to-cart success, network failure, checkout error) fire a `toast:show` event handled by the global `<toast-region>` (`assets/toast.js`):

  ```js
  import { showToast } from './toast.js';
  showToast('Added to bag', { variant: 'success' });
  // errors: showToast('Something went wrong. Please try again.', { variant: 'error' });
  ```

  See the `assets/toast.js` header for the full event contract.

### Progressive Enhancement

Components should work without JavaScript where possible. Native `<form>` with `action="/cart/add"` submits normally if JS fails. Native `<details>` for accordions. Native `<input type="number">` for quantity.

---

## Liquid

### Inline Settings

Inline settings directly — don't declare variables at the top of files:

```liquid
{%- comment -%} DO: Inline directly {%- endcomment -%}
<h2>{{ section.settings.heading }}</h2>

{%- comment -%} DON'T: Variable hoisting {%- endcomment -%}
{%- assign heading = section.settings.heading -%}
<h2>{{ heading }}</h2>
```

Variables are OK for: complex filter chains, repeated calculations, multi-use conditionals.

### Whitespace Control

Always use whitespace-stripping tags: `{%-` and `-%}`:

```liquid
{%- if product.available -%}
  <button>{{ 'products.product.add_to_cart' | t }}</button>
{%- endif -%}
```

### Comments

Liquid comments only — never HTML comments:

```liquid
{%- comment -%} This won't render to browser {%- endcomment -%}
```

### Snippets

Always `render`, never `include`:

```liquid
{% render 'product-card', product: product, lazy_load: true %}
```

`render` creates isolated scope (safer). `include` is deprecated.

### Blocks

Always include `shopify_attributes` for theme editor support:

```liquid
{%- for block in section.blocks -%}
  <div {{ block.shopify_attributes }}>
    {{ block.settings.title }}
  </div>
{%- endfor -%}
```

### Section Schema Template

```liquid
{% schema %}
{
  "name": "Section Name",
  "tag": "section",
  "class": "section-name",
  "settings": [],
  "blocks": [],
  "presets": [{ "name": "Section Name" }]
}
{% endschema %}
```

### Translation Strings

All user-facing text via the `t` filter:

```liquid
{{ 'products.product.add_to_cart' | t }}
{{ 'cart.general.item_count' | t: count: cart.item_count }}
```

Never hardcode English text in templates. Keys defined in `locales/en.default.json`.

### Image Handling

Always include dimensions to prevent layout shift:

```liquid
{{ image | image_url: width: 600 | image_tag:
    loading: 'lazy',
    width: image.width,
    height: image.height
}}
```

For responsive images, use `srcset` and `sizes` attributes.

### Metafield Access

```liquid
{{ product.metafields.custom.subtitle.value }}
{{ variant.metafields.custom.images.value }}
{{ product.metafields.custom.subtitle.value | default: '' }}
```

All metafields use the `custom` namespace.

---

## Animation

### Two Layers

| Layer | Technology | Included by Default |
|-------|-----------|-------------------|
| Layer 1 | CSS transitions | Yes |
| Layer 2 | Motion library (`animate`, `scroll`, `inView`) | No — add when needed |

**Start with Layer 1.** Only add Motion (~18kb) if the project requires parallax, scroll-scrubbing, or complex timeline animations.

### CSS Transitions (Layer 1)

- Micro-interactions (hover/active): `0.2s ease` (matches `--transition-fast`)
- Drawers and modals: `0.3s ease`
- Easing: `ease` consistently
- Direction convention: cart drawer from right, mobile menu from left, modals fade

### Motion (Layer 2 — Optional)

When added:
- Load globally in `theme.liquid`: `<script type="module" src="{{ 'motion.min.js' | asset_url }}"></script>`
- Animation code lives **inline in section files** (co-located with markup/styles), not in Web Component files
- Web Components = interactive UI. Section animation scripts = visual polish.
- Always check `prefers-reduced-motion` before running animations
- Motion uses native browser APIs (Intersection Observer, ScrollTimeline) — no manual refresh needed for dynamic content

---

## Layout

### theme.liquid Structure

```
<head>
  meta-tags snippet → json-ld-organization snippet → WebSite JSON-LD →
  favicon → base.css → content_for_header
</head>
<body data-cart-type="{{ settings.cart_type }}">
  skip link → header-group → <main id="main-content"> content_for_layout </main> →
  footer-group → cart-drawer (conditional)
</body>
```

- Font loading: `@font-face` declarations in `theme.liquid` using `asset_url` — not in `base.css`
- Background tint: `.bg-tinted` lives in `base.css` §3 (no `theme.liquid` color generation; the old per-scheme loop was removed)
- Cart drawer: only rendered when `settings.cart_type == 'drawer'`

### password.liquid

Minimal layout: no header, footer, cart drawer, or skip link. Always `noindex`.

### Section Groups

- `header-group.json`: announcement-bar + header
- `footer-group.json`: footer

---

## File Organization

### Naming

- Sections: kebab-case (`hero-banner.liquid`, `featured-collection.liquid`)
- Snippets: prefix-based grouping (`cart-item.liquid`, `product-card.liquid`, `icon-cart.liquid`)
- Assets: flat structure, component name = file name (`cart-drawer.js`, `base.css`)
- Templates: 100% JSON (except `gift_card.liquid`)

### Theme Structure

```
assets/          CSS, JS, fonts (flat)
config/          settings_schema.json, settings_data.json
layout/          theme.liquid, password.liquid
locales/         en.default.json
sections/        Section files + group JSON configs
snippets/        Reusable partials
templates/       JSON templates + gift_card.liquid
```

No customer account templates — uses Shopify's New Customer Accounts (hosted).

---

## Internationalization

- Default locale: English (`en.default.json`)
- Shopify's `| t: count: n` filter selects the correct plural form automatically
- When adding additional locales, follow CLDR plural rules for the target language
- Section schema labels can remain in English (they're for theme editor, not storefront)
