# Architectural Decisions

> Rationale for key technical choices. Reference this when code seems unusual or when reconsidering approaches.

---

## JavaScript

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Component pattern** | Web Components | Native browser API, no framework dependency, works with any templating |
| **DOM approach** | Light DOM only | Easier to style with global CSS, better accessibility defaults |
| **Module strategy** | ES modules | Modern browser support sufficient, native import/export, automatic defer |
| **Base class** | None (standalone) | Simpler mental model, no inheritance complexity |

---

## CSS

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Preprocessor** | None (vanilla CSS) | No build step required, custom properties handle most needs |
| **Naming convention** | Simple semantic names | Readable, no BEM complexity, easy to understand |
| **Utility classes** | Minimal | Avoid Tailwind-style utilities; keep CSS in context |
| **Section styles** | Co-located in section files | Styles live with their markup, easy to find |
| **Color management** | Brand-locked tokens + a single `.bg-tinted` class | The 5-scheme `color_scheme_group` was removed (only one section ever used a non-default scheme, and buttons/accents/inputs are brand-locked anyway). Backgrounds are `--color-bg` or `.bg-tinted` beige, hardcoded in markup |
| **Merchant controls** | Minimal (no color/type/spacing) | Consistency across projects; devs control the design system |

---

## Animation

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Default approach** | CSS transitions only | No dependencies, no JS needed for standard animations |
| **Micro-interactions** | CSS transitions | Simpler, immediate feedback on hover/active states |
| **Drawer/modal transitions** | CSS only | CSS sufficient for show/hide |
| **Scroll animations** | Motion (optional, add when needed) | Only if parallax/scrubbing/timelines required; ~18kb vs ~60kb for GSAP |
| **Motion loading** | ES module in theme.liquid | One load, available to all sections; ESM-native |
| **Motion code location** | Inline in section files | Co-located with markup/styles; see full section behavior in one place |
| **Motion vs Web Components** | Separate concerns | Web Components = interactive UI; section scripts = visual polish |
| **Timing** | 0.2s micro, 0.3s drawers | Fast, snappy feel without being jarring |

---

## Commerce

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Cart UI** | Drawer + Page | Quick access via drawer; page as fallback and for accessibility |
| **Add to cart** | Success toast confirms; drawer opens on cart-icon click | Immediate feedback without yanking the drawer open on every add; page mode redirects to /cart |
| **Feedback display** | Inline (field-level) + toast (action-level) | Field validation stays contextual near the field; action-level success/failure with no single field to attach to uses the global `<toast-region>` (`toast:show`). Superseded the original "inline only, no toasts" rule. |
| **Variant strategy** | Native Shopify variants | Size + Color as variant options; well within 100-variant limit |
| **Sold out variants** | Dimmed but selectable | Users can still view details, sign up for notifications |
| **Quick view** | Not included | Keep simple; direct to PDP provides better experience |
| **Card content** | Minimal (image, title, price) | Clean look; projects add vendor/swatches as needed |

---

## Product Page

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Gallery (mobile)** | Horizontal carousel | Standard mobile pattern, thumb-friendly |
| **Gallery (desktop)** | Thumbnail navigation | Easy to browse multiple images |
| **Video support** | Shopify-hosted only | Simpler implementation; no YouTube/Vimeo complexity |
| **Variant images** | Metafield-based | Dev-managed, clean data model, per-variant galleries |
| **Gallery on variant change** | Filter to variant images | Show only relevant images, less clutter |

---

## Collection Page

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Filtering** | Native Shopify + basic UI | Structure ready; projects enhance UI as needed |
| **Pagination** | Traditional (numbered) | SEO-friendly, simple, accessible |
| **Infinite scroll** | Not included | Accessibility concerns, harder to bookmark |

---

## Header & Navigation

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Header position** | Sticky (always visible) | Easy cart/nav access; scroll behavior per project |
| **Mobile menu** | Slides from left | Standard pattern; right is reserved for cart |
| **Cart drawer** | Slides from right | Convention; keeps cart feeling separate from nav |
| **Search** | Link to search page | No predictive search in base; projects add as needed |
| **Social icons** | Not included | Projects add as needed; keeps base minimal |

---

## Platform & Tooling

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Platform** | Online Store 2.0 | JSON templates, sections everywhere, modern standard |
| **Customer accounts** | New Customer Accounts | Shopify-hosted, minimal theme code needed |
| **Build tools** | Shopify CLI only | No webpack/vite complexity; simpler onboarding |
| **Carousel library** | Embla Carousel | Lightweight, accessible, touch-friendly |
| **Video player UI** | media-chrome (vendored) | Branded, accessible control bar for *player* videos; standard custom-element API |

### Video: media-chrome for player UIs

- **What:** Videos that need a player UI (currently the recipe modal video; also the orphaned `product-gallery` snippet) render through `snippets/video.liquid` with `controls: true`, which wraps a `<video slot="media">` in a `<media-controller>` + Frood-themed `<media-control-bar>`. Decorative autoplay/loop videos (fullbleed, text-image-split, media-tabs, product-card hover, PDP background slider + render video) are **untouched** — they have no chrome and don't go through this snippet. `controls: false` on `video.liquid` renders a bare `<video>` with no chrome, so the snippet can absorb decorative videos later without ever showing controls on them.
- **Version:** pinned at `media-chrome@4.19.0`, vendored as `assets/media-chrome.js` (jsDelivr-bundled ESM, ~178 KB). Re-vendor from `https://cdn.jsdelivr.net/npm/media-chrome@<version>/+esm` to bump.
- **Loading:** plain `<script type="module" src>` per section that uses a player (currently `main-recipes.liquid`). The bundle is self-contained — **no import map needed**, so the one-import-map rule (three.js) is unaffected. Unlike three.js, media-chrome registers its custom elements as side effects rather than being imported as a bare specifier.
- **Gotcha — sizing / letterbox (this bit us):** media-chrome defaults the slotted `<video>` to `object-fit: contain`, and the controller's own box does **not** adopt the video's intrinsic ratio. So if you size the controller with a fixed `aspect-ratio` that doesn't exactly match the real video (e.g. derived from a `recipe_video.aspect_ratio` metafield that's missing/wrong), the video letterboxes into a thin strip and the controller background fills the rest — which reads as a "black box" by default. **Fix pattern:** size the *video itself* (`video[slot="media"] { height: 85vh; width: auto; max-width: 100% }`) and let an `inline-block` controller shrink-wrap it (`max-height: 85vh; line-height: 0`). The frame then always matches the video's true ratio, no metafield aspect needed — mirrors the original native-video sizing.
- **Defensive — `backdrop-filter` near `<video>`:** avoid `backdrop-filter` on the player's control bar or on any *ancestor* of a media-chrome `<video>`. On some GPUs an ancestor backdrop-filter forces the video onto a compositing path that paints solid black (software/headless rendering hides it, so local Playwright tests won't catch it). The recipe modal's frosted backdrop therefore lives on a separate `.recipe-modal::before` scrim layer *behind* the video, not on `.recipe-modal` itself; the control bar uses a translucent beige fill (`--color-nav`) instead of a blur. The player also sets `--media-background-color: var(--color-bg-dark)` so loading/letterbox areas match the frame instead of flashing black.
- **Deviation — Shadow DOM:** media-chrome components use Shadow DOM internally. This does *not* violate the theme's "light DOM only" rule, which governs **our** components; it's a vendored library. Consequence: the player is styled only via media-chrome's documented CSS custom properties (`--media-primary-color`, `--media-control-hover-background`, `--media-range-*`, `--media-object-fit`, `--media-focus-box-shadow`, …) mapped onto Frood tokens in `video.liquid`, not the theme's usual descendant selectors. The slotted `<video>` stays in light DOM, so `querySelector('video')` still resolves it (relied on by `product-gallery.js` / `recipe-modal.js`).

---

## Accessibility

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Standard** | WCAG 2.1 AA | Legal baseline + good practice |
| **Focus outlines** | Custom styled | Better visual design than browser defaults |
| **Reduced motion** | Full support | Respect user preferences; CSS + JS checks |
| **Skip link** | Included | Essential for keyboard users |
| **Focus trapping** | In all modals/drawers | Required for accessible overlay patterns |

---

## Data Model

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Metafield namespace** | `custom` | Consistent, distinguishes from app metafields |
| **Product images** | Shopify product media | Standard media per product |

---

## Blog & Content

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Blog comments** | Skip for base theme | Low usage on most stores; add via app if needed |
| **Share mechanism** | Web Share API + clipboard fallback | Native mobile share sheet; clean desktop fallback with no third-party scripts |
| **Breadcrumbs** | Skip for now | Future enhancement; not essential for base theme navigation |

---

## Templates

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Gift card layout** | `layout/theme.liquid` | Gift cards are a storefront page; header/footer provide navigation context |
| **Password layout** | Separate `layout/password.liquid` | Pre-launch page shouldn't show store navigation or cart |

---

## Internationalization

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Default language** | English (`en.default.json`) | Shopify convention; English as fallback. Add secondary locales as needed |
| **Predictive search** | Not in base | Future extension point; link to /search page sufficient for launch |

---

## Revisiting Decisions

When reconsidering a decision:

1. **Check this document** for original rationale
2. **Consider the trade-offs** — what problem did the original choice solve?
3. **Document the new decision** if you change it, including why

Decisions aren't permanent, but changes should be deliberate.
