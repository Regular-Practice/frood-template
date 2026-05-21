# Section Reference

Detailed descriptions of the custom Frood sections. **The implemented `.liquid` files are
the source of truth** — read them before changing anything here. This file exists so
`CLAUDE.md` can stay lean; load it when working on a specific section.

## Frood Homepage Sections

The homepage (`templates/index.json`) uses a small set of custom Frood sections. The starter's `hero-banner`, `hero-slideshow`, `text-section`, and `rich-text` sections were deleted — don't try to use them. The featured-collection starter section IS kept and themed via tokens.

### `hero.liquid` (Frood Hero)

Full-bleed image background with the Frood wordmark centered in `--color-accent` (yellow).

- **Dimensions:** width 100% (effectively full viewport), height 100vh
- **Background image:** currently hardcoded to `assets/dummy.jpg` via `asset_url`. Swap for a merchant-editable `image_picker` setting once the real hero image is finalized.
- **Logo:** rendered via `{% render 'logo-frood' %}` — inline SVG with `fill="currentColor"`. Sized to **45vw width**. Color is set via the `--color-accent` token on the parent `.hero-frood-logo` div.
- **No content other than the image + logo.** No heading, no button, no scroll cue. Brand-locked layout.

When the hero image needs to be merchant-editable, add an `image_picker` setting to the schema and replace the hardcoded `<img>` src.

### `featured-collection.liquid` (rebuilt)

Editorial product grid with stacked heading + CTA.

- **Padding:** `--spacing-m` (24px all sides)
- **Header** (centered, vertical stack): h1 eyebrow ("Our collection") → h3 heading ("Real food, made simple. Made for modern home cooks.") → primary `.button` ("Our range"). All three are schema-editable.
- **Product grid breakpoints:**
  - **Mobile (<600px):** merchant-selectable via schema `mobile_layout` — either `carousel` (horizontal scroll-snap, native CSS, each card 75% width so the next one peeks) or `grid` (single column stacked)
  - **Tablet (≥600px):** 2 columns
  - **Desktop (≥900px):** 4 columns
- **Carousel implementation:** native CSS `scroll-snap-type: x mandatory` + hidden scrollbars. No JS, no embla dependency. The previous `assets/featured-collection-carousel.js` and embla wiring were removed.
- **Product cards** still rendered via `{% render 'product-card' %}` — the snippet owner is unchanged.
- **Grid gap:** `--spacing-xs` (12px) — tighter than `--spacing-s` to let pack visuals breathe without dead space.

### Product card thumbnail media

`snippets/product-card.liquid` drives the card thumbnail entirely off the **first media item** (`product.media.first`), honouring the merchant's media order:

- **First is an image** → that image is the still. If the **second** media is also an image, it cross-fades in on hover (`.product-card-image-hover`, base.css §13). A non-image second item gets no hover.
- **First is a video** → the video's `preview_image` is the still; a `<product-card-hover-video>` overlay plays the mp4 on hover (intent-debounced, `preload="none"` so zero MP4 bytes until the user settles on a card — see `assets/product-card-hover-video.js`).
- **Anything else** (model, external video, …) → falls back to `product.featured_image`, else a grey placeholder.

Only cards whose first media is a playable video load `product-card-hover-video.js`; all other cards skip it.

**3D / GLB model support is removed for now.** `assets/product-card-stage.js` (the custom shared-renderer three.js) and the three.js import map in `layout/theme.liquid` are left in place so it can be re-wired later — to bring it back, restore the model branch + its `.product-card-model*` CSS in `product-card.liquid` and load the stage script for model-first cards.

### `text-image-split.liquid` (Text + image split)

Two-column section: section-lockup on the left, 50/50 media column on the right with up to 2 media items (image or video each), each with optional captions.

- **Layout:** mobile + tablet (<900px) stack vertically — media under text, both full width, gap `--spacing-m`. Desktop (≥900px) becomes a 2-column grid (`1fr 1fr`).
- **Text column:** Uses the `.section-lockup` pattern — same eyebrow (h1) + heading (h3) + primary button as featured-collection. Padded with `--spacing-m` and vertically centered within its column.
- **Media column:** Edge-to-edge, no padding (extends to viewport edge for a dramatic feel). Holds 1–2 media blocks side-by-side with `--spacing-xs` gap. Each media item supports image OR video (video wins if both set), with an optional caption (text-body) `--spacing-xs` below the media.
- **Video behavior:** autoplays muted + looped + no controls. Common pattern for ambient hero video.
- **Schema:** 2-block limit on media. Presets include 2 media blocks by default.

The previous starter `image-text.liquid` was removed — it referenced the deleted `.button.secondary` class and had a different schema. Don't try to use it.

### `feature-card.liquid` (Feature Card)

Left-aligned card (max-width **1134px**) that promotes a piece of content from a metaobject + a richtext heading. Sits at the end of the homepage, before the footer.

- **Section padding:** `--spacing-m`
- **Card:** max-width 1134px, padding `--spacing-m`, border-radius `--rad-s`, **horizontally centered** in the section via `margin-inline: auto`
- **Two stacked containers inside the card:**
  1. **Metaobject entry** — title (text-h1) + image + description (text-body) + link (text-ui). Each field is conditionally rendered AND toggleable via section checkboxes.
  2. **Richtext heading** — displayed with `.text-h2` styling. Semantically a div (not an h2 tag) because richtext outputs `<p>` which is invalid inside h2.
- **Card colours:** merchant picks `card_bg` AND `card_color` from a `select` setting locked to Frood's 6 brand tokens (off-white, beige, dark burgundy, warm grey, yellow, pale yellow). CSS uses modifier classes like `.card-bg-bg-dark` and `.card-color-text`.

**Wired to the existing `news` metaobject** (defined in Shopify admin, Settings → Custom data → Metaobjects → News). Expected field handles:

- `date` (date)
- `location` (single line text)
- `title` (single line text)
- `news_image` (file reference, image)
- `news_description` (rich text)
- `news_link` (URL)

If field handles differ in the admin (Shopify lowercases + snake_cases field names → handles), update the references in `sections/feature-card.liquid` accordingly.

**Why type-locked:** Shopify's `metaobject` schema picker requires a fixed `metaobject_type` — no way to let the merchant pick the type at section level. To feature a different metaobject type (e.g. recipes, press mentions), either duplicate the section file per type, or change the `metaobject_type` value in this one's schema and update the field references.

## Bundle Builder Section

`sections/bundle-builder.liquid` — an interactive "build your box" section (v3, box-first), ported
from the Svelte prototype's `/v3`. The shopper fills ONE fixed box of **4 packs** (capacity locked,
not a merchant setting) by mixing flavours, then adds the whole box to the **native Shopify cart** as
a SINGLE line item at a flat price. There are **no discount tiers** and **no multi-box draft** — that
was the old pouch-first v2, now fully removed (`bundle-store.js`, `bundle-cart-view.js`,
`snippets/bundle-cart.liquid`, `box.glb`, `pouch.glb`, `box.webp` all deleted).

**State is an ordered list:** `<bundle-builder>` holds `box: [{ key, id }, …]` — one entry per pack,
capped at capacity, order-sensitive (`box[0]` oldest, `box[last]` newest). `id` is the flavour's
metaobject handle; `key` is a stable session-local id so the visualiser keeps each pack's identity
across add/remove. The newest pack renders at the FRONT of the visual stack. Per-flavour counts are
derived for the steppers and the line-item property.

**Files:**

- `sections/bundle-builder.liquid` — markup, co-located stylesheet, schema (box `product` picker,
  header text, optional `box_back_image`/`box_front_image` overrides, color scheme). No blocks.
- `assets/bundle-builder.js` — `<bundle-builder>` web component: owns the ordered pack list,
  localStorage persistence (`frood.bundle.v3.<sectionId>` — flavour ids only), steppers, and native
  add-to-cart. Header comment documents the full expected-markup + event contract.
- `assets/bundle-stage.js` — `<bundle-stage>` web component: pure 2D PNG-compositing depth-stack
  visualiser. **No three.js.** Reconciles a keyed `.bundle-slot` per pack with enter/exit transitions.
- `assets/box-back.png` + `assets/box-front.png` — committed placeholder box-layer renders (heavy —
  replace with optimised Blender exports). Overridable per-section via the image-picker settings.

three.js is **not** used here any more. `layout/theme.liquid` still vendors it (the one import
map) for `product-card-stage.js`, which is currently **dormant** — model support was removed from
the product card (see "Product card thumbnail media"), but the script + import map are kept so it can
be re-wired later. Don't remove them unless you're dropping 3D for good.

**Two-component split:** `<bundle-builder>` (state) and `<bundle-stage>` (visual) are standalone per
theme convention — they communicate only via `bundle:updated` on `document`, detail
`{ box: [{ key, id, image }, …], counts, filled, capacity, isFull }`. The builder resolves each pack's
image (from the flavour metaobject, via the `.bundle-flavours` JSON blob) into the event, so the stage
needs no catalogue of its own. On connect the stage dispatches `bundle:request-state` and the builder
re-emits — the handshake covering module-upgrade order.

**Visualiser (PNG depth stack):** back→front the stage layers `box-back` (z 0), the packs (each
`z = 100 − depth`), and `box-front` (z 200, occludes the pack bases). A pack at `depth` is the same
full-frame render translated up-left by `depth × STACK.offset` (`STACK = { offsetX: -9.5, offsetY: -4,
scaleStep: 0, rotateStep: 0 }`) — the renders are authored in-scale so it's translate-only by default.
Append `?bundle-calibrate` to the URL for a dev slider overlay to retune `STACK` against real renders.

**Flavours are curated per box product** via its `custom.included_flavours` metafield — a list of
`flavour` metaobjects. The section reads `box_product.metafields.custom.included_flavours.value` (a
single `assign` reused by both the JSON blob and the cards), so the merchant controls **which**
flavours show and **in what order** by editing that list on the product (no theme change). Each
referenced `flavour` metaobject needs `name` (single line text), optional `notes` (single line text),
and `image` (file reference, image) — the pouch render for the stack. Missing images hide
gracefully (`onerror`). The box capacity (4) is independent of how many flavours are included; no box
product (or an empty metafield) → no flavours render and the add button stays disabled.

**The box is a single product + flavour property:** the section's `product` setting is the flat-priced
"Build Your Box" product. When the box is full, the builder POSTs that product's variant to
`/cart/add.js` (`{ items: [{ id, quantity: 1, properties: { Flavours: "2 × Mexi, 2 × Curry" } }],
sections: ['cart-drawer'] }`), clears the local draft, dispatches `cart:item-added` with the bundled
section HTML, and fires a success `toast:show` — the same contract as `product-form.js` (the native
`<cart-drawer>` refreshes but does **not** auto-open; it opens on cart-icon click). The bundle is never
the cart — flavours have no SKU/inventory of their own; the box line carries them as a property only.
If no box product is configured, the builder still assembles but the add button stays disabled.
