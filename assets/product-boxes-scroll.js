/*
  PDP boxes-column compact-state trigger:
   - Desktop (≥900px): activates when the .main-product section has scrolled
     50% of its height past the top of the viewport. The boxes column is
     `position: fixed` on desktop, so it never leaves the viewport on its
     own; we key off the section's scroll progress instead.
   - Tablet / mobile (<900px): activates when the .product-boxes column's
     bottom edge has scrolled above the top of the viewport (i.e. the column
     has fully left the viewport going up).

   - Compact behaviour per breakpoint is defined in main-product.liquid:
       Desktop:  stays fixed top-left, collapses render/accordions/variants.
       Tablet:   switches from absolute (anchored to the section's bottom)
                 to fixed (anchored to the viewport's bottom), same slim
                 form, but keeps the render visible (tablet-only override).
       Mobile:   switches from static (in normal flow under the slider) to
                 fixed at the viewport bottom — sticky add-to-cart bar,
                 with a slide-up entry animation.

  Deactivation: latch the scrollY at the moment of activation; remove the
  class only once the user has scrolled back above that latched position.
  This is necessary because once `.is-compact` is applied, the boxes column
  becomes `position: fixed` and its bounding rect re-enters the viewport —
  an observer or rect-based deactivation check would flicker. The latched
  scrollY gives us a stable un-pin threshold that doesn't depend on the
  boxes' rect after it's gone fixed.
*/

const section = document.querySelector('.main-product');
const boxes = section?.querySelector('.product-boxes');

if (section && boxes) {
  let activationScrollY = null;
  const desktopQuery = window.matchMedia('(min-width: 900px)');

  const shouldActivate = () => {
    if (desktopQuery.matches) {
      const rect = section.getBoundingClientRect();
      return rect.top <= -rect.height / 2;
    }
    const rect = boxes.getBoundingClientRect();
    return rect.bottom < 0;
  };

  const update = () => {
    if (boxes.classList.contains('is-compact')) {
      if (activationScrollY !== null && window.scrollY < activationScrollY) {
        boxes.classList.remove('is-compact');
        activationScrollY = null;
      }
    } else if (shouldActivate()) {
      activationScrollY = window.scrollY;
      boxes.classList.add('is-compact');
    }
  };

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}
