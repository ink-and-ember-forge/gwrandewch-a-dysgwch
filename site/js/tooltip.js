// Gloss tooltips: hover and keyboard focus on desktop, tap-to-toggle on touch.
// One tooltip open at a time; Esc or tapping elsewhere closes it. Never touches audio.
//
// A tooltip shows: the translation in bold, then one line per word entry
// (Welsh forms + tag, English + derived tag), then any notes.

// Tooltip content comes from the shared RenderCore (tools/render-core.js, loaded as
// a classic script before this module), so the editor preview shows the same thing.
const { fillTooltip } = window.RenderCore || {};

export function initTooltips(root) {
  if (!fillTooltip) return; // render-core.js failed to load: the text stays readable without tooltips
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.id = 'gloss-tip';
  tip.role = 'tooltip';
  tip.hidden = true;
  document.body.append(tip);

  let current = null;
  let lastPointer = 'mouse';

  function place() {
    if (!current) return;
    const r = current.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const margin = 8;
    let top = r.top - t.height - margin;
    if (top < margin) top = r.bottom + margin; // no room above: flip below
    const left = Math.min(Math.max(margin, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - margin);
    tip.style.top = `${Math.max(margin, top)}px`;
    tip.style.left = `${left}px`;
  }

  function show(el) {
    if (current === el) return;
    hide();
    current = el;
    if (fillTooltip) fillTooltip(tip, el);
    tip.hidden = false;
    el.setAttribute('aria-describedby', tip.id);
    el.classList.add('is-open');
    place();
  }

  function hide() {
    if (!current) return;
    current.removeAttribute('aria-describedby');
    current.classList.remove('is-open');
    current = null;
    tip.hidden = true;
  }

  const glossOf = (target) => (target instanceof Element ? target.closest('.gloss') : null);

  root.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; }, true);

  // Mouse hover
  root.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const g = glossOf(e.target);
    if (g) show(g);
  });
  root.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    const g = glossOf(e.target);
    if (g && !g.contains(e.relatedTarget) && !g.matches(':focus-visible')) hide();
  });

  // Keyboard focus (focus-visible so a tap does not open then immediately toggle shut)
  root.addEventListener('focusin', (e) => {
    const g = glossOf(e.target);
    if (g && g.matches(':focus-visible')) show(g);
  });
  root.addEventListener('focusout', (e) => { if (glossOf(e.target)) hide(); });

  // Click / tap
  root.addEventListener('click', (e) => {
    const g = glossOf(e.target);
    if (!g) return;
    if (lastPointer === 'mouse') show(g);
    else if (current === g) hide();
    else show(g);
  });

  document.addEventListener('pointerdown', (e) => { if (current && !glossOf(e.target)) hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', place, { passive: true });
  window.addEventListener('resize', place);
}
