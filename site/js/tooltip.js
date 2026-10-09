// Gloss tooltips: hover and keyboard focus on desktop, tap-to-toggle on touch.
// One tooltip open at a time; Esc or tapping elsewhere closes it. Never touches audio.
//
// A tooltip shows: the translation in bold, then one line per word entry
// (Welsh forms + tag, English + derived tag), then any notes.

// Welsh tag -> label, tooltip help, colour class. Gender tags also produce an
// English (m)/(f) tag on the English side.
const TAGS = {
  eg: { cy: 'eg', title: 'enw gwrywaidd: masculine noun', cls: 'm', en: 'm', enTitle: 'masculine' },
  eb: { cy: 'eb', title: 'enw benywaidd: feminine noun', cls: 'f', en: 'f', enTitle: 'feminine' },
  egb: { cy: 'egb', title: 'enw gwrywaidd neu fenywaidd: masculine or feminine noun', cls: 'b', en: 'm/f', enTitle: 'masculine or feminine' },
  adj: { cy: 'adj', title: 'ansoddair: adjective', cls: 't' },
  verb: { cy: 'verb', title: 'berf / berfenw: verb', cls: 't' },
  prep: { cy: 'prep', title: 'arddodiad: preposition', cls: 't' },
  adv: { cy: 'adv', title: 'adferf: adverb', cls: 't' },
  conj: { cy: 'conj', title: 'cysylltair: conjunction', cls: 't' },
  pron: { cy: 'pron', title: 'rhagenw: pronoun', cls: 't' },
};

function chip(label, def, title) {
  const el = document.createElement('span');
  el.className = `tag tag-${def.cls}`;
  el.textContent = `(${label})`;
  el.title = title;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', title);
  return el;
}

function entryLine(entry) {
  const def = TAGS[entry.tag];
  const row = document.createElement('div');
  row.className = 'tip-entry';
  const cy = document.createElement('span');
  cy.className = 'tip-cy';
  cy.lang = 'cy';
  cy.textContent = entry.cy.join(', ');
  row.append(cy);
  if (def) row.append(' ', chip(def.cy, def, def.title));
  const sep = document.createElement('span');
  sep.className = 'tip-sep';
  sep.setAttribute('aria-hidden', 'true');
  sep.textContent = ' – ';
  const en = document.createElement('span');
  en.className = 'tip-en';
  en.lang = 'en';
  en.textContent = entry.en;
  row.append(sep, en);
  if (def?.en) row.append(' ', chip(def.en, def, def.enTitle));
  return row;
}

export function initTooltips(root) {
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

  function entriesOf(el) {
    if (!el.dataset.entries) return [];
    try {
      const list = JSON.parse(el.dataset.entries);
      return Array.isArray(list) ? list.filter((e) => e && Array.isArray(e.cy) && typeof e.en === 'string') : [];
    } catch {
      return [];
    }
  }

  function show(el) {
    if (current === el) return;
    hide();
    current = el;
    const strong = document.createElement('strong');
    strong.textContent = el.dataset.tip;
    tip.replaceChildren(strong);
    const entries = entriesOf(el);
    if (entries.length) {
      const list = document.createElement('div');
      list.className = 'tip-entries';
      for (const e of entries) list.append(entryLine(e));
      tip.append(list);
    }
    if (el.dataset.note) {
      for (const line of el.dataset.note.split('\n')) {
        const small = document.createElement('small');
        small.textContent = line;
        tip.append(small);
      }
    }
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
