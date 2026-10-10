/* Turns parsed article blocks into the site's HTML, and builds tooltip content.
 * Shared by scripts/build.mjs, the article page tooltips (site/js/tooltip.js)
 * and the browser editor (tools/editor.html), so a preview is the real markup.
 * Plain UMD. In a browser, load lint-core.js first.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./lint-core.js'));
  else root.RenderCore = factory(root.ArticleLint);
}(typeof self !== 'undefined' ? self : this, function (lint) {
  'use strict';

  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  /** "Uned 3" if the author gave a part_label, else "Part 3". */
  const chapterLabel = (part, label) => (label && String(label).trim()) || `Part ${part}`;

  // Welsh tag -> label, help text, colour class. Gender tags also produce an
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

  // ------------------------------------------------------------ HTML

  /** Gloss parts to HTML. `opts.indexGlosses` adds data-gi="n" (used by the editor only). */
  function renderInline(parts, opts) {
    let gi = 0;
    return parts.map((p) => {
      if (p.text !== undefined) return esc(p.text);
      const note = p.note ? ` data-note="${esc(p.note)}"` : '';
      const entries = p.entries && p.entries.length ? ` data-entries="${esc(JSON.stringify(p.entries))}"` : '';
      const idx = opts && opts.indexGlosses ? ` data-gi="${gi}"` : '';
      gi++;
      return `<span class="gloss" tabindex="0" data-tip="${esc(p.tip)}"${entries}${note}${idx}>${esc(p.surface)}</span>`;
    }).join('');
  }

  const plainInline = (parts) => parts.map((p) => (p.text !== undefined ? p.text : p.surface)).join('');

  /** Blocks (from lint-core parseBlocks) to the article body HTML. */
  function renderBody(blocks, enLines) {
    const out = [];
    let open = false;
    const close = () => { if (open) { out.push('</p>'); open = false; } };
    for (const b of blocks) {
      if (b.kind === 'break') { close(); continue; }
      if (b.kind === 'h2') { close(); out.push(`<h2 lang="cy">${renderInline(b.parts)}</h2>`); continue; }
      if (!open) { out.push('<p lang="cy">'); open = true; }
      const en = enLines ? `<span class="seg-en" lang="en" hidden>${esc(enLines[b.index])}</span>` : '';
      out.push(`<span class="seg" data-i="${b.index}">${renderInline(b.parts)}${en}</span>`);
    }
    close();
    return out.join('\n');
  }

  function levelBadge(level) {
    const levels = lint.LEVELS;
    const rank = levels.findIndex((l) => l[0] === level) + 1;
    const dots = '●'.repeat(rank) + '○'.repeat(levels.length - rank);
    const en = rank ? levels[rank - 1][1] : '';
    return `<span class="badge badge-level" data-level="${esc(level)}"><span class="dots" aria-hidden="true">${dots}</span> ${esc(cap(level))} <span class="badge-en" lang="en">${en}</span></span>`;
  }

  /** The article type as a badge, e.g. "Short story". Empty if the id is unknown. */
  function typeBadge(type) {
    const t = lint.TYPES.find((x) => x[0] === type);
    return t ? `<span class="badge badge-type" data-type="${esc(type)}">${esc(t[1])}</span>` : '';
  }
  const typeLabel = (type) => { const t = lint.TYPES.find((x) => x[0] === type); return t ? t[1] : ''; };

  // ----------------------------------------------------- tooltip (DOM)

  function chip(doc, label, def, title) {
    const el = doc.createElement('span');
    el.className = `tag tag-${def.cls}`;
    el.textContent = `(${label})`;
    el.title = title;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', title);
    return el;
  }

  function entryLine(doc, entry) {
    const def = TAGS[entry.tag];
    const row = doc.createElement('div');
    row.className = 'tip-entry';
    const cy = doc.createElement('span');
    cy.className = 'tip-cy';
    cy.lang = 'cy';
    cy.textContent = entry.cy.join(', ');
    row.append(cy);
    if (def) row.append(' ', chip(doc, def.cy, def, def.title));
    const sep = doc.createElement('span');
    sep.className = 'tip-sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = ' – ';
    const en = doc.createElement('span');
    en.className = 'tip-en';
    en.lang = 'en';
    en.textContent = entry.en;
    row.append(sep, en);
    if (def && def.en) row.append(' ', chip(doc, def.en, def, def.enTitle));
    return row;
  }

  /** Parse the data-entries JSON of a gloss element defensively. */
  function entriesOf(dataset) {
    if (!dataset.entries) return [];
    try {
      const list = JSON.parse(dataset.entries);
      return Array.isArray(list) ? list.filter((e) => e && Array.isArray(e.cy) && typeof e.en === 'string') : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Fill `tip` (a .tooltip element) from `gloss` (a gloss span, or any object with
   * a `dataset` of tip/entries/note). The caller handles show/hide and positioning.
   */
  function fillTooltip(tip, gloss) {
    const doc = tip.ownerDocument;
    const strong = doc.createElement('strong');
    strong.textContent = gloss.dataset.tip || '';
    tip.replaceChildren(strong);
    const entries = entriesOf(gloss.dataset);
    if (entries.length) {
      const list = doc.createElement('div');
      list.className = 'tip-entries';
      for (const e of entries) list.append(entryLine(doc, e));
      tip.append(list);
    }
    if (gloss.dataset.note) {
      for (const line of gloss.dataset.note.split('\n')) {
        const small = doc.createElement('small');
        small.textContent = line;
        tip.append(small);
      }
    }
  }

  // ------------------------------------------------- glossary (HTML string)

  const foldKey = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  /** One tooltip word line as HTML: "tyrbin, tyrbinau (eg) – turbine (m)". Mirrors entryLine(). */
  function entryHtml(entry) {
    const def = TAGS[entry.tag];
    const tag = (label, d, title) => ` <span class="tag tag-${d.cls}" role="img" aria-label="${esc(title)}" title="${esc(title)}">(${esc(label)})</span>`;
    return `<span class="tip-cy" lang="cy">${esc(entry.cy.join(', '))}</span>${def ? tag(def.cy, def, def.title) : ''}`
      + `<span class="tip-sep" aria-hidden="true"> – </span><span class="tip-en" lang="en">${esc(entry.en)}</span>${def && def.en ? tag(def.en, def, def.enTitle) : ''}`;
  }

  /**
   * The "Geirfa" section at the foot of an article: every tooltip collected into one
   * alphabetical list. `glosses` are {surface, tip, note, entries}. The same word glossed
   * the same way twice appears once (entries and notes merged). '' if there are none.
   */
  function renderGlossary(glosses) {
    const items = new Map();
    for (const g of glosses) {
      const key = `${foldKey(g.surface)}|${g.tip.toLowerCase()}`;
      if (!items.has(key)) items.set(key, { surface: g.surface, tip: g.tip, entries: [], notes: [] });
      const it = items.get(key);
      for (const e of g.entries || []) {
        if (!it.entries.some((x) => JSON.stringify(x) === JSON.stringify(e))) it.entries.push(e);
      }
      for (const n of (g.note || '').split('\n')) if (n && !it.notes.includes(n)) it.notes.push(n);
    }
    if (!items.size) return '';
    const sorted = [...items.values()].sort((a, b) => foldKey(a.surface).localeCompare(foldKey(b.surface), 'cy') || a.tip.localeCompare(b.tip));
    const rows = sorted.map((it) => {
      const entries = it.entries.length ? `<ul class="gl-entries">${it.entries.map((e) => `<li>${entryHtml(e)}</li>`).join('')}</ul>` : '';
      const notes = it.notes.map((n) => `<small class="gl-note" lang="en">${esc(n)}</small>`).join('');
      return `<div class="gl-item"><dt lang="cy">${esc(it.surface)}</dt><dd><span class="gl-tip" lang="en">${esc(it.tip)}</span>${entries}${notes}</dd></div>`;
    });
    return `<section class="glossary" aria-labelledby="geirfa-h">
      <h2 id="geirfa-h"><span lang="cy">Geirfa</span> <span class="gl-en" lang="en">· Glossary</span> <span class="gl-count">${sorted.length}</span></h2>
      <dl class="gl-list">
        ${rows.join('\n        ')}
      </dl>
    </section>`;
  }

  return { esc, cap, chapterLabel, TAGS, renderInline, plainInline, renderBody, levelBadge, typeBadge, typeLabel, entriesOf, fillTooltip, entryHtml, renderGlossary };
}));
