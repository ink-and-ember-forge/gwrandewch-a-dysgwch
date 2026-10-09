/* Article format rules, shared by:
 *   - scripts/build.mjs   (parsing + metadata validation)
 *   - scripts/lint.mjs    (CLI report)
 *   - tools/check.html    (browser checker)
 * Plain UMD so it loads in Node (require) and in a browser via <script src>,
 * including from file://. No dependencies. Report-only: nothing here edits text.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArticleLint = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LEVELS = [
    ['mynediad', 'Entry'],
    ['sylfaen', 'Foundation'],
    ['canolradd', 'Intermediate'],
    ['uwch', 'Advanced'],
    ['hyfedredd', 'Proficiency'],
  ];
  const LEVEL_IDS = LEVELS.map((l) => l[0]);
  const DIALECTS = ['north', 'south', 'neutral'];
  const KNOWN_KEYS = ['title', 'title_en', 'level', 'topics', 'series', 'part', 'part_label', 'date', 'summary', 'audio', 'narrator', 'dialect', 'source', 'licence', 'draft'];
  // content/series/<slug>.md: the optional page for a series (a book, a course) whose chapters are articles
  const SERIES_KEYS = ['title', 'title_en', 'summary', 'author', 'publisher', 'edition', 'licence', 'url'];
  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const MAX_SEGMENT_CHARS = 250;

  // ------------------------------------------------------------ parsing

  /** Strip a BOM and normalise line endings. */
  const normalise = (text) => String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  const unquote = (v) => (v.length >= 2 && /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v);

  /**
   * Restricted YAML subset. Returns {error} if the --- block is missing,
   * otherwise {data, body, bodyLine, problems:[{line, message}]}.
   * `line` is 1-based within the file; `bodyLine` is where the body starts.
   */
  function parseFrontmatter(text) {
    const m = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
    if (!m) return { error: 'the file must start with a frontmatter block delimited by --- lines' };
    const data = {};
    const problems = [];
    m[1].split('\n').forEach((line, k) => {
      const ln = k + 2;
      if (!line.trim() || line.trim().startsWith('#')) return;
      const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!kv) { problems.push({ line: ln, message: `frontmatter line is not "key: value": ${line}` }); return; }
      if (kv[1] in data) problems.push({ line: ln, message: `frontmatter field "${kv[1]}" appears more than once` });
      let v = kv[2].trim();
      if (v.startsWith('[')) {
        if (!v.endsWith(']')) { problems.push({ line: ln, message: `frontmatter "${kv[1]}": list is missing its closing ]` }); return; }
        v = v.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
      } else {
        v = unquote(v);
      }
      data[kv[1]] = v;
    });
    return { data, problems, body: text.slice(m[0].length), bodyLine: (m[0].match(/\n/g) || []).length + 1 };
  }

  // Word-type tags usable in a gloss entry: "tyrbin, tyrbinau, eg = turbine".
  // Welsh dictionary abbreviations are accepted as aliases of the English labels.
  const TAGS = {
    eg: 'eg', eb: 'eb', egb: 'egb',
    adj: 'adj', ans: 'adj',
    verb: 'verb', be: 'verb', bf: 'verb',
    prep: 'prep', ardd: 'prep',
    adv: 'adv', adf: 'adv',
    conj: 'conj', cys: 'conj',
    pron: 'pron', rhag: 'pron',
  };
  const GENDER_TAGS = ['eg', 'eb', 'egb'];

  /**
   * Parse one gloss entry field: "forms, ..., tag = english".
   * Returns {entry} or {error}. The tag is optional; the last comma-separated
   * Welsh part is only treated as a tag if it is a known one.
   */
  function parseEntry(field) {
    const eq = field.indexOf('=');
    const left = field.slice(0, eq).trim();
    const en = field.slice(eq + 1).trim();
    const cy = left.split(',').map((x) => x.trim()).filter(Boolean);
    let tag = null;
    if (cy.length && TAGS[cy[cy.length - 1].toLowerCase()]) tag = TAGS[cy.pop().toLowerCase()];
    if (!cy.length) return { error: `entry "${field}" has no Welsh word before the =` };
    if (!en) return { error: `entry "${field}" has nothing after the = (the English meaning)` };
    return { entry: { cy, tag, en } };
  }

  /**
   * Split one line into text and gloss parts; syntax problems are pushed to `problems`.
   * Every part carries `start`/`end`: its span in `line` (raw markup), which the
   * editor uses to wrap, replace and remove glosses without rewriting the rest.
   */
  function parseInline(line, problems) {
    const parts = [];
    let buf = '';
    let bufStart = 0;
    let i = 0;
    const add = (ch, at) => { if (buf === '') bufStart = at; buf += ch; };
    const flush = (at) => { if (buf) { parts.push({ text: buf, start: bufStart, end: at }); buf = ''; } };
    while (i < line.length) {
      if (line.startsWith('\\{{', i)) { add('{{', i); i += 3; continue; }
      if (line.startsWith('{{', i)) {
        const end = line.indexOf('}}', i + 2);
        if (end < 0) {
          problems.push(`unclosed "{{" in: ${line}`);
          add(line.slice(i), i);
          i = line.length;
          break;
        }
        const inner = line.slice(i + 2, end);
        if (inner.includes('{{')) problems.push(`nested "{{" inside a gloss: ${line}`);
        const f = inner.split('|').map((x) => x.trim());
        const surface = f[0] || '';
        const tip = f[1] || '';
        const entries = [];
        const notes = [];
        for (const extra of f.slice(2)) {
          if (!extra) continue;
          const nm = extra.match(/^note\s*:\s*(.*)$/i);
          if (nm) { if (nm[1]) notes.push(nm[1]); else problems.push(`gloss "${surface}": empty note:`); }
          else if (extra.includes('=')) {
            const r = parseEntry(extra);
            if (r.error) problems.push(`gloss "${surface}": ${r.error}`); else entries.push(r.entry);
          } else notes.push(extra);
        }
        const note = notes.join('\n');
        if (f.length < 2) problems.push(`gloss "{{${inner}}}" needs a translation: {{word|translation}}`);
        else if (!surface) problems.push(`gloss with empty surface text: {{${inner}}}`);
        else if (!tip) problems.push(`gloss "${surface}" has an empty translation`);
        flush(i);
        parts.push({ surface, tip, note, entries, start: i, end: end + 2 });
        i = end + 2;
        continue;
      }
      if (line.startsWith('}}', i)) { problems.push(`stray "}}" in: ${line}`); add('}}', i); i += 2; continue; }
      add(line[i], i);
      i++;
    }
    flush(i);
    return parts;
  }

  const plainText = (line) => parseInline(line, []).map((p) => (p.text !== undefined ? p.text : p.surface)).join('');
  const isHeading = (line) => line.startsWith('## ');

  /**
   * Parse the one-line-one-sentence body into blocks, shared by the build and the
   * editor preview: {kind:'break'} | {kind:'h2', parts} | {kind:'seg', index, parts, raw}.
   * Gloss syntax problems are pushed to `problems`.
   */
  function parseBlocks(body, problems) {
    const blocks = [];
    let index = 0;
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line) { blocks.push({ kind: 'break' }); continue; }
      if (isHeading(line)) {
        blocks.push({ kind: 'h2', parts: parseInline(line.slice(3).trim(), problems) });
        continue;
      }
      blocks.push({ kind: 'seg', index: index++, parts: parseInline(line, problems), raw: line });
    }
    return { blocks, count: index };
  }

  /** Frontmatter field validation shared with the build. Returns [{severity, message}]. */
  function validateMeta(meta) {
    const out = [];
    const bad = (message) => out.push({ severity: 'error', message });
    for (const key of Object.keys(meta)) {
      if (!KNOWN_KEYS.includes(key)) out.push({ severity: 'warn', message: `unknown frontmatter field "${key}"` });
    }
    for (const key of ['title', 'level', 'date', 'summary']) {
      if (!meta[key] || typeof meta[key] !== 'string') bad(`missing required frontmatter field "${key}"`);
    }
    if (typeof meta.level === 'string' && meta.level && !LEVEL_IDS.includes(meta.level)) {
      bad(`level "${meta.level}" is not one of: ${LEVEL_IDS.join(', ')}`);
    }
    if (typeof meta.date === 'string' && meta.date) {
      const d = new Date(`${meta.date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== meta.date) {
        bad(`date "${meta.date}" must be a real date as YYYY-MM-DD`);
      }
    }
    if (meta.dialect && !DIALECTS.includes(meta.dialect)) bad(`dialect must be one of: ${DIALECTS.join(', ')}`);
    if (meta.topics !== undefined) {
      if (!Array.isArray(meta.topics)) bad('topics must be a list, e.g. topics: [food, shopping]');
      else {
        for (const t of meta.topics) {
          if (t !== t.toLowerCase()) out.push({ severity: 'warn', message: `topic "${t}" will be lowercased` });
          if (!/^[a-z0-9-]+$/.test(t.toLowerCase())) bad(`topic "${t}" must be lowercase letters, digits or hyphens`);
        }
      }
    }
    if (meta.draft !== undefined && meta.draft !== 'true' && meta.draft !== 'false') {
      out.push({ severity: 'warn', message: `draft should be true or false (got "${meta.draft}"); only "true" hides the article` });
    }
    // series membership
    const hasSeries = meta.series !== undefined && meta.series !== '';
    const hasPart = meta.part !== undefined && meta.part !== '';
    if (hasSeries && (typeof meta.series !== 'string' || !SLUG_RE.test(meta.series))) {
      bad(`series "${meta.series}" must be lowercase letters, digits and hyphens, e.g. series: cymraeg-byw`);
    }
    if (hasPart && (typeof meta.part !== 'string' || !/^[1-9]\d{0,3}$/.test(meta.part))) {
      bad(`part "${meta.part}" must be a whole number from 1, the chapter's position in the series`);
    }
    if (hasSeries && !hasPart) bad('a chapter of a series needs a part number, e.g. part: 3');
    if (hasPart && !hasSeries) bad('part needs a series, e.g. series: cymraeg-byw');
    if (meta.part_label !== undefined && !hasSeries) {
      out.push({ severity: 'warn', message: 'part_label is only used when the article belongs to a series' });
    }
    if (typeof meta.audio === 'string' && (/[\\/]/.test(meta.audio) || meta.audio.startsWith('.'))) {
      bad(`audio "${meta.audio}" must be a plain filename inside the article folder`);
    }
    return out;
  }

  /** Validation for a series file's frontmatter (content/series/<slug>.md). Returns [{severity, message}]. */
  function validateSeriesMeta(meta) {
    const out = [];
    const bad = (message) => out.push({ severity: 'error', message });
    for (const key of Object.keys(meta)) {
      if (!SERIES_KEYS.includes(key)) out.push({ severity: 'warn', message: `unknown series field "${key}"` });
    }
    if (!meta.title || typeof meta.title !== 'string') bad('missing required field "title" (the series name shown to readers)');
    if (meta.url !== undefined && meta.url !== '' && !/^https?:\/\/\S+$/i.test(String(meta.url))) {
      bad(`url "${meta.url}" must start with http:// or https://`);
    }
    return out;
  }

  /**
   * Cross-article series checks, shared by the build and the linter.
   * chapters: [{slug, series, part, draft}] for every article folder (drafts included);
   * seriesFiles: slugs that have a content/series/<slug>.md. Returns [{severity, where, message}].
   */
  function checkSeriesSet(chapters, seriesFiles) {
    const out = [];
    const groups = new Map();
    for (const c of chapters) {
      if (!c.series) continue;
      if (!groups.has(c.series)) groups.set(c.series, []);
      groups.get(c.series).push(c);
    }
    const files = new Set(seriesFiles);
    for (const [slug, list] of groups) {
      const pub = list.filter((c) => !c.draft).sort((x, y) => x.part - y.part || x.slug.localeCompare(y.slug));
      for (let i = 1; i < pub.length; i++) {
        if (pub[i].part === pub[i - 1].part) {
          out.push({ severity: 'error', where: `content/articles/${pub[i].slug}/article.md`, message: `part ${pub[i].part} of series "${slug}" is also used by "${pub[i - 1].slug}"; each chapter needs its own part number` });
        }
      }
      if (pub.length) {
        const have = new Set(pub.map((c) => c.part));
        const draftParts = list.filter((c) => c.draft).map((c) => c.part);
        const missing = [];
        for (let n = pub[0].part; n <= pub[pub.length - 1].part; n++) if (!have.has(n)) missing.push(n);
        if (missing.length) {
          const drafted = missing.filter((n) => draftParts.includes(n));
          out.push({ severity: 'warn', where: `series "${slug}"`, message: `no chapter for part ${missing.join(', ')}${drafted.length ? ` (part ${drafted.join(', ')} ${drafted.length === 1 ? 'is a draft' : 'are drafts'})` : ''}; readers will see the gap` });
        }
        if (pub.length === 1 && !files.has(slug)) {
          out.push({ severity: 'warn', where: `series "${slug}"`, message: `has a single chapter ("${pub[0].slug}") and no content/series/${slug}.md; a typo in "series:"?` });
        }
      }
    }
    for (const slug of files) {
      const hasPublished = (groups.get(slug) || []).some((c) => !c.draft);
      if (!hasPublished) {
        out.push({ severity: 'warn', where: `content/series/${slug}.md`, message: `no published chapter belongs to this series; chapters need "series: ${slug}" and a "part:" in their frontmatter` });
      }
    }
    return out;
  }

  /** Walk a body into rows: blank / heading / seg (with segment index and paragraph number). */
  function scanBody(body, firstLine) {
    const rows = [];
    let seg = 0;
    let para = -1;
    let pending = true;
    body.split('\n').forEach((raw, k) => {
      const n = firstLine + k;
      const t = raw.trim();
      if (!t) { rows.push({ n, raw, kind: 'blank' }); pending = true; return; }
      if (isHeading(t)) { rows.push({ n, raw, kind: 'heading', text: t.slice(3).trim(), before: seg }); pending = true; return; }
      if (pending) { para++; pending = false; }
      rows.push({ n, raw, kind: 'seg', text: t, index: seg++, para });
    });
    return rows;
  }

  // ----------------------------------------------------------- the linter

  const SEVERITY_RANK = { error: 0, warn: 1, info: 2 };
  const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'prof', 'rev', 'etc', 'vs', 'cf', 'no', 'tt']);
  const TERMINAL = /[.!?…:;"”’')\]]$/;

  function analyse(input) {
    const issues = [];
    const add = (file, line, severity, rule, message) => issues.push({ file, line, severity, rule, message });
    const MD = 'article.md';
    const EN = 'article.en.md';

    const mdText = normalise(input.md || '');
    const hasEn = typeof input.en === 'string' && input.en.trim() !== '';
    const enText = hasEn ? normalise(input.en) : '';
    const result = { issues, meta: null, cy: null, en: null, counts: { cy: 0, en: 0 }, hasEnglish: hasEn };

    if (input.md && /^﻿/.test(input.md)) add(MD, 1, 'info', 'bom', 'File starts with a byte-order mark (BOM); harmless, but your editor may be adding it.');
    if (/\r/.test(input.md || '')) add(MD, 1, 'info', 'crlf', 'Windows (CRLF) line endings; the build normalises these, but LF is cleaner in git.');
    if (hasEn && /\r/.test(input.en)) add(EN, 1, 'info', 'crlf', 'Windows (CRLF) line endings; the build normalises these, but LF is cleaner in git.');

    // ---- Welsh file: frontmatter
    const fm = parseFrontmatter(mdText);
    let cyRows = null;
    if (fm.error) {
      add(MD, 1, 'error', 'frontmatter', fm.error);
    } else {
      result.meta = fm.data;
      for (const p of fm.problems) add(MD, p.line, 'error', 'frontmatter', p.message);
      for (const v of validateMeta(fm.data)) add(MD, 1, v.severity, 'frontmatter', v.message);
      cyRows = scanBody(fm.body, fm.bodyLine);
    }

    // ---- English file: must not have frontmatter
    let enRows = null;
    if (hasEn) {
      if (/^---[ \t]*\n/.test(enText)) {
        add(EN, 1, 'error', 'frontmatter-in-english', 'article.en.md must not have frontmatter: the --- lines and fields would be counted as sentences. Remove the --- block.');
      }
      enRows = scanBody(enText, 1);
    }

    const segsOf = (rows) => (rows ? rows.filter((r) => r.kind === 'seg').map((r) => ({ ...r, line: r.n })) : []);
    const cySegs = segsOf(cyRows);
    const enSegs = segsOf(enRows);
    result.counts = { cy: cySegs.length, en: enSegs.length };

    // ---- per-file line checks
    function checkFile(file, rows, lang) {
      if (!rows) return;
      const apos = { straight: [], curly: [] };
      const dq = { straight: [], curly: [] };
      const ell = { dots: [], char: [] };
      let blankRun = 0;

      rows.forEach((row, k) => {
        if (row.kind === 'blank') {
          blankRun++;
          if (blankRun === 2 && k < rows.length - 1) add(file, row.n, 'warn', 'blank-run', 'More than one blank line in a row; a single blank line already starts a new paragraph.');
          if (row.raw.length) add(file, row.n, 'warn', 'trailing-space', 'Blank line contains spaces or tabs.');
          return;
        }
        blankRun = 0;
        const raw = row.raw;
        const text = row.kind === 'seg' ? row.text : `## ${row.text}`;
        const at = (sev, rule, msg) => add(file, row.n, sev, rule, msg);

        // whitespace
        if (/\t/.test(raw)) at('warn', 'tab', 'Contains a tab character.');
        if (/[ \t]+$/.test(raw)) at('warn', 'trailing-space', 'Trailing whitespace at the end of the line.');
        if (/^[ \t]+\S/.test(raw)) at('warn', 'leading-space', 'Line is indented; indentation is ignored but usually means a paste or list went wrong.');
        if (/\S {2,}\S/.test(raw)) at('warn', 'double-space', 'Two or more spaces in a row inside the line.');
        if (/ | | /.test(raw)) at('warn', 'nbsp', 'Contains a non-breaking space (U+00A0); use a normal space.');
        if (/[​-‍⁠﻿]/.test(raw)) at('error', 'invisible-char', 'Contains an invisible zero-width character; delete and retype around it.');
        if (raw !== raw.normalize('NFC')) at('warn', 'unicode-nfc', 'Accented letters are stored in decomposed form (letter + combining mark); re-type them or normalise to NFC.');

        // punctuation spacing (Welsh and English both use no space before , ; : ! ?)
        if (/\S +[,;:!?](?=\s|$|["”’')\]])/.test(raw)) at('warn', 'space-before-punct', 'Space before , ; : ! or ? (no French-style spacing).');
        if (/[^\s.] +\.(?=\s|$)/.test(raw)) at('warn', 'space-before-punct', 'Space before a full stop.');
        if (/[,;][\p{L}]/u.test(raw)) at('warn', 'missing-space', 'Missing space after a comma or semicolon.');
        if (/[:!?][\p{L}]/u.test(raw) && !/https?:\/\//.test(raw)) at('warn', 'missing-space', 'Missing space after : ! or ?');
        if (/--/.test(raw)) at('warn', 'dash', 'Double hyphen; use an en dash (–) or em dash (—).');
        else if (/ - /.test(raw)) at('info', 'dash', 'Spaced hyphen used as a dash; an en dash (–) is typographically correct.');

        // consistency tallies
        if (/'/.test(raw)) apos.straight.push(row.n);
        if (/’/.test(raw)) apos.curly.push(row.n);
        if (/"/.test(raw)) dq.straight.push(row.n);
        if (/[“”]/.test(raw)) dq.curly.push(row.n);
        if (/\.\.\./.test(raw)) ell.dots.push(row.n);
        if (/…/.test(raw)) ell.char.push(row.n);

        // markdown that this site does not render
        if (row.kind === 'seg') {
          const t = row.text;
          if (/^#{1,6}$/.test(t)) at('warn', 'heading', 'Empty heading marker; it would become a timed sentence.');
          else if (/^##\S/.test(t)) at('warn', 'heading', 'Heading needs a space after ##; as written it is a timed sentence.');
          else if (/^#\s/.test(t) || /^#{3,6}\s/.test(t)) at('warn', 'heading', 'Only "## " subheadings are supported; this line would be a timed sentence showing the # characters.');
          else if (/^([-*+•]|\d+[.)])\s+/.test(t)) at('warn', 'markdown-list', 'Looks like a list item; markdown lists are not rendered and the marker will show in the text.');
          else if (/^>\s?/.test(t)) at('warn', 'markdown-quote', 'Blockquote marker ">" is not rendered.');
          else if (/^(-{3,}|\*{3,}|_{3,}|={3,})$/.test(t)) at('warn', 'markdown-rule', 'A horizontal rule becomes a timed sentence; remove it.');
          if (/\*\*[^*]+\*\*|__[^_]+__|(?<![\w*])\*[^*\s][^*]*\*(?!\w)|(?<![\w_])_[^_\s][^_]*_(?![\w_])/.test(t)) at('warn', 'markdown-emphasis', 'Markdown bold/italic markers are not rendered; they would show as * or _.');
          if (/`/.test(t)) at('warn', 'markdown-code', 'Backticks are not rendered.');
          if (/\[[^\]]+\]\([^)]+\)/.test(t)) at('warn', 'markdown-link', 'Markdown links are not rendered.');
          if (/<\/?[a-zA-Z][^>]*>/.test(t)) at('warn', 'markdown-html', 'HTML tags are escaped and shown literally.');

          // structure
          const plain = plainText(t);
          if (plain.length > MAX_SEGMENT_CHARS) at('warn', 'long-line', `Line is ${plain.length} characters; probably several sentences or a hard-wrapped paragraph.`);
          const next = rows[k + 1];
          if (next && next.kind === 'seg' && !TERMINAL.test(plain.trim()) && /^[\p{Ll}]/u.test(plainText(next.text))) {
            at('warn', 'hard-wrap', `Line ends without punctuation and the next line starts lowercase; was one sentence hard-wrapped over lines ${row.n}-${next.n}?`);
          }
          const re = /([.!?…])["”’')]?\s+(?=["“‘]?\p{Lu})/gu;
          let m;
          while ((m = re.exec(plain))) {
            const before = (plain.slice(0, m.index).match(/(\p{L}+)$/u) || [])[1] || '';
            if (m[1] === '.' && (/^\p{Lu}$/u.test(before) || ABBREVIATIONS.has(before.toLowerCase()))) continue;
            at('info', 'multi-sentence', 'More than one sentence on this line; each line should be a single sentence so audio and English line up.');
            break;
          }
          if (lang === 'cy' && /\{\{/.test(row.raw)) {
            const problems = [];
            const parts = parseInline(row.text, problems);
            for (const p of problems) at('error', 'gloss', p);
            for (const g of parts.filter((x) => x.entries)) {
              for (const e of g.entries) {
                if (/\((m|f|eg|eb|egb)\)/i.test(e.en)) at('warn', 'gloss-entry', `Gloss "${g.surface}": remove the typed (m)/(f)/(eg)/(eb) from "${e.en}"; the gender tag is added from the Welsh tag automatically.`);
                if (GENDER_TAGS.includes(e.tag) && e.cy.length > 2) at('info', 'gloss-entry', `Gloss "${g.surface}": "${e.cy.join(', ')}" has more than two forms; expected "singular, plural, tag".`);
              }
            }
          }
          if (lang === 'en' && /\{\{/.test(row.raw)) at('warn', 'gloss-in-english', 'Glosses ({{word|meaning}}) belong in article.md; here the braces would be shown literally.');
        } else if (!row.text) {
          add(file, row.n, 'warn', 'heading', 'Empty heading.');
        }
      });

      const mixed = (a, b, rule, label, nameA, nameB) => {
        if (!a.length || !b.length) return;
        const minority = a.length > b.length ? b : a;
        const [majName, minName] = a.length > b.length ? [nameA, nameB] : [nameB, nameA];
        for (const n of minority) add(file, n, 'warn', rule, `Mixed ${label}: this line uses ${minName} but most of the file uses ${majName} (${a.length} lines with ${nameA}, ${b.length} with ${nameB}).`);
      };
      mixed(apos.straight, apos.curly, 'apostrophe-mixed', 'apostrophes', "straight (')", 'curly (’)');
      mixed(dq.straight, dq.curly, 'quote-mixed', 'quote marks', 'straight (")', 'curly (“ ”)');
      mixed(ell.dots, ell.char, 'ellipsis-mixed', 'ellipses', 'three dots (...)', 'the … character');
      return { apos, dq };
    }

    const cyStats = checkFile(MD, cyRows, 'cy');
    const enStats = checkFile(EN, enRows, 'en');
    if (cyStats && enStats) {
      const kind = (s) => (s.apos.straight.length && !s.apos.curly.length ? 'straight' : s.apos.curly.length && !s.apos.straight.length ? 'curly' : null);
      if (kind(cyStats) && kind(enStats) && kind(cyStats) !== kind(enStats)) {
        add(EN, 1, 'info', 'apostrophe-style', `Welsh uses ${kind(cyStats)} apostrophes but English uses ${kind(enStats)}; pick one style for both files.`);
      }
    }

    if (cyRows && !cySegs.length) add(MD, fm.bodyLine, 'error', 'empty', 'The article has no text sentences.');
    if (!cyRows && fm.error) { /* nothing more to analyse */ }

    // ---- Welsh <-> English alignment
    const headingsOf = (rows) => (rows || []).filter((r) => r.kind === 'heading').map((r) => ({ line: r.n, text: r.text, beforeIndex: r.before }));
    result.cy = { segs: cySegs.map((r) => ({ index: r.index, line: r.n, text: r.text, para: r.para })), headings: headingsOf(cyRows) };
    result.en = hasEn ? { segs: enSegs.map((r) => ({ index: r.index, line: r.n, text: r.text, para: r.para })), headings: headingsOf(enRows) } : null;

    if (hasEn && cyRows) {
      const nCy = cySegs.length;
      const nEn = enSegs.length;
      const ratioOf = (i) => {
        const a = plainText(cySegs[i].text).length;
        const b = enSegs[i].text.length;
        return a >= 20 && b >= 20 ? a / b : null;
      };
      const termClass = (s) => (((s.match(/[.!?…]["”’')]*$/) || [''])[0]).replace(/["”’')]/g, '') || '-');
      let suspect = -1;
      for (let i = 0; i < Math.min(nCy, nEn); i++) {
        const r = ratioOf(i);
        const cyEnd = termClass(plainText(cySegs[i].text));
        const enEnd = termClass(enSegs[i].text);
        const questionMismatch = (cyEnd === '?') !== (enEnd === '?');
        if (suspect < 0 && (questionMismatch || (r !== null && (r < 0.4 || r > 2.6)))) suspect = i;
      }
      if (nCy !== nEn) {
        const diff = nCy - nEn;
        const hint = suspect >= 0 ? ` Lines probably stop matching around sentence ${suspect + 1} (Welsh line ${cySegs[suspect].line}, English line ${enSegs[suspect].line}).` : '';
        add(EN, enSegs.length ? enSegs[Math.min(suspect >= 0 ? suspect : nEn - 1, nEn - 1)].line : 1, 'error', 'count-mismatch',
          `English has ${nEn} sentence line${nEn === 1 ? '' : 's'} but Welsh has ${nCy} (${diff > 0 ? `${diff} missing from English` : `${-diff} extra in English`}).${hint} Each Welsh line needs exactly one English line.`);
        if (suspect >= 0) add(MD, cySegs[suspect].line, 'info', 'count-mismatch', `Alignment hint: sentence ${suspect + 1} may be where the two files drift apart.`);
      } else {
        for (let i = 0; i < nCy; i++) {
          const r = ratioOf(i);
          const cyEnd = termClass(plainText(cySegs[i].text));
          const enEnd = termClass(enSegs[i].text);
          if ((cyEnd === '?') !== (enEnd === '?')) {
            add(EN, enSegs[i].line, 'warn', 'alignment', `Sentence ${i + 1}: one side is a question and the other is not; are these the same sentence?`);
          } else if (r !== null && (r < 0.4 || r > 2.6)) {
            add(EN, enSegs[i].line, 'warn', 'length-ratio', `Sentence ${i + 1}: the Welsh line is ${r.toFixed(1)}× the length of the English; check these two lines translate each other (a merged or split line shifts everything after it).`);
          }
        }
      }

      // paragraph structure and headings should mirror each other
      // (skipped when the counts differ: the pairs are misaligned and the noise would bury the real error)
      const lim = nCy === nEn ? nCy : 0;
      let shown = 0;
      for (let i = 1; i < lim && shown < 3; i++) {
        const cyBreak = cySegs[i].para !== cySegs[i - 1].para;
        const enBreak = enSegs[i].para !== enSegs[i - 1].para;
        if (cyBreak !== enBreak) {
          add(EN, enSegs[i].line, 'warn', 'paragraph-mismatch', `Paragraph break ${cyBreak ? 'is in the Welsh before' : 'is missing in the Welsh before'} sentence ${i + 1}; ${cyBreak ? 'add a blank line here' : 'remove the blank line here'} to match.`);
          shown++;
        }
      }
      const cyH = result.cy.headings;
      const enH = result.en.headings;
      if (cyH.length !== enH.length) {
        add(EN, 1, 'warn', 'heading-mismatch', `Welsh has ${cyH.length} "## " heading(s) but English has ${enH.length}. Headings are not counted as sentences, but they should line up.`);
      } else {
        cyH.forEach((h, i) => {
          if (h.beforeIndex !== enH[i].beforeIndex) add(EN, enH[i].line, 'warn', 'heading-mismatch', `Heading ${i + 1} sits before sentence ${enH[i].beforeIndex + 1} in English but before sentence ${h.beforeIndex + 1} in Welsh.`);
        });
      }
    }

    // end-of-file newline
    if (input.md && !/\n$/.test(mdText)) add(MD, mdText.split('\n').length, 'info', 'eof-newline', 'File does not end with a newline.');
    if (hasEn && !/\n$/.test(enText)) add(EN, enText.split('\n').length, 'info', 'eof-newline', 'File does not end with a newline.');

    issues.sort((a, b) => (a.file === b.file ? 0 : a.file === MD ? -1 : 1)
      || a.line - b.line || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    return result;
  }

  return {
    LEVELS, LEVEL_IDS, DIALECTS, KNOWN_KEYS, SERIES_KEYS, SLUG_RE, MAX_SEGMENT_CHARS, TAGS, GENDER_TAGS,
    normalise, parseFrontmatter, parseEntry, parseInline, parseBlocks, plainText, isHeading, validateMeta, validateSeriesMeta, checkSeriesSet, scanBody, analyse,
  };
}));
