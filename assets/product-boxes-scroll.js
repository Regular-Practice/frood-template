/*
  PDP boxes-column scroll behaviour:
   - Within the .main-product section the column is `position: sticky` (CSS).
   - Once the section has scrolled past the top of the viewport, this script
     adds `.is-compact` to .product-boxes so it docks at the top-left of the
     viewport (fixed) in a slim form — eyebrow + title + buy row only, with
     render + accordions + variants hidden.
   - Scrolling back into the section removes the class and returns the column
     to its full form.

  IntersectionObserver watches the section: when it's not intersecting AND
  its top is above the viewport (boundingClientRect.top < 0), we know the
  user has scrolled past the bottom of the section.
*/

const section = document.querySelector('.main-product');
const boxes = section?.querySelector('.product-boxes');

if (section && boxes && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(([entry]) => {
    const scrolledPast = !entry.isIntersecting && entry.boundingClientRect.top < 0;
    boxes.classList.toggle('is-compact', scrolledPast);
  });

  observer.observe(section);
}
