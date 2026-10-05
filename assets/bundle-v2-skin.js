/*
  Bundle builder — v2 look for the original builder (assets/bundle-builder.js).

  Two small, presentation-only jobs. Neither touches the builder's own logic,
  state, pricing or add-to-cart:

  1. Feeds the v2 pack strip. <bundle-v2-stage> (assets/bundle-v2-stage.js) draws
     the draft from `bundle-v2:updated`. This builder still emits its own
     `bundle:updated`, so this file relays one to the other: the builder's boxes
     are flattened into one ordered list of packs, each pack using its flavour's
     `packImage` (the v2_pack_render, from the .bundle-flavours JSON blob).
     It also answers the stage's `bundle-v2:request-state` handshake by asking
     the builder to re-emit, since either module may upgrade after the other.

  2. Mobile panel: expands / collapses the pinned "Your box" panel by toggling
     `is-collapsed` on .bundle-v2-panel. CSS only reacts to it below 900px.

  Event contract in:  'bundle:updated'          (see bundle-builder.js)
  Event contract out: 'bundle-v2:updated'       detail: { packs: [{ key, id, image }, …],
                                                  counts, total, shortfall, minPacks, isValid }
*/

function packImages() {
  const blob = document.querySelector('.bundle-flavours');
  const map = {};
  if (!blob) return map;
  try {
    JSON.parse(blob.textContent).forEach((flavour) => {
      map[flavour.id] = flavour.packImage || flavour.image || '';
    });
  } catch {
    /* malformed blob — the strip just shows no pack images */
  }
  return map;
}

let images = null;

document.addEventListener('bundle:updated', (e) => {
  const detail = e.detail || {};
  if (!images) images = packImages();

  const packs = (detail.boxes || []).flat().map((pack) => ({
    key: pack.key,
    id: pack.id,
    image: images[pack.id] || pack.image || ''
  }));

  document.dispatchEvent(
    new CustomEvent('bundle-v2:updated', {
      detail: {
        packs,
        counts: detail.counts || {},
        total: detail.total || 0,
        shortfall: detail.remainder ? (detail.capacity || 0) - detail.remainder : 0,
        minPacks: detail.capacity || 0,
        isValid: Boolean(detail.isValid)
      }
    })
  );
});

// The stage asks for the current draft when it connects.
document.addEventListener('bundle-v2:request-state', () => {
  document.dispatchEvent(new CustomEvent('bundle:request-state'));
});

// Mobile panel expand / collapse.
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-panel-toggle]');
  if (!toggle) return;
  const panel = toggle.closest('.bundle-v2-panel');
  if (!panel) return;
  const collapsed = panel.classList.toggle('is-collapsed');
  toggle.setAttribute('aria-expanded', String(!collapsed));
});
