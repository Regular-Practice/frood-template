/**
 * <toast-region> — global transient feedback, Sonner-style stacking.
 *
 * A single live region rendered once in layout/theme.liquid (via
 * snippets/toast-region.liquid), the same singleton pattern as <cart-drawer>
 * and <search-drawer>. Anything on the page can show a toast by dispatching a
 * `toast:show` CustomEvent on `document`, or by importing the showToast()
 * helper below — no reference to this element is needed.
 *
 * Use toasts for action-level / global feedback ("Added to bag", a network
 * failure, checkout error). Field-level validation stays inline near the field
 * (see conventions/commerce.md) — don't toast a "Only 3 available" message.
 *
 * Event contract (the public API):
 *   document.dispatchEvent(new CustomEvent('toast:show', {
 *     detail: {
 *       message,                  // string, required — set via textContent
 *       variant = 'info',         // 'success' | 'error' | 'info'
 *       duration = 4000,          // ms; 0 = sticky (no auto-dismiss)
 *       image,                    // optional URL — shows a 30×30 thumbnail
 *       imageAlt = '',            // optional alt; '' keeps the thumb decorative
 *     }
 *   }));
 *   // or: import { showToast } from './toast.js';
 *   //     showToast('Added to bag', { variant: 'success' });
 *
 * For cart thumbnails, pass a sized CDN URL (e.g. append `&width=60`) so the
 * 30×30 slot doesn't download the full-size product image. Cart callers inline
 * a small `toastThumb()` helper for this rather than importing one from here —
 * a versionless `./toast.js` import can break if the served file is stale.
 *
 * Stacking model (see base.css §23 for the matching CSS):
 *   Toasts are absolutely positioned at a shared bottom anchor. Each toast is
 *   two layers — .toast-item (wrapper: stack lift + scale + collapsed↔expanded
 *   fan) and .toast (inner: enter/exit + swipe + the visible card). This file
 *   measures heights (via ResizeObserver, so font-load / re-wrap can't desync
 *   the stack) and writes the numeric custom props the CSS reads; CSS animates.
 *   - Collapsed: front toast sharp, older ones peek behind, scaled down.
 *   - Hover / keyboard focus: the stack fans open and auto-dismiss pauses.
 *   - Pointer drag: swipe horizontally past a threshold to dismiss; short drags
 *     spring back. Vertical drags fall through to native page scroll.
 *
 * Accessibility: the region is aria-live="polite" so success/info announce
 * politely; error toasts get role="alert" (assertive) on the toast itself.
 * Toasts never steal focus. Focusing a close button fans the stack open so
 * keyboard users see what they're dismissing.
 *
 * Expected markup (toast-region.liquid owns it, incl. the clone <template>):
 *   <toast-region class="toast-region" aria-live="polite">
 *     <template data-toast-template>
 *       <div class="toast-item">
 *         <div class="toast" role="status">
 *           <img class="toast-thumb" alt="" width="30" height="30">
 *           <span class="toast-message"></span>
 *           <button type="button" class="toast-close" data-dismiss aria-label="…">
 *             {% render 'icon-close' %}
 *           </button>
 *         </div>
 *       </div>
 *     </template>
 *   </toast-region>
 */

const DEFAULT_DURATION = 4000;
const MAX_VISIBLE = 3;
const EXIT_MS = 320; // mirrors --toast-motion (0.3s) + buffer; node removal delay
const VARIANTS = ['success', 'error', 'info'];
const SWIPE_MIN = 45; // px — minimum swipe distance to dismiss
const SWIPE_RATIO = 0.35; // …or this fraction of the toast width, whichever is larger

/**
 * Show a toast from anywhere. Thin wrapper over the `toast:show` event so
 * callers don't need a handle on <toast-region>.
 * @param {string} message
 * @param {{ variant?: 'success'|'error'|'info', duration?: number, image?: string, imageAlt?: string }} [options]
 */
export function showToast(message, options = {}) {
  document.dispatchEvent(
    new CustomEvent('toast:show', { detail: { message, ...options } })
  );
}

class ToastRegion extends HTMLElement {
  connectedCallback() {
    this.template = this.querySelector('[data-toast-template]');
    this.timers = new WeakMap(); // .toast-item -> { remaining, startedAt, timer }
    this.items = []; // .toast-item, oldest → newest; excludes leaving toasts
    this.expanded = false;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const cs = getComputedStyle(this);
    this.gap = parseFloat(cs.getPropertyValue('--toast-gap')) || 8;
    this.peek = parseFloat(cs.getPropertyValue('--toast-peek')) || 14;

    // Re-measure on font swap / message re-wrap / viewport resize.
    this.ro = new ResizeObserver(() => this.reflow());

    // Bound handlers for the active swipe drag (added/removed per gesture).
    this._onMove = this.onMove.bind(this);
    this._onUp = this.onUp.bind(this);
    this._onCancel = () => this.endDrag(false);

    this._onToastShow = (e) => this.show(e.detail || {});
    document.addEventListener('toast:show', this._onToastShow);

    // Hover (mouse/pen only) and keyboard focus fan the stack open.
    this.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') this.expand();
    });
    this.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch') this.collapse();
    });
    this.addEventListener('focusin', () => this.expand());
    this.addEventListener('focusout', (e) => {
      if (!this.contains(e.relatedTarget)) this.collapse();
    });
  }

  disconnectedCallback() {
    document.removeEventListener('toast:show', this._onToastShow);
    this.ro.disconnect();
    this.items.forEach((item) => {
      const state = this.timers.get(item);
      if (state?.timer) clearTimeout(state.timer);
    });
  }

  /**
   * Build, mount, and schedule a toast.
   * @param {{ message?: string, variant?: string, duration?: number, image?: string, imageAlt?: string }} detail
   */
  show({ message, variant = 'info', duration = DEFAULT_DURATION, image, imageAlt = '' }) {
    if (!message || !this.template) return;
    if (!VARIANTS.includes(variant)) variant = 'info';

    const fragment = this.template.content.cloneNode(true);
    const item = fragment.querySelector('.toast-item');
    const toast = item.querySelector('.toast');
    const messageEl = toast.querySelector('.toast-message');
    const thumb = toast.querySelector('.toast-thumb');
    const closeBtn = toast.querySelector('[data-dismiss]');

    toast.classList.add(`toast-${variant}`);
    // Errors announce assertively; success/info inherit the region's polite live setting.
    toast.setAttribute('role', variant === 'error' ? 'alert' : 'status');
    messageEl.textContent = message;

    // Optional thumbnail — width/height attrs keep the box reserved before load
    // so the stack math doesn't shift. No image → drop the node entirely.
    if (image && thumb) {
      thumb.src = image;
      thumb.alt = imageAlt;
    } else {
      thumb?.remove();
    }

    closeBtn?.addEventListener('click', () => this.dismiss(item));
    toast.addEventListener('pointerdown', (e) => this.onDown(e, item));

    if (duration > 0) {
      this.timers.set(item, { remaining: duration, startedAt: 0, timer: null });
    }

    this.appendChild(item);
    this.ro.observe(toast);
    this.items.push(item);

    this.reflow();
    this.enforceLimit();
    this.resume(item);

    // Next frame: flip to the visible state so the enter transition runs.
    requestAnimationFrame(() => toast.classList.add('is-visible'));
  }

  /** Recompute each toast's stack lift, depth, z-order, and the region height. */
  reflow() {
    const list = this.items;
    let stack = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];
      const idx = list.length - 1 - i; // 0 = front (newest)
      item.style.setProperty('--ti-stack', stack);
      item.style.setProperty('--ti-index', idx);
      item.style.zIndex = String(1000 - idx); // front paints on top
      stack += this.innerH(item) + this.gap;
    }
    const frontH = list.length ? this.innerH(list[list.length - 1]) : 0;
    const expandedH = stack ? stack - this.gap : 0; // drop the trailing gap
    const collapsedH = frontH + Math.min(list.length - 1, MAX_VISIBLE - 1) * this.peek;
    this.style.height = `${this.expanded ? expandedH : collapsedH}px`;
  }

  /** Measured height of a toast — the inner card drives the layout box. */
  innerH(item) {
    return item.firstElementChild.offsetHeight;
  }

  /** Fan the stack open (full size, real heights) and pause every timer. */
  expand() {
    if (this.expanded || !this.items.length) return;
    this.expanded = true;
    this.style.setProperty('--toast-expanded', '1');
    this.pauseAll();
    this.reflow();
  }

  /** Collapse back to the peeking stack and resume timers. */
  collapse() {
    if (!this.expanded || this._drag) return; // never collapse mid-swipe

    this.expanded = false;
    this.style.setProperty('--toast-expanded', '0');
    this.reflow();
    this.resumeAll();
  }

  pauseAll() {
    this.items.forEach((item) => this.pause(item));
  }

  resumeAll() {
    this.items.forEach((item) => this.resume(item));
  }

  /** Pause a toast's auto-dismiss timer, banking the remaining time. */
  pause(item) {
    const state = this.timers.get(item);
    if (!state || !state.timer) return;
    clearTimeout(state.timer);
    state.timer = null;
    state.remaining -= Date.now() - state.startedAt;
  }

  /** (Re)start a toast's timer — unless the stack is held open. */
  resume(item) {
    if (this.expanded) return; // timers stay paused while fanned open
    const state = this.timers.get(item);
    if (!state || state.timer) return;
    state.startedAt = Date.now();
    state.timer = setTimeout(() => this.dismiss(item), Math.max(0, state.remaining));
  }

  // ----- Swipe-to-dismiss (pointer events, axis-locked) ---------------------

  onDown(e, item) {
    if (item.dataset.leaving) return;
    if (e.target.closest('[data-dismiss]')) return; // close button handles itself
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const inner = item.firstElementChild;
    this._drag = { item, inner, x: e.clientX, y: e.clientY, dx: 0, lock: null, w: inner.offsetWidth };
    try {
      inner.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    inner.addEventListener('pointermove', this._onMove);
    inner.addEventListener('pointerup', this._onUp);
    inner.addEventListener('pointercancel', this._onCancel);
  }

  onMove(e) {
    const d = this._drag;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;

    if (!d.lock) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 4) {
        d.lock = 'x';
        d.inner.classList.add('is-swiping'); // track the finger 1:1
        this.pause(d.item);
      } else if (Math.abs(dy) > 6) {
        this.endDrag(false); // vertical intent — let the page scroll
        return;
      } else {
        return;
      }
    }

    d.dx = dx;
    e.preventDefault();
    d.inner.style.setProperty('--toast-swipe', dx);
  }

  onUp() {
    const d = this._drag;
    if (!d) return;
    if (d.lock !== 'x') {
      this.endDrag(false);
      return;
    }
    const past = Math.abs(d.dx) > Math.max(SWIPE_MIN, d.w * SWIPE_RATIO);
    this.endDrag(past, Math.sign(d.dx) || 1);
  }

  endDrag(dismiss, dir) {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    d.inner.removeEventListener('pointermove', this._onMove);
    d.inner.removeEventListener('pointerup', this._onUp);
    d.inner.removeEventListener('pointercancel', this._onCancel);
    d.inner.classList.remove('is-swiping'); // re-enable transition for fling / spring-back

    if (dismiss) {
      this.dismiss(d.item, { fling: dir, width: d.w });
    } else {
      d.inner.style.setProperty('--toast-swipe', 0); // spring back
      this.resume(d.item);
    }
  }

  // ----- Removal ------------------------------------------------------------

  /**
   * Animate a toast out, then remove it. Survivors glide to close the gap.
   * @param {HTMLElement} item the .toast-item wrapper
   * @param {{ fling?: number, width?: number }} [opts] swipe-out direction/width
   */
  dismiss(item, opts = {}) {
    if (!item || item.dataset.leaving) return;

    const state = this.timers.get(item);
    if (state?.timer) clearTimeout(state.timer);
    this.timers.delete(item);

    const inner = item.firstElementChild;
    this.ro.unobserve(inner);
    const i = this.items.indexOf(item);
    if (i > -1) this.items.splice(i, 1); // out of the stack math immediately

    item.dataset.leaving = 'true';
    if (opts.fling) {
      inner.style.setProperty('--toast-swipe', opts.fling * ((opts.width || 380) + 120));
      inner.style.opacity = '0';
    } else {
      inner.classList.remove('is-visible');
      inner.classList.add('is-leaving');
    }

    this.reflow(); // remaining toasts glide up
    setTimeout(() => item.remove(), this.reduced ? 0 : EXIT_MS);
  }

  /** Drop the oldest toasts once more than MAX_VISIBLE are on screen. */
  enforceLimit() {
    while (this.items.length > MAX_VISIBLE) {
      this.dismiss(this.items[0]);
    }
  }
}

customElements.define('toast-region', ToastRegion);
