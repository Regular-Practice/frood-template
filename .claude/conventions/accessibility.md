# Accessibility Conventions

> WCAG 2.1 AA baseline with enhanced keyboard navigation and ARIA support.

---

## Standard

**WCAG 2.1 Level AA** — all pages, all interactive elements, both backgrounds (default off-white and `.bg-tinted` beige).

---

## Keyboard Navigation

### Requirements

- All interactive elements reachable via Tab in logical order
- Skip-to-content link as first focusable element: `<a href="#main-content" class="skip-link">`
- Escape key closes all overlays (drawers, modals, mobile menu)
- Enter/Space activates buttons and links
- Return focus to the trigger element when closing an overlay

### Focus Trapping

Required in all overlay components (cart drawer, mobile menu, modals):

- On open: move focus to the first focusable element inside
- Tab cycles through focusable elements within the overlay only
- Shift+Tab wraps from first to last element
- On close: release trap and return focus to the trigger element

Focusable selector: `button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`

---

## Focus States

Custom outline on all interactive elements:

```css
:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

:focus:not(:focus-visible) {
  outline: none;
}
```

- `currentColor` adapts to the surrounding text color automatically
- Never remove focus outlines without providing an alternative
- Input elements use `outline-offset: 5px`

---

## ARIA Patterns

### Expandable Elements (mobile menu, accordion)

- Trigger: `aria-expanded="false"` + `aria-controls="target-id"`
- Target: `aria-hidden="true"` (toggled with `aria-expanded`)
- Update both attributes in JS when toggling

### Overlays (cart drawer, modals)

- Container: `role="dialog"` + `aria-modal="true"` + `aria-label="..."`
- When closed: `aria-hidden="true"` on container
- When open: `aria-hidden="false"`, focus trapped inside

### Live Regions

- Cart count announcements: `aria-live="polite"` + `aria-atomic="true"` on a `.visually-hidden` element
- Error messages: `role="alert"` (implicitly `aria-live="assertive"`)
- Update content via `textContent` — screen readers announce automatically

### Icon-Only Buttons

- Button gets `aria-label="Close cart"` (or similar)
- SVG inside gets `aria-hidden="true"` + `focusable="false"`
- Alternative: use `.visually-hidden` text span inside the button

### Navigation

- All `<nav>` elements require `aria-label` (e.g., "Main navigation", "Footer navigation")
- Differentiate multiple navs on the same page with unique labels

### Decorative Elements

- Decorative images: `alt=""` + `aria-hidden="true"`
- Decorative icons/arrows: `aria-hidden="true"`

---

## Heading Hierarchy

- One `<h1>` per page (usually the page/product/collection title)
- Sections use `<h2>`
- Subsections use `<h3>`
- Never skip heading levels (e.g., h1 to h3)

---

## Forms

- Every `<input>` must have an associated `<label>` (with matching `for`/`id`)
- Error messages: `role="alert"` + linked via `aria-describedby` on the input
- Invalid inputs: `aria-invalid="true"` when validation fails
- Required fields: `required` attribute + `aria-required="true"`

---

## Images

- Product/content images: descriptive `alt` text (under 125 characters, don't start with "Image of")
- Decorative images: `alt=""` + `aria-hidden="true"`
- Always include `width` and `height` attributes to prevent layout shift

---

## Color Contrast

- Normal text: 4.5:1 minimum ratio
- Large text (18px+ bold or 24px+): 3:1 minimum
- UI components and borders: 3:1 minimum
- Applies on both backgrounds (default off-white and `.bg-tinted` beige)

---

## Reduced Motion

All animations and transitions disabled when user prefers reduced motion:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

In JavaScript (for Motion library or programmatic animations):
```js
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  // Skip animations
}
```

---

## Checklist

When building or modifying any section/component, verify:

- [ ] All interactive elements reachable via keyboard
- [ ] Focus visible on all interactive elements
- [ ] Skip link works (targets `#main-content`)
- [ ] Overlays trap focus and return focus on close
- [ ] `<nav>` elements have `aria-label`
- [ ] Icon-only buttons have `aria-label`
- [ ] Form inputs have associated `<label>` elements
- [ ] Error messages use `role="alert"`
- [ ] Heading hierarchy is correct (no skipped levels)
- [ ] Images have appropriate `alt` text
- [ ] Color contrast meets minimums in all schemes
- [ ] Reduced motion respected
