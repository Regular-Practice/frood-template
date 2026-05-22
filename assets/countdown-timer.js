/**
 * <countdown-timer> — live "time until launch" clock for the password page.
 *
 * Markup is server-rendered by sections/main-password.liquid. The host carries
 * the target instant on `data-deadline` as an ISO 8601 string WITH a timezone
 * offset (e.g. 2026-06-01T09:00:00+01:00) so `new Date()` parses it identically
 * in every browser and DST is the merchant's explicit choice, not a guess.
 *
 * Ticks once a second, writing zero-padded days/hours/minutes/seconds into the
 * [data-*] spans. At/under zero it stops, hides the digit grid, and reveals the
 * launched message ([data-launched]).
 *
 * Accessibility: the digit grid is aria-hidden (a per-second live region would
 * flood screen readers). The host is role="timer" (implicit aria-live="off"),
 * carrying a coarse aria-label that updates silently — read on demand, never
 * announced every tick.
 *
 * Expected markup:
 *   <countdown-timer class="password-countdown" role="timer"
 *     data-deadline="2026-06-01T09:00:00+01:00" data-aria-prefix="Launching in">
 *     <div class="password-countdown-grid" data-grid aria-hidden="true">
 *       <span data-days>00</span> … data-hours / data-minutes / data-seconds
 *     </div>
 *     <p data-launched hidden>We're live!</p>
 *   </countdown-timer>
 */

class CountdownTimer extends HTMLElement {
  connectedCallback() {
    const raw = this.dataset.deadline;
    this.deadline = raw ? new Date(raw) : null;

    // No date set, or unparseable → render nothing. (Liquid only emits this
    // element when a launch date is present, but guard against a bad value.)
    if (!this.deadline || Number.isNaN(this.deadline.getTime())) {
      this.hidden = true;
      return;
    }

    this.grid = this.querySelector('[data-grid]');
    this.launched = this.querySelector('[data-launched]');
    this.fields = {
      days: this.querySelector('[data-days]'),
      hours: this.querySelector('[data-hours]'),
      minutes: this.querySelector('[data-minutes]'),
      seconds: this.querySelector('[data-seconds]'),
    };
    this.ariaPrefix = this.dataset.ariaPrefix || '';

    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  disconnectedCallback() {
    clearInterval(this.timer);
  }

  tick() {
    const diff = this.deadline.getTime() - Date.now();
    if (diff <= 0) {
      this.showLaunched();
      return;
    }

    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    this.fields.days.textContent = String(days).padStart(2, '0');
    this.fields.hours.textContent = String(hours).padStart(2, '0');
    this.fields.minutes.textContent = String(minutes).padStart(2, '0');
    this.fields.seconds.textContent = String(seconds).padStart(2, '0');

    this.setAttribute(
      'aria-label',
      `${this.ariaPrefix} ${days}d ${hours}h ${minutes}m ${seconds}s`.trim()
    );
  }

  showLaunched() {
    clearInterval(this.timer);
    if (this.grid) this.grid.hidden = true;
    if (this.launched) this.launched.hidden = false;
    this.setAttribute('aria-label', this.launched?.textContent?.trim() || '');
  }
}

customElements.define('countdown-timer', CountdownTimer);
