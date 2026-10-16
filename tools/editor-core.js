/* Pure logic behind tools/editor.html (no DOM), so it can be unit tested.
 *   - article <-> rows: parse article.md / article.en.md into sentence pairs, and back
 *   - gloss (tooltip) editing on raw markup: wrap a selection, replace, remove
 *   - sentence splitting for pasted text, slugs, and a minimal zip writer
 * Plain UMD. In a browser, load lint-core.js first.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./lint-core.js'));
  else root.EditorCore = factory(root.ArticleLint);
}(typeof self !== 'undefined' ? self : this, function (lint) {
  'use strict';

  const META_ORDER = ['title', 'title_en', 'level', 'type', 'topics', 'series', 'part', 'part_label', 'date', 'summary', 'audio', 'narrator', 'dialect', 'source', 'licence', 'draft'];
  const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'prof', 'rev', 'etc', 'vs', 'cf', 'no']);

  const oneLine = (s) => String(s == null ? '' : s).replace(/\s*\n\s*/g, ' ').trim();

  // ---------------------------------------------------------------- basics

  function slugify(text) {
    const slug = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (slug.length <= 60) return slug;
    const cut = slug.slice(0, 60);
    return cut.slice(0, Math.max(cut.lastIndexOf('-'), 20)).replace(/-+$/, '');
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function newMeta() {
    return {
      title: '', title_en: '', level: '', type: '', topics: [], series: '', part: '', part_label: '', date: today(), summary: '', audio: 'audio.mp3',
      narrator: '', dialect: '', source: '', licence: '', draft: false, extra: {},
    };
  }

  const newItem = (kind) => ({ kind: kind || 'seg', cy: '', en: '', breakBefore: false });

  // ------------------------------------------------------ article <-> rows

  /** Parse article.md (+ optional article.en.md) into {meta, items, problems}. */
  function parseArticle(input) {
    const mdText = lint.normalise(input.md || '');
    const problems = [];
    const meta = newMeta();
    meta.date = '';
    let body = mdText;
    if (/^---[ \t]*\n/.test(mdText)) {
      const fm = lint.parseFrontmatter(mdText);
      if (fm.error) {
        problems.push(fm.error);
      } else {
        for (const p of fm.problems) problems.push(`line ${p.line}: ${p.message}`);
        for (const [k, v] of Object.entries(fm.data)) {
          if (k === 'topics') meta.topics = Array.isArray(v) ? v : [v];
          else if (k === 'draft') meta.draft = v === 'true';
          else if (META_ORDER.includes(k)) meta[k] = Array.isArray(v) ? v.join(', ') : v;
          else meta.extra[k] = v;
        }
        body = fm.body;
      }
    }

    const cyRows = lint.scanBody(body, 1);
    const cySegs = cyRows.filter((r) => r.kind === 'seg');

    let enSegs = [];
    let enHeads = [];
    if (input.en && input.en.trim()) {
      let enBody = lint.normalise(input.en);
      if (/^---[ \t]*\n/.test(enBody)) {
        const efm = lint.parseFrontmatter(enBody);
        if (!efm.error) { enBody = efm.body; problems.push('article.en.md had frontmatter; it was ignored (the English file must not have any).'); }
      }
      const enRows = lint.scanBody(enBody, 1);
      enSegs = enRows.filter((r) => r.kind === 'seg');
      enHeads = enRows.filter((r) => r.kind === 'heading');
    }

    const items = [];
    let headIndex = 0;
    let prev = null;
    for (const r of cyRows) {
      if (r.kind === 'heading') {
        items.push({ kind: 'heading', cy: r.text, en: enHeads[headIndex] ? enHeads[headIndex].text : '', breakBefore: false });
        headIndex++;
        prev = 'heading';
      } else if (r.kind === 'seg') {
        const brk = prev === 'seg' && cySegs[r.index - 1] && cySegs[r.index - 1].para !== r.para;
        items.push({ kind: 'seg', cy: r.text, en: enSegs[r.index] ? enSegs[r.index].text : '', breakBefore: !!brk });
        prev = 'seg';
      }
    }
    for (let i = cySegs.length; i < enSegs.length; i++) items.push({ kind: 'seg', cy: '', en: enSegs[i].text, breakBefore: false });
    if (!items.length) items.push(newItem());
    return { meta, items, problems };
  }

  function frontmatterLines(meta) {
    const lines = ['---'];
    const put = (k, v) => { if (v !== '' && v != null) lines.push(`${k}: ${oneLine(v)}`); };
    for (const k of META_ORDER) {
      if (k === 'topics') { if (meta.topics && meta.topics.length) lines.push(`topics: [${meta.topics.join(', ')}]`); }
      else if (k === 'draft') { if (meta.draft) lines.push('draft: true'); }
      else if (k === 'audio') put('audio', meta.audio || 'audio.mp3');
      else put(k, meta[k]);
    }
    for (const [k, v] of Object.entries(meta.extra || {})) put(k, Array.isArray(v) ? `[${v.join(', ')}]` : v);
    lines.push('---');
    return lines;
  }

  function bodyLines(items, pick) {
    const lines = [];
    const map = [];
    let prev = null;
    const push = (text, idx) => { lines.push(text); map.push(idx); };
    items.forEach((it, i) => {
      const text = oneLine(pick(it));
      if (!text) return;
      if (it.kind === 'heading') {
        if (lines.length && lines[lines.length - 1] !== '') push('', null);
        push(`## ${text}`, i);
        push('', null);
        prev = 'heading';
      } else {
        if (it.breakBefore && prev === 'seg' && lines.length && lines[lines.length - 1] !== '') push('', null);
        push(text, i);
        prev = 'seg';
      }
    });
    while (lines.length && lines[lines.length - 1] === '') { lines.pop(); map.pop(); }
    return { lines, map };
  }

  /**
   * Rows to files. `mdMap[n]` / `enMap[n]` give the item index for 1-based file
   * line n (undefined for blank/frontmatter lines), so lint issues map back to rows.
   */
  function serialize(meta, items, opts) {
    const fm = frontmatterLines(meta);
    const cy = bodyLines(items, (it) => it.cy);
    const mdLines = [...fm, '', ...cy.lines];
    const mdMap = [];
    cy.map.forEach((idx, k) => { if (idx !== null) mdMap[fm.length + 2 + k] = idx; });
    const wantEn = !opts || opts.includeEnglish !== false;
    let en = null;
    let enMap = [];
    if (wantEn && items.some((it) => it.kind === 'seg' && oneLine(it.en))) {
      const e = bodyLines(items, (it) => it.en);
      en = `${e.lines.join('\n')}\n`;
      e.map.forEach((idx, k) => { if (idx !== null) enMap[k + 1] = idx; });
    }
    return { md: `${mdLines.join('\n')}\n`, en, mdMap, enMap, bodyStartLine: fm.length + 2 };
  }

  // -------------------------------------------------------- pasted text

  function splitSentences(text) {
    const t = String(text).trim();
    const re = /([.!?…]+["”’')\]]*)(\s+)(?=["“‘'(\[]?\p{Lu})/gu;
    const pieces = [];
    let last = 0;
    let m;
    while ((m = re.exec(t))) {
      if (m[1] === '.') {
        const w = (t.slice(last, m.index).match(/(\p{L}+)$/u) || [])[1] || '';
        if (/^\p{Lu}$/u.test(w) || ABBREVIATIONS.has(w.toLowerCase())) continue; // initials and abbreviations, not short Welsh words like "fi" or "un"
      }
      pieces.push(t.slice(last, m.index + m[1].length).trim());
      last = m.index + m[0].length;
    }
    pieces.push(t.slice(last).trim());
    return pieces.filter(Boolean);
  }

  /**
   * Turn pasted text into items. mode 'lines': every non-blank line is one sentence.
   * mode 'sentences': lines of a paragraph are joined, then split into sentences.
   * A blank line starts a new paragraph; "## " lines become headings.
   */
  function splitText(text, mode) {
    const items = [];
    let pendingBreak = false;
    let para = [];
    const flushPara = () => {
      if (!para.length) return;
      const joined = para.join(' ');
      const pieces = mode === 'lines' ? para : splitSentences(joined);
      pieces.forEach((p, k) => items.push({ kind: 'seg', cy: p, en: '', breakBefore: k === 0 && pendingBreak && items.length > 0 && items[items.length - 1].kind === 'seg' }));
      para = [];
      pendingBreak = false;
    };
    for (const line of lint.normalise(text).split('\n')) {
      const t = line.trim();
      if (!t) { flushPara(); pendingBreak = true; continue; }
      if (lint.isHeading(t)) { flushPara(); items.push({ kind: 'heading', cy: t.slice(3).trim(), en: '', breakBefore: false }); pendingBreak = false; continue; }
      if (mode === 'lines') { para.push(t); flushPara(); } else para.push(t);
    }
    flushPara();
    return items;
  }

  // ------------------------------------------------------------- glosses

  const escText = (s) => s.replace(/\{\{/g, '\\{{');

  const formatEntry = (e) => `${e.cy.join(', ')}${e.tag ? `, ${e.tag}` : ''} = ${e.en}`;

  /** {surface, tip, entries:[{cy,tag,en}], notes:[string]} -> "{{...}}" */
  function formatGloss(g) {
    const fields = [g.surface, g.tip];
    for (const e of g.entries || []) fields.push(formatEntry(e));
    const notes = g.notes || (g.note ? g.note.split('\n') : []);
    for (const n of notes) if (n && n.trim()) fields.push(`note: ${n.trim()}`);
    return `{{${fields.join('|')}}}`;
  }

  /** Problems that would break a gloss; [] when it is fine to save. */
  function validateGloss(g) {
    const out = [];
    const bad = (s) => /\||\{\{|\}\}/.test(s);
    const check = (label, s) => { if (bad(s || '')) out.push(`${label} cannot contain | or {{ }}`); };
    if (!oneLine(g.surface)) out.push('Select some text first.');
    if (!oneLine(g.tip)) out.push('Add the translation (the bold top line).');
    check('The translation', g.tip);
    check('The text', g.surface);
    (g.entries || []).forEach((e, i) => {
      const n = i + 1;
      if (!e.cy.length || !e.cy.some(Boolean)) out.push(`Word ${n}: add the Welsh word.`);
      if (!oneLine(e.en)) out.push(`Word ${n}: add the English meaning.`);
      if (/\((m|f|eg|eb|egb)\)/i.test(e.en || '')) out.push(`Word ${n}: remove the typed (m)/(f); the tag is added from the Welsh tag.`);
      check(`Word ${n}`, `${e.cy.join(',')}${e.en}`);
      if (e.tag && !lint.TAGS[e.tag]) out.push(`Word ${n}: unknown tag "${e.tag}".`);
    });
    for (const n of g.notes || []) check('A note', n);
    return out;
  }

  /** All glosses in a row's raw markup, with plain-text and raw offsets. */
  function glossesOf(raw) {
    const parts = lint.parseInline(raw, []);
    const out = [];
    let plain = 0;
    for (const p of parts) {
      const len = p.text !== undefined ? p.text.length : p.surface.length;
      if (p.surface !== undefined) {
        out.push({
          index: out.length, plainStart: plain, plainEnd: plain + len, start: p.start, end: p.end,
          surface: p.surface, tip: p.tip, entries: p.entries || [], notes: p.note ? p.note.split('\n') : [],
        });
      }
      plain += len;
    }
    return out;
  }

  const plainOf = (raw) => lint.plainText(raw);

  /** Drop leading/trailing whitespace from a plain-text selection. */
  function trimRange(plain, s, e) {
    while (s < e && /\s/.test(plain[s])) s++;
    while (e > s && /\s/.test(plain[e - 1])) e--;
    return [s, e];
  }

  function rawIndexFor(raw, part, plainOff) {
    let r = part.start;
    let p = 0;
    while (p < plainOff && r < part.end) {
      if (raw.startsWith('\\{{', r)) { r += 3; p += 2; } else { r++; p++; }
    }
    return r;
  }

  /**
   * Wrap the plain-text range [s, e) of a row in a new gloss.
   * Returns {raw} on success, {edit: glossIndex} if the range lies inside an
   * existing gloss (edit that one instead), or {error}.
   */
  function wrapSelection(raw, s, e, gloss) {
    if (e <= s) return { error: 'Select some text first.' };
    const parts = lint.parseInline(raw, []);
    let plain = 0;
    let gi = 0;
    let target = null;
    for (const p of parts) {
      const len = p.text !== undefined ? p.text.length : p.surface.length;
      const a = plain;
      const b = plain + len;
      if (p.surface !== undefined) {
        if (s < b && e > a) {
          if (s >= a && e <= b) return { edit: gi };
          return { error: 'That selection overlaps an existing tooltip. Select plain text, or click the tooltip to edit it.' };
        }
        gi++;
      } else if (s >= a && e <= b) {
        target = { part: p, a };
      }
      plain = b;
    }
    if (!target) return { error: 'Select text that does not include an existing tooltip.' };
    const rs = rawIndexFor(raw, target.part, s - target.a);
    const re = rawIndexFor(raw, target.part, e - target.a);
    return { raw: raw.slice(0, rs) + formatGloss(gloss) + raw.slice(re) };
  }

  function replaceGloss(raw, glossIndex, gloss) {
    const g = glossesOf(raw)[glossIndex];
    return g ? raw.slice(0, g.start) + formatGloss(gloss) + raw.slice(g.end) : raw;
  }

  function removeGloss(raw, glossIndex) {
    const g = glossesOf(raw)[glossIndex];
    return g ? raw.slice(0, g.start) + escText(g.surface) + raw.slice(g.end) : raw;
  }

  // ---------------------------------------------------------- series file

  const newSeriesMeta = () => ({ title: '', title_en: '', summary: '', author: '', publisher: '', edition: '', licence: '', url: '' });

  /** content/series/<slug>.md text from the series form. */
  function seriesFileText(sm) {
    const lines = ['---'];
    for (const k of lint.SERIES_KEYS) if (oneLine(sm[k])) lines.push(`${k}: ${oneLine(sm[k])}`);
    lines.push('---');
    return `${lines.join('\n')}\n`;
  }

  /** Parse a series file into {meta, problems}. */
  function parseSeriesFile(text) {
    const fm = lint.parseFrontmatter(lint.normalise(text || ''));
    const meta = newSeriesMeta();
    if (fm.error) return { meta, problems: [fm.error] };
    for (const k of lint.SERIES_KEYS) if (typeof fm.data[k] === 'string') meta[k] = fm.data[k];
    return { meta, problems: fm.problems.map((p) => `line ${p.line}: ${p.message}`) };
  }

  // ------------------------------------------------------------------ zip

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** Minimal ZIP writer (stored, no compression). files: [{name, data: string|Uint8Array}] */
  function makeZip(files, when) {
    const enc = new TextEncoder();
    const d = when || new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const chunks = [];
    const central = [];
    let offset = 0;
    const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
    const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const local = Uint8Array.from([
        ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
      ]);
      chunks.push(local, name, data);
      central.push(Uint8Array.from([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ]), name);
      offset += local.length + name.length + data.length;
    }
    const cdSize = central.reduce((n, c) => n + c.length, 0);
    const end = Uint8Array.from([
      ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
      ...u32(cdSize), ...u32(offset), ...u16(0),
    ]);
    const all = [...chunks, ...central, end];
    const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
    let pos = 0;
    for (const c of all) { out.set(c, pos); pos += c.length; }
    return out;
  }

  return {
    META_ORDER, slugify, today, newMeta, newItem, parseArticle, serialize, frontmatterLines,
    splitSentences, splitText, newSeriesMeta, seriesFileText, parseSeriesFile,
    formatEntry, formatGloss, validateGloss, glossesOf, plainOf, trimRange, wrapSelection, replaceGloss, removeGloss,
    crc32, makeZip,
  };
}));
