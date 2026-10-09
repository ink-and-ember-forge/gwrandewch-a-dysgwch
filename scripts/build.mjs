#!/usr/bin/env node
// Validates content/articles/*, renders each article to static HTML, writes
// dist/data/index.json and copies site assets. Node 20+, built-ins only.
// Exits non-zero on any error so a broken article can never be deployed.

import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync,
  statSync, cpSync, rmSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Parsing and metadata rules are shared with the linter so the two never disagree.
const {
  LEVELS, MAX_SEGMENT_CHARS, parseFrontmatter, parseInline, isHeading, validateMeta,
} = createRequire(import.meta.url)('../tools/lint-core.js');
const CONTENT = join(ROOT, 'content', 'articles');
const SITE = join(ROOT, 'site');
const DIST = join(ROOT, 'dist');

const SITE_TITLE = 'Gwrandewch a Dysgwch';
const SITE_TAGLINE = 'Welsh articles with audio, for learners: listen, read along, tap a word for its meaning.';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const IN_ACTIONS = !!process.env.GITHUB_ACTIONS;
const errors = [];
const warnings = [];
const report = (list, level, where, msg) => {
  list.push(`${where}: ${msg}`);
  if (IN_ACTIONS) console.log(`::${level} title=${where}::${msg}`);
};
const err = (where, msg) => report(errors, 'error', where, msg);
const warn = (where, msg) => report(warnings, 'warning', where, msg);

// ---------------------------------------------------------------- helpers

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Must stay in sync with fold() in site/js/util.js
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const readText = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');

function fill(tpl, vars, name) {
  return tpl.replace(/@@(!?)(\w+)@@/g, (_, raw, key) => {
    if (!(key in vars)) throw new Error(`${name}: placeholder @@${key}@@ has no value`);
    return raw ? vars[key] : esc(vars[key]);
  });
}

/** Duration in seconds of an MPEG audio (MP3) buffer, or null if unreadable. */
function mp3Duration(buf) {
  let p = 0;
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    p = 10 + (((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f));
  }
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let seconds = 0;
  let frames = 0;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff || (buf[p + 1] & 0xe0) !== 0xe0) { p++; continue; }
    const version = (buf[p + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (buf[p + 1] >> 1) & 3; // 1 = Layer III
    const brIdx = buf[p + 2] >> 4;
    const srIdx = (buf[p + 2] >> 2) & 3;
    const pad = (buf[p + 2] >> 1) & 1;
    if (version === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) { p++; continue; }
    const bitrate = (version === 3 ? BR1 : BR2)[brIdx] * 1000;
    const rate = SR[version][srIdx];
    const len = version === 3 ? Math.floor((144 * bitrate) / rate) + pad : Math.floor((72 * bitrate) / rate) + pad;
    seconds += (version === 3 ? 1152 : 576) / rate;
    frames++;
    p += len;
  }
  return frames >= 2 ? Math.round(seconds * 100) / 100 : null;
}

// ------------------------------------------------------------ parsing
// parseFrontmatter, parseInline and validateMeta live in tools/lint-core.js

const renderInline = (parts) => parts.map((p) => {
  if (p.text !== undefined) return esc(p.text);
  const note = p.note ? ` data-note="${esc(p.note)}"` : '';
  return `<span class="gloss" tabindex="0" data-tip="${esc(p.tip)}"${note}>${esc(p.surface)}</span>`;
}).join('');

const plainInline = (parts) => parts.map((p) => (p.text !== undefined ? p.text : p.surface)).join('');

/** Parse the one-line-one-sentence body into blocks. */
function parseBody(body, where) {
  const blocks = []; // {kind:'p-break'} | {kind:'h2', parts} | {kind:'seg', index, parts, raw}
  const problems = [];
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
  for (const p of problems) err(where, p);
  return { blocks, count: index };
}

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

// -------------------------------------------------------- article loading

function loadArticle(slug) {
  const dir = join(CONTENT, slug);
  const where = `content/articles/${slug}`;

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    err(where, 'folder name must be a lowercase ASCII slug (a-z, 0-9, hyphens, no diacritics)');
    return null;
  }
  const mdPath = join(dir, 'article.md');
  if (!existsSync(mdPath)) { err(where, 'article.md is missing'); return null; }

  const fm = parseFrontmatter(readText(mdPath));
  if (fm.error) { err(`${where}/article.md`, fm.error); return null; }
  const meta = fm.data;
  if (meta.draft === 'true') return { draft: true };

  const before = errors.length;
  const at = `${where}/article.md`;

  for (const p of fm.problems) err(at, `line ${p.line}: ${p.message}`);
  for (const v of validateMeta(meta)) (v.severity === 'error' ? err : warn)(at, v.message);
  const topics = Array.isArray(meta.topics) ? meta.topics.map((t) => t.toLowerCase()) : [];

  // audio
  const audioName = meta.audio || 'audio.mp3';
  let duration = null;
  if (/[\\/]/.test(audioName) || audioName.startsWith('.')) {
    // reported by validateMeta
  } else if (!existsSync(join(dir, audioName))) {
    err(at, `audio file "${audioName}" not found in the article folder`);
  } else {
    const buf = readFileSync(join(dir, audioName));
    if (buf.length > MAX_AUDIO_BYTES) warn(`${where}/${audioName}`, `audio is ${(buf.length / 1048576).toFixed(1)} MB (over 10 MB); consider re-encoding as mono 64 kbps MP3`);
    duration = /\.mp3$/i.test(audioName) ? mp3Duration(buf) : null;
  }

  // body
  const { blocks, count } = parseBody(fm.body, at);
  if (count === 0) err(at, 'article has no text segments');
  const segments = blocks.filter((b) => b.kind === 'seg');
  for (const s of segments) {
    if (s.raw.length > MAX_SEGMENT_CHARS) {
      warn(at, `segment ${s.index + 1} is ${s.raw.length} characters; hard-wrapped paragraph or merged sentences? "${s.raw.slice(0, 50)}…"`);
    }
  }
  const glosses = segments.flatMap((s) => s.parts).concat(blocks.filter((b) => b.kind === 'h2').flatMap((b) => b.parts))
    .filter((p) => p.surface && p.tip);
  if (!glosses.length) warn(at, 'no glosses ({{word|translation}}) in this article');

  // English
  let enLines = null;
  const enPath = join(dir, 'article.en.md');
  if (existsSync(enPath)) {
    enLines = readText(enPath).split('\n').map((l) => l.trim()).filter((l) => l && !isHeading(l));
    if (enLines.length !== count) {
      err(`${where}/article.en.md`, `has ${enLines.length} lines but article.md has ${count} segments (headings excluded)`);
    }
  }

  // timings
  let timings = null;
  const tPath = join(dir, 'timings.json');
  if (existsSync(tPath)) {
    const tw = `${where}/timings.json`;
    try {
      timings = JSON.parse(readFileSync(tPath, 'utf8'));
    } catch (e) {
      err(tw, `invalid JSON: ${e.message}`);
    }
    if (timings !== null) {
      if (!Array.isArray(timings) || !timings.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
        err(tw, 'must be an array of non-negative numbers (start time in seconds per segment)');
        timings = null;
      } else {
        if (timings.length !== count) err(tw, `has ${timings.length} entries but article.md has ${count} segments`);
        for (let i = 1; i < timings.length; i++) {
          if (timings[i] <= timings[i - 1]) { err(tw, `not strictly increasing at entry ${i + 1} (${timings[i - 1]} then ${timings[i]})`); break; }
        }
        if (duration !== null && timings.length && timings[timings.length - 1] > duration) {
          err(tw, `last start time ${timings[timings.length - 1]}s is after the end of the audio (${duration}s)`);
        }
      }
    }
  }

  if (errors.length > before) return null;

  const bodyText = segments.map((s) => plainInline(s.parts)).join(' ');
  return {
    slug,
    meta: {
      title: meta.title,
      title_en: meta.title_en || '',
      level: meta.level,
      topics,
      date: meta.date,
      summary: meta.summary,
      narrator: meta.narrator || '',
      dialect: meta.dialect || '',
      source: meta.source || '',
      licence: meta.licence || '',
    },
    audioName,
    duration,
    blocks,
    enLines,
    timings,
    glosses: glosses.map((g) => ({ surface: g.surface, tip: g.tip })),
    bodyText,
    enText: enLines ? enLines.join(' ') : '',
  };
}

// ------------------------------------------------------------- rendering

const levelBadge = (level) => {
  const rank = LEVELS.findIndex(([id]) => id === level) + 1;
  const dots = '●'.repeat(rank) + '○'.repeat(LEVELS.length - rank);
  const en = LEVELS[rank - 1][1];
  return `<span class="badge badge-level" data-level="${level}"><span class="dots" aria-hidden="true">${dots}</span> ${esc(cap(level))} <span class="badge-en" lang="en">${en}</span></span>`;
};

function renderArticle(a, tpl, prev, next) {
  const m = a.meta;
  const badges = [levelBadge(m.level)];
  if (m.dialect) badges.push(`<span class="badge badge-dialect">${esc(cap(m.dialect))} dialect</span>`);
  for (const t of m.topics) badges.push(`<span class="badge badge-topic">${esc(t)}</span>`);

  const credits = [];
  if (m.narrator) credits.push(`Narrated by ${esc(m.narrator)}`);
  if (m.source) credits.push(`Source: ${esc(m.source)}`);
  if (m.licence) credits.push(`Licence: ${esc(m.licence)}`);

  const link = (x, cls, label) => (x
    ? `<a class="${cls}" href="../${x.slug}/" rel="${cls === 'nav-prev' ? 'prev' : 'next'}"><span class="nav-label">${label}</span><span class="nav-title" lang="cy">${esc(x.meta.title)}</span></a>`
    : '<span></span>');

  return fill(tpl, {
    site_title: SITE_TITLE,
    title: m.title,
    summary: m.summary,
    audio: a.audioName,
    duration: a.duration ?? '',
    has_sync: a.timings ? 'true' : 'false',
    has_en: a.enLines ? 'true' : 'false',
    title_en_html: m.title_en ? `<p class="subtitle" lang="en">${esc(m.title_en)}</p>` : '',
    badges: badges.join('\n'),
    credits: credits.length ? `<p class="credits">${credits.join(' · ')}</p>` : '',
    hint: a.glosses.length ? '<p class="hint">Tap or hover a dotted word for its meaning.</p>' : '',
    body: renderBody(a.blocks, a.enLines),
    timings_script: a.timings ? `<script type="application/json" id="timings">${JSON.stringify(a.timings)}</script>` : '',
    prev_link: link(prev, 'nav-prev', '← Older'),
    next_link: link(next, 'nav-next', 'Newer →'),
  }, 'article.template.html');
}

// ------------------------------------------------------------------ main

function main() {
  if (!existsSync(CONTENT)) { console.error(`No content folder at ${CONTENT}`); process.exit(1); }

  const entries = readdirSync(CONTENT).filter((n) => !n.startsWith('.') && statSync(join(CONTENT, n)).isDirectory());
  const articles = [];
  let drafts = 0;
  for (const slug of entries.sort()) {
    const a = loadArticle(slug);
    if (a?.draft) drafts++;
    else if (a) articles.push(a);
  }

  // Consistency: the same surface form glossed differently across articles
  const seen = new Map(); // folded surface -> Map(lowercased tip -> Set(slug))
  for (const a of articles) {
    for (const g of a.glosses) {
      const key = fold(g.surface);
      if (!seen.has(key)) seen.set(key, new Map());
      const tips = seen.get(key);
      const tk = g.tip.toLowerCase();
      if (!tips.has(tk)) tips.set(tk, new Set());
      tips.get(tk).add(a.slug);
    }
  }
  for (const [surface, tips] of seen) {
    if (tips.size > 1) {
      const detail = [...tips].map(([t, slugs]) => `"${t}" (${[...slugs].join(', ')})`).join(' vs ');
      warn('glossary consistency', `"${surface}" is glossed differently: ${detail}`);
    }
  }

  console.log(`Found ${articles.length} article(s)${drafts ? `, ${drafts} draft(s) skipped` : ''}.`);
  for (const w of warnings) console.log(`WARN  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`ERROR ${e}`);
    console.error(`\nBuild failed: ${errors.length} error(s). Nothing was written.`);
    process.exit(1);
  }

  articles.sort((x, y) => y.meta.date.localeCompare(x.meta.date) || x.meta.title.localeCompare(y.meta.title, 'cy'));

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  writeFileSync(join(DIST, '.nojekyll'), '');

  // static assets (all referenced relatively)
  for (const dir of ['css', 'js']) cpSync(join(SITE, dir), join(DIST, dir), { recursive: true });
  if (existsSync(join(SITE, 'favicon.svg'))) cpSync(join(SITE, 'favicon.svg'), join(DIST, 'favicon.svg'));
  cpSync(join(ROOT, 'tools'), join(DIST, 'tools'), { recursive: true });

  // article pages + audio
  const tpl = readFileSync(join(SITE, 'article.template.html'), 'utf8');
  articles.forEach((a, i) => {
    const out = join(DIST, 'articles', a.slug);
    mkdirSync(out, { recursive: true });
    // list is newest-first: the next index is older, the previous index is newer
    const older = articles[i + 1] || null;
    const newer = articles[i - 1] || null;
    writeFileSync(join(out, 'index.html'), renderArticle(a, tpl, older, newer));
    cpSync(join(CONTENT, a.slug, a.audioName), join(out, a.audioName));
  });

  // search/filter index
  const index = articles.map((a) => ({
    slug: a.slug,
    title: a.meta.title,
    title_en: a.meta.title_en,
    level: a.meta.level,
    dialect: a.meta.dialect,
    topics: a.meta.topics,
    date: a.meta.date,
    summary: a.meta.summary,
    duration: a.duration,
    has_sync: !!a.timings,
    has_english: !!a.enLines,
    search: fold([a.meta.title, a.meta.title_en, a.meta.summary, a.meta.topics.join(' '), a.bodyText, a.enText].join(' ')),
  }));
  mkdirSync(join(DIST, 'data'), { recursive: true });
  const json = JSON.stringify({ levels: LEVELS.map(([id, en]) => ({ id, en })), articles: index });
  writeFileSync(join(DIST, 'data', 'index.json'), json);
  if (json.length > 1_000_000) warn('data/index.json', `is ${(json.length / 1e6).toFixed(1)} MB; consider splitting search data`);

  // home page
  const list = articles.length
    ? `<ul>${articles.map((a) => `<li><a href="articles/${a.slug}/" lang="cy">${esc(a.meta.title)}</a>${a.meta.title_en ? ` <span lang="en">(${esc(a.meta.title_en)})</span>` : ''}</li>`).join('')}</ul>`
    : '<p>No articles yet.</p>';
  const home = fill(readFileSync(join(SITE, 'index.html'), 'utf8'), {
    site_title: SITE_TITLE,
    tagline: SITE_TAGLINE,
    noscript_list: list,
  }, 'index.html');
  writeFileSync(join(DIST, 'index.html'), home);

  console.log(`Built ${articles.length} article(s) into dist/.`);
}

main();
