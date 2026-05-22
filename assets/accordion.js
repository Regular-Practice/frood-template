/**
 * Accordion List Web Component
 *
 * Progressive enhancement for native <details>/<summary> accordions.
 *
 * With no JS, the native disclosure works fine (and the global ::details-content
 * rule in base.css animates it in Chrome/Safari, snaps in Firefox). Once this
 * component upgrades, it switches the piloted items to a JS-driven
 * `grid-template-rows: 0fr to 1fr` animation that *also* tweens on close -- which
 * native <details> can't do alone, because it flips the content to
 * content-visibility:hidden the instant [open] is removed. We hold [open]
 * through the close tween and only drop it on transitionend.
 *
 * Markup contract (per item — three nested divs after the summary):
 *   <details class="...">
 *     <summary>...<span class="... accordion-icon" aria-hidden="true">+</span></summary>
 *     <div class="accordion-content">          (grid wrapper - size-driven)
 *       <div class="accordion-content-inner">  (overflow:hidden, NO padding)
 *         <div class="...body...">             (all padding/border lives here)
 *           ...content...
 *         </div>
 *       </div>
 *     </div>
 *   </details>
 *
 * State lives in the `.is-open` class on the <details> (added at the *start* of
 * the animation, unlike native [open] which lingers through the close tween).
 * The matching CSS keys the grid + icon off `.is-open` so they co-time.
 *
 * Attributes:
 *   allow-multiple — keep independent toggling (multiple panels open at once).
 *                    Without it, opening one item collapses its siblings.
 */

const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");
const DURATION = 300; // keep in sync with the CSS transition duration
const closing = new WeakMap(); // details -> { content, onEnd, timer }

class AccordionList extends HTMLElement {
  connectedCallback() {
    this.allowMultiple = this.hasAttribute("allow-multiple");
    this.items = Array.from(this.querySelectorAll(":scope > details"));
    this.handlers = [];

    this.items.forEach((details) => {
      const summary = details.querySelector(":scope > summary");
      if (!summary) return;

      // Server-rendered open items show expanded on load (no entry animation).
      if (details.open) details.classList.add("is-open");

      const onClick = (event) => {
        event.preventDefault(); // take over the native toggle so close can animate
        this.toggle(details);
      };
      summary.addEventListener("click", onClick);
      this.handlers.push({ summary, onClick });
    });

    // Flag enhancement so the CSS swaps from the native ::details-content
    // animation to the grid-rows technique. Set last so failures above leave
    // the native fallback intact.
    this.setAttribute("data-enhanced", "");
  }

  disconnectedCallback() {
    this.handlers.forEach(({ summary, onClick }) =>
      summary.removeEventListener("click", onClick)
    );
    this.items.forEach((details) => this.cancelClose(details));
  }

  toggle(details) {
    if (details.classList.contains("is-open")) this.collapse(details);
    else this.expand(details);
  }

  expand(details) {
    if (!this.allowMultiple) {
      this.items.forEach((other) => {
        if (other !== details && other.classList.contains("is-open")) {
          this.collapse(other);
        }
      });
    }

    this.cancelClose(details);
    details.open = true; // content-visibility:visible; grid still 0fr (no .is-open yet)

    if (REDUCE.matches) {
      details.classList.add("is-open");
      return;
    }

    // Force a reflow so the browser paints the 0fr start frame before 1fr.
    this.content(details).getBoundingClientRect();
    details.classList.add("is-open");
  }

  collapse(details) {
    const content = this.content(details);
    details.classList.remove("is-open"); // grid 1fr -> 0fr

    if (REDUCE.matches || !content) {
      details.open = false;
      return;
    }

    const finish = () => {
      this.cancelClose(details);
      details.open = false; // content-visibility:hidden — drops content from a11y tree
    };
    const onEnd = (event) => {
      if (event.target === content && event.propertyName === "grid-template-rows") {
        finish();
      }
    };
    content.addEventListener("transitionend", onEnd);
    // Safety net if transitionend never fires (interruption, prefers-reduced-motion
    // toggled mid-flight, etc.).
    const timer = window.setTimeout(finish, DURATION + 150);
    closing.set(details, { content, onEnd, timer });
  }

  cancelClose(details) {
    const pending = closing.get(details);
    if (!pending) return;
    pending.content.removeEventListener("transitionend", pending.onEnd);
    window.clearTimeout(pending.timer);
    closing.delete(details);
  }

  content(details) {
    return details.querySelector(":scope > .accordion-content");
  }
}

customElements.define("accordion-list", AccordionList);
