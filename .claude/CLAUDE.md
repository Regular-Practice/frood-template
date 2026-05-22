# Shopify Starter Theme

Shopify Online Store 2.0 theme. Vanilla CSS, Web Components (light DOM), ES modules. No build step — Shopify CLI only.

## Repo Layout

```
assets/          CSS, JS, fonts (flat structure)
config/          settings_schema.json, settings_data.json
layout/          theme.liquid, password.liquid
locales/         en.default.json
sections/        Section files + group JSON configs
snippets/        Reusable partials
templates/       JSON templates + gift_card.liquid
.claude/
  CLAUDE.md                      (this file — always loaded)
  conventions/
    architecture.md              CSS, JS, Liquid, animation, layout, i18n
    commerce.md                  Cart events, flows, error handling
    accessibility.md             WCAG, keyboard, ARIA, focus
    decisions.md                 Rationale for architectural choices
    sections.md                  Per-section detail (homepage + bundle builder)
  scripts/
    dump-metas.sh                Dump live store metafield/metaobject schema (see "Store Schema")
```

## Before Building Anything

1. **Read the actual code** — the implemented section/template/snippet files are the source of truth
2. Read `conventions/architecture.md` for CSS, JS, and Liquid patterns
3. Read `conventions/commerce.md` for cart event protocol and add-to-cart flows
4. Read `conventions/accessibility.md` for WCAG requirements and ARIA patterns
5. Read `conventions/decisions.md` when code seems unusual — it explains the rationale
6. Read `conventions/sections.md` for the full detail on a specific custom section

## Critical Code Patterns

### Liquid

**Always strip whitespace:**

```liquid
{%- if product.available -%}
  <button>{{ 'products.product.add_to_cart' | t }}</button>
{%- endif -%}
```

**Inline settings directly** (don't declare variables at top):

```liquid
<h2>{{ section.settings.heading }}</h2>
```

Variables only for complex filter chains, repeated calculations, or multi-use conditionals.

**Always `render`, never `include`:**

```liquid
{% render 'product-card', product: product, lazy_load: true %}
```

**All user-facing text via translations:**

```liquid
{{ 'products.product.add_to_cart' | t }}
```

Keys defined in `locales/en.default.json`.

**Blocks must include `shopify_attributes`:**

```liquid
{%- for block in section.blocks -%}
  <div {{ block.shopify_attributes }}>
    {{ block.settings.title }}
  </div>
{%- endfor -%}
```

**Use Liquid comments, not HTML:**

```liquid
{%- comment -%} This won't render to browser {%- endcomment -%}
```

### Background Tint

**There is no merchant color-scheme picker.** Frood backgrounds are brand-locked: the default is `--color-bg` (warm off-white). The one alternate tone the design uses — warm beige/stone (`--color-bg-dark`) — is applied by adding the `.bg-tinted` class to a section wrapper. That class (in `base.css` §3) just overrides one variable:

```css
.bg-tinted { --color-bg: var(--color-bg-dark); }
```

```liquid
<section class="section-name bg-tinted">
```

Sections already paint `background-color: var(--color-bg)` / `color: var(--color-text)`, so toggling that one variable is all that's needed; text and every other token stay on their `:root` values. Currently no sections apply `.bg-tinted` by default. **Do not add a `color_scheme` setting, the `color-` prefix, or per-section background controls** — the old 5-scheme `color_scheme_group` system (and its `theme.liquid` generator) was removed. If a new section genuinely needs the beige tone, add `.bg-tinted` to its markup; if it needs to be merchant-toggleable, raise it for a design decision rather than reintroducing the picker.

### Section Styles

Co-located in section files using `{% stylesheet %}` (not `<style>`):

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

### CSS

- Vanilla CSS with custom properties, mobile-first
- Simple semantic class names — no BEM, no utility classes
- Modifier classes: `.product-card.sold-out` (not `product-card--sold-out`)
- Breakpoints: 600px (tablet), 900px (desktop), 1500px (large)
- Z-index: header `9`, footer `10`, mobile menu `99`, lightbox `999`

### Web Components (JavaScript)

Light DOM only, ES modules, one file per component:

```js
class CartDrawer extends HTMLElement {
  connectedCallback() {
    this.setupEventListeners();
  }
  disconnectedCallback() {
    this.cleanup();
  }

  open() {
    this.classList.add("is-open");
    this.setAttribute("aria-hidden", "false");
    this.dispatchEvent(new CustomEvent("drawer:opened", { bubbles: true }));
  }
}
customElements.define("cart-drawer", CartDrawer);
```

Loaded per-section:

```liquid
<script type="module" src="{{ 'cart-drawer.js' | asset_url }}"></script>
```

**State:** CSS classes (`is-open`, `is-loading`) — not data attributes.
**Events:** `namespace:action` format (`cart:updated`, `drawer:opened`).
**Feedback:** Field-level validation inline (`role="alert"`); action-level success/failure via toast (`toast:show` → `<toast-region>`, assets/toast.js).

### Cart Event Flow

```
product-form → dispatches cart:item-added + success toast (drawer mode)
  → cart-drawer listens → refresh() (no auto-open; opens on cart-icon click)
  → cart-icon listens → updateCount()

cart-items → quantity change or remove → POST /cart/change.js
  → dispatches cart:updated
    → cart-drawer listens → refresh()
    → cart-icon listens → updateCount()
```

### Images

Always include dimensions to prevent layout shift:

```liquid
{{ image | image_url: width: 600 | image_tag:
    loading: 'lazy',
    width: image.width,
    height: image.height
}}
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

## Snippet Ownership

Each snippet is owned by ONE section/area. When modifying a snippet, read its owning code:

| Snippet                                                                                         | Owner                                                  | Used By                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product-card`                                                                                  | `sections/main-collection.liquid`                      | featured-collection, collection, search                                                                                                                                                                                                                                                                                                                                             |
| `product-price`                                                                                 | `sections/main-product.liquid`                         | product-card, main-product                                                                                                                                                                                                                                                                                                                                                          |
| `product-variant-selector`                                                                      | `sections/main-product.liquid`                         | main-product                                                                                                                                                                                                                                                                                                                                                                        |
| `product-buy-buttons`                                                                           | `sections/main-product.liquid`                         | main-product                                                                                                                                                                                                                                                                                                                                                                        |
| `product-gallery`                                                                               | `sections/main-product.liquid`                         | main-product                                                                                                                                                                                                                                                                                                                                                                        |
| `product-upsells`                                                                               | `sections/main-product.liquid`                         | main-product, cart-drawer                                                                                                                                                                                                                                                                                                                                                           |
| `product-card-quick-add` (markup in `product-card.liquid` + `assets/product-card-quick-add.js`) | `sections/main-collection.liquid` (via `product-card`) | product-card                                                                                                                                                                                                                                                                                                                                                                        | Quick-add button on product cards. `<product-card-quick-add>` intercepts the wrapped `<form>` and POSTs the first available variant to the **native** `/cart/add.js`, then dispatches `cart:item-added` so the cart drawer opens + cart icon updates — the same native-cart path as the PDP. No-JS fallback: `<form action="/cart/add">` posts normally. |
| `quantity-selector`                                                                             | `assets/quantity-selector.js`                          | main-product, cart-item                                                                                                                                                                                                                                                                                                                                                             |
| `cart-items`                                                                                    | `sections/main-cart.liquid`                            | main-cart, cart-drawer                                                                                                                                                                                                                                                                                                                                                              |
| `cart-item`                                                                                     | `sections/main-cart.liquid`                            | cart-items                                                                                                                                                                                                                                                                                                                                                                          |
| `cart-totals`                                                                                   | `sections/main-cart.liquid`                            | main-cart, cart-drawer                                                                                                                                                                                                                                                                                                                                                              |
| `cart-empty`                                                                                    | `sections/main-cart.liquid`                            | main-cart, cart-drawer                                                                                                                                                                                                                                                                                                                                                              |
| `bundle-line-contents` | `sections/bundle-builder.liquid` | cart-item, cart-drawer-item. Renders a bundle ("Build Your Box") line's contents as one row per flavour — a `dark_colour` chip + name + qty. Resolves flavours from the box product's `custom.included_flavours` metaobjects and quantities from the visible line-item properties (`item.properties[flavour.name.value]`); no JSON parsing. A bundle line is detected via its hidden `_bundle` property, which also drops the box thumbnail (`.is-bundle`). Co-located `{% stylesheet %}` so styles travel to the global cart drawer. |
| `collection-filters`                                                                            | `sections/main-collection.liquid`                      | main-collection                                                                                                                                                                                                                                                                                                                                                                     |
| `pagination`                                                                                    | `sections/main-collection.liquid`                      | collection, blog, search                                                                                                                                                                                                                                                                                                                                                            |
| `article-card`                                                                                  | `sections/main-blog.liquid`                            | main-blog, search                                                                                                                                                                                                                                                                                                                                                                   |
| `share-buttons`                                                                                 | `sections/main-article.liquid`                         | main-article                                                                                                                                                                                                                                                                                                                                                                        |
| `newsletter-form`                                                                               | `sections/footer.liquid`                               | footer, main-password                                                                                                                                                                                                                                                                                                                                                               |
| `meta-tags`                                                                                     | `layout/theme.liquid`                                  | theme.liquid                                                                                                                                                                                                                                                                                                                                                                        |
| `json-ld-organization`                                                                          | `layout/theme.liquid`                                  | theme.liquid                                                                                                                                                                                                                                                                                                                                                                        |
| `json-ld-product`                                                                               | `sections/main-product.liquid`                         | main-product                                                                                                                                                                                                                                                                                                                                                                        |
| `icon-*`                                                                                        | `sections/header.liquid`                               | header, cart-drawer, mobile-menu. `icon-arrow` (→) is the shared right-arrow, recolours via `currentColor` and takes an optional `class` param for consumer sizing/animation — used by `bundle-builder` (add-to-cart CTA) + `recipe-card` ("Watch" trigger). Source export kept (unreferenced) at `assets/right-medium.svg`.                                                          |
| `logo-frood`                                                                                    | `sections/hero.liquid`                                 | Frood wordmark — inline SVG using `fill="currentColor"`; set `color` on the parent to recolor. Source SVG kept at `assets/icon.svg` for reference                                                                                                                                                                                                                                   |
| `recipe-card`                                                                                   | `sections/main-recipes.liquid`                         | Recipe index grid. **Placeholder treatment** — image + name + duration only. Full card design (typography, hover, badges) lands later. Reads from `recipes` metaobject.                                                                                                                                                                                                             |
| `news-card`                                                                                     | `sections/main-news.liquid`                            | News index grid. Three-column on tablet+ (image 4:3 \| `.section-lockup` of date/location → title → "Link" button \| rich-text description capped at a readable width); stacks in the same order on mobile. Hairlines between entries handled by `main-news.liquid`. Reads `news` metaobject (handles: `title`, `date`, `location`, `news_image`, `news_description`, `news_link`). |

## Design Tokens (Quick Reference)

**Frood palette:**

- `--color-text` `#36262B` (warm dark burgundy)
- `--color-text-accent` `#979193` (muted warm grey)
- `--color-bg` `#FFFEF9` (warm off-white)
- `--color-bg-dark` `#DFDCD4` (warm beige/stone)
- `--color-accent` `#FFE74B` (bright yellow)
- `--color-accent-light` `#F7F0C1` (pale yellow)

**Semantic alias:** `--color-text-light` → `--color-text-accent` (kept so existing references keep working).

**Form input backgrounds** (brand-locked):

- `--color-input-bg` → `--color-bg-dark` (warm beige) — default state
- `--color-input-bg-hover` → `--color-accent-light` (pale yellow) — hover/focus state

These were once derived per color scheme (text color @ 10% / 15% alpha) but are now brand-locked. Used by `.input`, `.checkbox`, `.textarea`, `.select`.

**Translucent overlays** (derived from `--color-text` via `color-mix`):

- `--color-border` text @ 10% — borders, hairlines
- `--color-shadow-soft` text @ 5% — pressed-state shadows
- `--color-nav` `--color-bg-dark` @ 80% — nav backdrops
- `--color-overlay` text @ 10% — image scrims, modal backgrounds

**Spacing:** xxxs `4px`, xxs `8px`, xs `12px`, s `16px`, m `24px`, l `64px`, xl `128px`, xxl `192px`
(`--spacing-base` is an alias of `--spacing-s` — kept for ~99 legacy references.)

**Responsive section padding rule:** Sections that use `padding: var(--spacing-m)` for their outer container must drop down to `var(--spacing-xs)` on mobile + tablet (<900px) and use `m` only on desktop (≥900px). The breakpoint is `@media (min-width: 900px)`. For sections with multi-value padding (e.g. `xl m m` for top/horizontal/bottom), only the `m` components step down to `xs` on mobile — bespoke vertical values (`l`, `xl`) are preserved. Currently applied: `featured-collection`, `text-image-split`, `feature-card-section`, `feature-card` (inner card), `bundle-builder`, `footer`, `media-tabs-overlay`, `product-recommendations`, `recipe-recommendations`, `quote`, `intro`, `event-slider`. Exempt by design: `hero` (full-bleed brand moment), `fullbleed` (edge-to-edge media). When adding new sections, follow this pattern.

**Border radius:** `--rad-s: 2px`, `--rad-m: 4px`. Circles use `border-radius: 50%`, hard corners use `0` — don't tokenize those.

**Blur:** `--blur: 7px` — for `backdrop-filter: blur(var(--blur))` (frosted-glass effects).

**Transitions:** `--transition-fast: 0.2s ease`, `--transition-slow: 0.5s ease`

**Font:** **HW Left** (Trial license — must be replaced before launch). Weights: Regular 400, Medium 500. Single family for body and headings. `@font-face` lives in `layout/theme.liquid` and `layout/password.liquid`.

**Functional UI (not brand):** `--color-success` (= `--color-accent-light`), `--color-error-bg` (`#f8d7da`). Hardcoded `#dc2626` (error red) / `#16a34a` (success green) still appear in form-error/success inline styles — intentionally generic so users recognize them.

Authoritative values live in `assets/base.css` `:root` block.

## Frood Typography

Each style has both a **token group** (in `:root`) and a **utility class** (in `base.css` section 5). Apply the utility class directly in markup — the existing reset strips default `h1`/`h2` browser styles, so semantic tags don't auto-receive these. Line-height/letter-spacing are stored as `em` (1.1em = 110%; 0.01em = 1%).

| Class        | Font    | Weight | Size | Line height | Letter spacing | When to use                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ------- | ------ | ---- | ----------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.text-h1`   | HW Left | 400    | 12px | 1.1em       | 0.01em         | H1 — top-level page heading. **Always uppercase** AND **always rendered in `--color-text-accent` (warm muted grey)** — both baked into `.text-h1`. Intentionally small: a tiny eyebrow/label, not a visual page title. `.button` inherits the typography props but overrides `color` (button labels are dark on yellow, not grey). **Never override the h1 color unless the user explicitly asks — it's a brand rule.** |
| `.text-h2`   | HW Left | 500    | 36px | 1.1em       | 0em            | H2 — primary visible page heading (often the largest visible text on a section)                                                                                                                                                                                                                                                                                                                                         |
| `.text-h3`   | HW Left | 500    | 24px | 1.1em       | 0em            | H3 — sub-section headings within an H2                                                                                                                                                                                                                                                                                                                                                                                  |
| `.text-body` | HW Left | 400    | 14px | 1.1em       | 0em            | Paragraph copy, product descriptions, article text — anywhere prose lives                                                                                                                                                                                                                                                                                                                                               |
| `.text-ui`   | HW Left | 500    | 14px | 1.2em       | 0em            | Interactive UI text — buttons, nav links, form labels, input placeholders, badges. Same size as body but medium weight + slightly more line-height for legibility in small interactive targets                                                                                                                                                                                                                          |

**Rules:**

- Always apply the utility class explicitly — e.g. `<h1 class="text-h1">…</h1>`. Never assume native `h1` inherits these styles.
- The semantic tag (`h1`, `h2`, etc.) is for _meaning and accessibility_; the class is for _visual style_. They're decoupled — a `<div class="text-h1">` is wrong (use the semantic tag); a `<h2 class="text-h1">` is fine if a visual H1 is needed inside an H2 page-section.
- Sizes, line-heights, and letter-spacings come from Figma.
- **Spacing between an h1 eyebrow and the heading directly below it (h2 or h3) is always `--spacing-xxs` (8px).** This is the canonical pairing — applies anywhere an h1 eyebrow sits above an h2 or h3, whether inside `.section-lockup` (which already defaults to this) or in bespoke compositions like the quote section. Don't use `xs`/`s`/`m` for this gap.

The older abstract scale (`.text-mini`, `.text-base`, `.text-medium`, `.text-large`, `.text-xl`) is still defined in `base.css` for backward compatibility with existing snippets/sections. Prefer Frood semantic classes (`.text-h1`, etc.) for new code.

## Rich Text Fields

**Rule: every wrapper that renders a `richtext` schema setting must auto-underline its inner `<a>` tags so merchant-entered links always read as links.**

This is handled by two container classes in `base.css` — pick whichever fits the context:

| Wrapper class | When to use                                                                               | Side-effects                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `.typeset`    | Long-form merchant prose (article bodies, page content, product description, FAQ answers) | Adds top margin between paragraphs and large top margin (2em) before headings — designed for flowing prose |
| `.text-body`  | Short richtext fields (captions, small editable blurbs)                                   | None beyond Frood body typography. No prose margin rules — control paragraph spacing locally if needed     |

Both classes already include this rule in `base.css` (§6):

```css
.typeset a,
.text-body a,
.inline-link {
  text-decoration: underline;
  text-decoration-color: var(--color-text-light);
}
/* hover lifts the underline to --color-text */
```

**When you add a new `richtext` schema setting:**

1. Wrap the output in one of those two classes — never render raw richtext into an unclassed `<div>`.
2. Use `<div>` (or `<figcaption>`, etc.) — never `<p>` — since Shopify's richtext output is itself wrapped in `<p>` and `<p>` can't contain `<p>`.
3. If multi-paragraph spacing is needed inside `.text-body`, add a local `[class] p + p { margin-top: var(--spacing-xxs) }` rule in the section stylesheet.

**Don't** add link-underline styling per-section — the rule lives once in `base.css` and applies via the wrapper class. If a richtext field's links aren't underlined, the wrapper is missing the right class.

## Buttons

**Frood has exactly one button: `.button`.** There is no `.button.secondary`, no ghost button, no tertiary. Low-emphasis actions become **underlined inline links** (`.inline-link`) instead — visually quiet, semantically still clickable.

**`.button` (primary):**

- Background: `--color-accent` (yellow)
- Text: `--color-text` (dark burgundy)
- Typography: based on `.text-h1` (HW Left, 12px / 1.1em / 0.01em / uppercase) — but **font-weight is overridden to 500 (Medium)**. So button labels are heavier than a plain h1 in body copy.
- Display: `inline-block` (NOT `inline-flex`). Load-bearing: the text-box trim (`base.css §1`, scoped to `.text-h1, .text-h2, .text-h3, .button, .nav-link` — **not** a global `*` rule, which used to sweep it into form controls and collapse their box model) only takes effect on block-level boxes. As `inline-flex` the trim silently no-ops because the label becomes an anonymous flex item the rule can't reach. Don't switch `.button` back to flex — if a button ever needs an icon + text laid out, give that an inner flex wrapper rather than flexing `.button` itself.
- Padding: `var(--spacing-xxs) var(--spacing-xs)` — **symmetric vertically** (8px top/bottom, 12px sides). The text-box trim strips the cap/baseline half-leading, so the all-caps label is optically centred with symmetric padding (same treatment as `.nav-link`). (Previously an 8px/7px asymmetric fudge compensated for leading the trim should have removed — that hack is gone now the trim actually applies.)
- Border radius: `--rad-s` (2px)
- Hover: colors invert (`bg → --color-text`, `text → --color-accent`)
- States: `:disabled` and `.is-loading` (with rotating spinner) are preserved
- No box-shadow, no transform-bounce, no active state — clean color-invert is the only interaction

**Usage:**

```html
<button class="button">Add to cart</button>
<a href="/checkout" class="button">Checkout</a>
```

**For low-emphasis actions, use `.inline-link` instead:**

```html
<a href="/cart" class="inline-link">View cart</a>
<button class="inline-link">Update</button>
```

`.inline-link` is just underlined text — the underline color animates from `--color-text-light` to `--color-text` on hover. Works on both `<a>` and `<button>` (the base CSS reset strips default button styles).

**What NOT to do:**

- Don't add a "secondary button" variant — if a designer asks for one, push back or use `.inline-link`.
- Don't override `.button` colors per-section — the brand button is locked to yellow/dark to keep the system tight.
- Don't add new sizes (`.button-large`, `.button-small`) without explicit design direction. One size only.
- Don't use `--color-button-*` tokens in CSS — they're remnants of the Shopify scheme system kept only for checkout role mapping (defined in `theme.liquid`, not `:root`).

## Section Lockup

**Reusable text composition for section headers.** Used heavily across Frood — when a section has an eyebrow + heading + (optional CTA), wrap them in `<div class="section-lockup">` and the gaps + alignment come for free.

```html
<div class="section-lockup">
  <h1 class="text-h1">Our collection</h1>
  <h3 class="text-h3">Real food, made simple.</h3>
  <a class="button" href="/collections/all">Our range</a>
</div>
```

**Defined in:** `assets/base.css` §22.

**Rules baked in:**

- `flex-direction: column`, `align-items: flex-start`, `text-align: left` — text always sits on the left
- Default vertical gap between children: `--spacing-xxs` (8px) — applies between heading elements
- Gap before a `.button` child: `--spacing-s` (16px) — buttons get more breathing room
- All children have `margin: 0` reset, so default heading/paragraph margins don't fight the lockup

**When NOT to use:**

- If a section needs centered text → don't use lockup (or override `align-items: center; text-align: center;` in the section's local CSS, but this defeats the lockup's purpose)
- If a section's heading composition is one-off (e.g. heading + price + button + image) → write a bespoke layout

**Where it's used:**

- `sections/featured-collection.liquid` — section header

(Add new locations here as more sections adopt it.)

## Frood Custom Sections

Custom sections built for Frood. **Full per-section detail — layout, breakpoints, schema, gotchas — lives in `conventions/sections.md`; read it before editing any of these.** The implemented `.liquid` files are the source of truth. The starter's `hero-banner`, `hero-slideshow`, `text-section`, `rich-text`, and `image-text` sections were deleted — don't try to use them.

- **`hero.liquid`** — full-bleed image + centered Frood wordmark (yellow). Brand-locked, no merchant content yet (hero image hardcoded to `dummy.jpg`).
- **`featured-collection.liquid`** — editorial product grid; section-lockup header + CTA; mobile `carousel`/`grid` toggle (native CSS scroll-snap, no JS). Renders `product-card`.
- **`product-card` 3D renders** — uses Shopify `model_viewer_tag` when a product has a `model` media item, else `featured_image`. No hover effects on cards.
- **`text-image-split.liquid`** — section-lockup left, 1–2 image/video media right; stacks <900px.
- **`feature-card.liquid`** — centered card (max 1134px) promoting a `news` metaobject entry + richtext heading. Metaobject type is locked at the schema level.
- **`bundle-builder.liquid`** — interactive "build your box" (v3, box-first). The shopper fills ONE fixed box of 4 packs by mixing flavours, then adds the whole box to the native cart as a SINGLE line item at a flat price. No discount tiers, no multi-box draft (that was the old pouch-first v2). `<bundle-builder>` (ordered pack-list state + localStorage, steppers, add-to-cart) and `<bundle-stage>` (pure 2D PNG-compositing depth-stack visualiser — **no three.js**) are standalone, communicating only via `bundle:updated` on `document`. Flavours are curated per box product via its `custom.included_flavours` metafield (a list of `flavour` metaobjects, each with `name`/`notes`/`image`) — reordering the list reorders the cards; the box is a single product chosen in section settings, added with the chosen flavours as a line-item property. On "Add to cart" the draft POSTs to `/cart/add.js` (`sections: ['cart-drawer']`), clears, and fires `cart:item-added` + a success toast — same contract as `product-form.js` (drawer does **not** auto-open). Box-layer renders (`box-back`/`box-front`) are image-picker settings falling back to committed placeholder assets; box capacity is locked at 4. Dev calibration overlay via `?bundle-calibrate`.

## Store Schema

The live store's metafield + metaobject **definitions** (the shape of its custom data, not theme code) can be dumped to JSON with `.claude/scripts/dump-metas.sh`. Read a dumped file to learn the exact namespace/key/type before wiring a section to a metafield or metaobject — don't guess.

**Setup is already done in this checkout:** `.env.local` at the repo root holds `SHOPIFY_STORE` + `SHOPIFY_ADMIN_TOKEN` (gitignored). Just run it:

```
.claude/scripts/dump-metas.sh
```

Output lands in `.claude/meta-dump/` (gitignored) — one `metafields-<OWNER>.json` per owner type plus `metaobject-definitions.json`. Re-run any time the store schema changes. The script's header comment documents flags, credential resolution order, and the per-store app/scope setup if `.env.local` ever needs recreating. A missing API scope warns for that one owner type and keeps going.

> **Note:** the live store currently defines only the `custom.pouch_texture` product metafield and the `news` / `recipes` / `instruction_tab` / `category` metaobjects. The `custom.included_flavours` metafield and `flavour` metaobject referenced by the bundle-builder above do **not** exist in the store yet — create them before that section can read real data.

## What NOT to Do

- No Shadow DOM — light DOM only
- No BEM notation — use `.product-card-title` not `.product-card__title`
- No utility classes — no `.mt-4`, `.flex`, `.text-center`
- No `include` tag — always `render`
- No HTML comments — use `{%- comment -%}`
- No toasts for field-level validation — those stay inline near the field (action-level feedback uses the toast system)- No build tools — Shopify CLI only
- No per-section padding/margin merchant controls
- No `@font-face` in base.css — font faces go in theme.liquid via Liquid `asset_url`
- No hardcoded user-facing strings — always `{{ 'key' | t }}`
- No `color_scheme` settings or `color-`/`color-scheme-N` classes — backgrounds are the default `--color-bg` or `.bg-tinted`, nothing else
- No second JS import map — `theme.liquid` has the only one (vendored three.js); a document can have just one

## Accessibility Checklist

- Skip link in theme.liquid targeting `#main-content`
- All `<nav>` elements have `aria-label`
- Cart drawer: `role="dialog"`, `aria-modal="true"`, focus trap
- Mobile menu: native `<details>`/`<summary>` disclosure (CSS-only) — keyboard-operable via the summary; no JS focus trap
- Icon-only buttons: `aria-label` on button, `aria-hidden="true" focusable="false"` on SVG
- Form inputs: associated `<label>` elements
- Error messages: `role="alert"`
- `prefers-reduced-motion`: all animations/transitions disabled
- Custom `:focus-visible` outline with `2px solid currentColor`

## For Deeper Context

| Topic                                                                    | Read                           | Contains                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom Frood section details (layout, breakpoints, schema, gotchas)      | `conventions/sections.md`      | hero, featured-collection, product-card 3D, text-image-split, feature-card, bundle-builder                                                                                                        |
| CSS patterns, JS components, Liquid conventions, animation, layout, i18n | `conventions/architecture.md`  | Class naming, breakpoints, background tint, Web Component pattern, event naming, fetch patterns, Section Rendering API, inline settings, whitespace control, Motion library, theme.liquid structure |
| Cart behavior, add-to-cart, event protocol                               | `conventions/commerce.md`      | Cart event flow, bundled section rendering, quantity selector, error handling, loading states, no-JS fallback                                                                                     |
| WCAG, keyboard, ARIA, focus management                                   | `conventions/accessibility.md` | Focus trapping pattern, ARIA attributes, heading hierarchy, form accessibility, color contrast, reduced motion, testing checklist                                                                 |
| Why we chose X over Y                                                    | `conventions/decisions.md`     | Rationale for light DOM, no BEM, vanilla CSS, Embla, no Shadow DOM, no build tools, etc.                                                                                                          |
