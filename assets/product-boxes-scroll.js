/*
  PDP boxes-column compact-state trigger:
   - Desktop (≥900px): activates when the .main-product section has scrolled
     50% of its height past the top of the viewport. The boxes column is
     `position: fixed` on desktop, so it never leaves the viewport on its
     own; we key off the section's scroll progress instead.
   - Tablet (600–899px): activates when the .product-boxes column's
     bottom edge has scrolled above the top of the viewport (i.e. the column
     has fully left the viewport going up).
   - Phones (<600px): compact state is DISABLED. No sticky add-to-cart bar
     on phones — the boxes scroll naturally with the page.

   - Compact behaviour per breakpoint is defined in main-product.liquid:
       Desktop:  stays fixed top-left, collapses render/accordions/variants.
       Tablet:   switches from absolute (anchored to the section's bottom)
                 to fixed (anchored to the viewport's bottom), same slim
                 form, but keeps the render visible (tablet-only override).
       Phones:   compact state never applies — the boxes flow in document
                 order without a sticky bar.

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
  // Compact state is disabled on phones — also handles cases where a resize
  // shrinks the viewport into the phone range while .is-compact was active.
  const phoneQuery = window.matchMedia('(max-width: 599.98px)');

  const shouldActivate = () => {
    if (desktopQuery.matches) {
      const rect = section.getBoundingClientRect();
      return rect.top <= -rect.height / 2;
    }
    const rect = boxes.getBoundingClientRect();
    return rect.bottom < 0;
  };

  const update = () => {
    // Phones: never activate; strip the class if a resize left it lingering.
    if (phoneQuery.matches) {
      if (boxes.classList.contains('is-compact')) {
        boxes.classList.remove('is-compact');
        activationScrollY = null;
      }
      return;
    }

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
