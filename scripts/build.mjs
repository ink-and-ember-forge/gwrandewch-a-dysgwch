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

// GAD_ROOT lets the tests build a throwaway site; normally this is the repository root.
const ROOT = process.env.GAD_ROOT ? resolve(process.env.GAD_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Parsing and metadata rules are shared with the linter so the two never disagree.
const require = createRequire(import.meta.url);
const {
  LEVELS, TYPES, MAX_SEGMENT_CHARS, SLUG_RE, parseFrontmatter, parseBlocks, isHeading, validateMeta, validateSeriesMeta, checkSeriesSet,
} = require('../tools/lint-core.js');
const {
  esc, cap, chapterLabel, renderInline, plainInline, renderBody, levelBadge, typeBadge, typeLabel,
} = require('../tools/render-core.js');
const CONTENT = join(ROOT, 'content', 'articles');
const CONTENT_SERIES = join(ROOT, 'content', 'series');
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

// Must stay in sync with fold() in site/js/util.js
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

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

/** Parse the body into blocks, reporting gloss syntax problems as build errors. */
function parseBody(body, where) {
  const problems = [];
  const parsed = parseBlocks(body, problems);
  for (const p of problems) err(where, p);
  return parsed;
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
  if (meta.draft === 'true') return { draft: true, slug, series: meta.series || '', part: Number(meta.part) || 0 };

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
    const shown = plainInline(s.parts).length; // visible text, not gloss markup
    if (shown > MAX_SEGMENT_CHARS) {
      warn(at, `segment ${s.index + 1} is ${shown} characters; hard-wrapped paragraph or merged sentences? "${s.raw.slice(0, 50)}…"`);
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
      type: meta.type,
      topics,
      series: meta.series || '',
      part: meta.series ? Number(meta.part) : 0,
      part_label: meta.series ? (meta.part_label || '') : '',
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
    entries: glosses.flatMap((g) => g.entries || []),
    bodyText,
    enText: enLines ? enLines.join(' ') : '',
  };
}

// ---------------------------------------------------------------- series

const titleize = (slug) => cap(slug.replace(/-/g, ' '));
const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const SERIES_TEXT_KEYS = ['title', 'title_en', 'summary', 'author', 'publisher', 'edition', 'licence', 'url'];

/** content/series/<slug>.md: the optional page for a series. */
function loadSeriesFiles() {
  const found = new Map();
  if (!existsSync(CONTENT_SERIES)) return found;
  for (const name of readdirSync(CONTENT_SERIES).sort()) {
    if (name.startsWith('.') || !/\.md$/i.test(name)) continue;
    const slug = name.replace(/\.md$/i, '');
    const where = `content/series/${name}`;
    const before = errors.length;
    if (!SLUG_RE.test(slug)) { err(where, 'file name must be a lowercase ASCII slug (a-z, 0-9, hyphens), e.g. cymraeg-byw.md'); continue; }
    const fm = parseFrontmatter(readText(join(CONTENT_SERIES, name)));
    if (fm.error) { err(where, fm.error); continue; }
    for (const p of fm.problems) err(where, `line ${p.line}: ${p.message}`);
    for (const v of validateSeriesMeta(fm.data)) (v.severity === 'error' ? err : warn)(where, v.message);
    if (fm.body.trim()) warn(where, 'text below the frontmatter is not used; put the description in "summary"');
    if (errors.length > before) continue;
    const meta = {};
    for (const k of SERIES_TEXT_KEYS) meta[k] = fm.data[k] || '';
    found.set(slug, { slug, meta });
  }
  return found;
}

/** Group published chapters by series and attach series info (checks live in lint-core checkSeriesSet). */
function buildSeries(articles, drafts, files) {
  const chapters = [...articles.map((a) => ({ slug: a.slug, series: a.meta.series, part: a.meta.part })), ...drafts];
  for (const i of checkSeriesSet(chapters, files.keys())) (i.severity === 'error' ? err : warn)(i.where, i.message);

  const groups = new Map();
  for (const a of articles) {
    if (!a.meta.series) continue;
    if (!groups.has(a.meta.series)) groups.set(a.meta.series, { slug: a.meta.series, chapters: [] });
    groups.get(a.meta.series).chapters.push(a);
  }
  for (const g of groups.values()) {
    g.chapters.sort((x, y) => x.meta.part - y.meta.part || x.slug.localeCompare(y.slug));
    const file = files.get(g.slug);
    g.hasFile = !!file;
    g.meta = file ? file.meta : Object.fromEntries(SERIES_TEXT_KEYS.map((k) => [k, k === 'title' ? titleize(g.slug) : '']));
    g.levels = LEVELS.map(([id]) => id).filter((id) => g.chapters.some((c) => c.meta.level === id));
    g.topics = [...new Set(g.chapters.flatMap((c) => c.meta.topics))].sort();
    g.types = TYPES.map(([id]) => id).filter((id) => g.chapters.some((c) => c.meta.type === id));
    g.date = g.chapters.map((c) => c.meta.date).sort().pop();
    const durations = g.chapters.map((c) => c.duration).filter((d) => d != null);
    g.duration = durations.length ? Math.round(durations.reduce((x, y) => x + y, 0) * 100) / 100 : null;
  }
  return groups;
}

const chLabel = (a) => chapterLabel(a.meta.part, a.meta.part_label);

// ------------------------------------------------------------- rendering

function renderArticle(a, tpl, nav) {
  const m = a.meta;
  const badges = [typeBadge(m.type), levelBadge(m.level)];
  if (m.dialect) badges.push(`<span class="badge badge-dialect">${esc(cap(m.dialect))} dialect</span>`);
  for (const t of m.topics) badges.push(`<span class="badge badge-topic">${esc(t)}</span>`);

  const credits = [];
  if (m.narrator) credits.push(`Narrated by ${esc(m.narrator)}`);
  if (m.source) credits.push(`Source: ${esc(m.source)}`);
  if (m.licence) credits.push(`Licence: ${esc(m.licence)}`);

  const link = (x, cls, label) => (x
    ? `<a class="${cls}" href="../${x.slug}/" rel="${cls === 'nav-prev' ? 'prev' : 'next'}"><span class="nav-label">${label}</span><span class="nav-title" lang="cy">${esc(x.meta.title)}</span></a>`
    : '<span></span>');

  const g = nav.series;
  const seriesHref = g ? `../../series/${g.slug}/` : '';
  return fill(tpl, {
    site_title: SITE_TITLE,
    slug: a.slug,
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
    series_banner: g
      ? `<p class="series-banner"><a href="${seriesHref}">${esc(g.meta.title)}</a><span aria-hidden="true"> · </span><strong>${esc(chLabel(a))}</strong></p>`
      : '',
    series_tools: g
      ? `<a class="series-all" href="${seriesHref}">All ${g.chapters.length} chapter${g.chapters.length === 1 ? '' : 's'}</a>`
        + '<button type="button" class="toggle" id="mark-read" aria-pressed="false" hidden><span class="toggle-box" aria-hidden="true"></span> Mark as read</button>'
      : '',
    body: renderBody(a.blocks, a.enLines),
    timings_script: a.timings ? `<script type="application/json" id="timings">${JSON.stringify(a.timings)}</script>` : '',
    prev_link: link(nav.prev, 'nav-prev', g && nav.prev ? `← ${esc(chLabel(nav.prev))}` : '← Older'),
    next_link: link(nav.next, 'nav-next', g && nav.next ? `${esc(chLabel(nav.next))} →` : 'Newer →'),
  }, 'article.template.html');
}

function bookCredit(meta) {
  const bits = [];
  if (meta.author) bits.push(`By ${esc(meta.author)}`);
  const pub = [meta.publisher, meta.edition].filter(Boolean).map(esc).join(', ');
  if (pub) bits.push(`Published by ${pub}`);
  if (meta.licence) bits.push(`Licence: ${esc(meta.licence)}`);
  if (meta.url) bits.push(`<a href="${esc(meta.url)}" rel="noopener">About the book</a>`);
  return bits.length ? `<p class="credits">${bits.join(' · ')}</p>` : '';
}

function renderSeries(g, tpl) {
  const first = g.chapters[0];
  const items = g.chapters.map((c) => `<li data-slug="${c.slug}">
  <a class="ch-link" href="../../articles/${c.slug}/"><span class="ch-label">${esc(chLabel(c))}</span><span class="ch-title" lang="cy">${esc(c.meta.title)}</span>${c.meta.title_en ? `<span class="ch-en" lang="en">${esc(c.meta.title_en)}</span>` : ''}</a>
  <span class="ch-meta">${esc(typeLabel(c.meta.type))} · ${esc(cap(c.meta.level))}${c.duration ? ` · ${fmtTime(c.duration)}` : ''}</span>
  <span class="read-mark"></span>
</li>`).join('\n');
  const badges = g.types.map(typeBadge).concat(g.levels.map(levelBadge)).concat(g.topics.map((t) => `<span class="badge badge-topic">${esc(t)}</span>`));
  return fill(tpl, {
    site_title: SITE_TITLE,
    title: g.meta.title,
    summary: g.meta.summary || `${g.chapters.length} chapters`,
    title_en_html: g.meta.title_en ? `<p class="subtitle" lang="en">${esc(g.meta.title_en)}</p>` : '',
    summary_html: g.meta.summary ? `<p class="series-summary" lang="en">${esc(g.meta.summary)}</p>` : '',
    badges: badges.join('\n'),
    credit_html: bookCredit(g.meta),
    count_text: `${g.chapters.length} chapter${g.chapters.length === 1 ? '' : 's'}${g.duration ? ` · ${fmtTime(g.duration)} of audio` : ''}`,
    first_href: `../../articles/${first.slug}/`,
    first_label: `Start with ${chLabel(first)}`,
    chapters_html: items,
  }, 'series.template.html');
}

// ------------------------------------------------------------------ main

function main() {
  if (!existsSync(CONTENT)) { console.error(`No content folder at ${CONTENT}`); process.exit(1); }

  const entries = readdirSync(CONTENT).filter((n) => !n.startsWith('.') && statSync(join(CONTENT, n)).isDirectory());
  const articles = [];
  const draftChapters = []; // drafts that belong to a series (for the gap messages)
  let drafts = 0;
  for (const slug of entries.sort()) {
    const a = loadArticle(slug);
    if (a?.draft) {
      drafts++;
      if (a.series) draftChapters.push(a);
    } else if (a) articles.push(a);
  }

  const seriesFiles = loadSeriesFiles();
  const groups = buildSeries(articles, draftChapters, seriesFiles);

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

  // Consistency: the same headword tagged with different genders/types across articles
  const tagged = new Map(); // folded headword -> Map(tag -> Set(slug))
  for (const a of articles) {
    for (const e of a.entries) {
      if (!e.tag) continue;
      const key = fold(e.cy[0]);
      if (!tagged.has(key)) tagged.set(key, new Map());
      const tags = tagged.get(key);
      if (!tags.has(e.tag)) tags.set(e.tag, new Set());
      tags.get(e.tag).add(a.slug);
    }
  }
  for (const [word, tags] of tagged) {
    if (tags.size > 1) {
      const detail = [...tags].map(([t, slugs]) => `${t} (${[...slugs].join(', ')})`).join(' vs ');
      warn('glossary consistency', `"${word}" is tagged differently: ${detail}`);
    }
  }

  console.log(`Found ${articles.length} article(s)${groups.size ? ` in ${articles.filter((a) => !a.meta.series).length} standalone and ${groups.size} series` : ''}${drafts ? `, ${drafts} draft(s) skipped` : ''}.`);
  for (const w of warnings) console.log(`WARN  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`ERROR ${e}`);
    console.error(`\nBuild failed: ${errors.length} error(s). Nothing was written.`);
    process.exit(1);
  }

  articles.sort((x, y) => y.meta.date.localeCompare(x.meta.date) || x.meta.title.localeCompare(y.meta.title, 'cy'));
  const standalone = articles.filter((a) => !a.meta.series);

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  writeFileSync(join(DIST, '.nojekyll'), '');

  // static assets (all referenced relatively)
  for (const dir of ['css', 'js']) cpSync(join(SITE, dir), join(DIST, dir), { recursive: true });
  if (existsSync(join(SITE, 'favicon.svg'))) cpSync(join(SITE, 'favicon.svg'), join(DIST, 'favicon.svg'));
  cpSync(join(ROOT, 'tools'), join(DIST, 'tools'), { recursive: true });
  // the article page loads the shared render code as a classic script next to its other JS
  cpSync(join(ROOT, 'tools', 'render-core.js'), join(DIST, 'js', 'render-core.js'));

  // article pages + audio. Standalone articles link to older/newer standalone ones;
  // chapters link to the previous/next chapter of their series.
  const tpl = readFileSync(join(SITE, 'article.template.html'), 'utf8');
  for (const a of articles) {
    const out = join(DIST, 'articles', a.slug);
    mkdirSync(out, { recursive: true });
    let nav;
    if (a.meta.series) {
      const g = groups.get(a.meta.series);
      const i = g.chapters.indexOf(a);
      nav = { series: g, prev: g.chapters[i - 1] || null, next: g.chapters[i + 1] || null };
    } else {
      const i = standalone.indexOf(a); // newest first: the next index is older
      nav = { series: null, prev: standalone[i + 1] || null, next: standalone[i - 1] || null };
    }
    writeFileSync(join(out, 'index.html'), renderArticle(a, tpl, nav));
    cpSync(join(CONTENT, a.slug, a.audioName), join(out, a.audioName));
  }

  // series pages
  if (groups.size) {
    const stpl = readFileSync(join(SITE, 'series.template.html'), 'utf8');
    for (const g of groups.values()) {
      const out = join(DIST, 'series', g.slug);
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'index.html'), renderSeries(g, stpl));
    }
  }

  // search/filter index
  const index = articles.map((a) => {
    const g = a.meta.series ? groups.get(a.meta.series) : null;
    const seriesText = g ? [g.meta.title, g.meta.title_en, g.meta.summary, g.meta.author, g.meta.publisher, chLabel(a)] : [];
    return {
      slug: a.slug,
      title: a.meta.title,
      title_en: a.meta.title_en,
      level: a.meta.level,
      type: a.meta.type,
      dialect: a.meta.dialect,
      topics: a.meta.topics,
      series: a.meta.series,
      part: a.meta.part,
      label: g ? chLabel(a) : '',
      date: a.meta.date,
      summary: a.meta.summary,
      duration: a.duration,
      has_sync: !!a.timings,
      has_english: !!a.enLines,
      search: fold([a.meta.title, a.meta.title_en, a.meta.summary, typeLabel(a.meta.type), a.meta.topics.join(' '), ...seriesText, a.bodyText, a.enText].join(' ')),
    };
  });
  const seriesIndex = [...groups.values()].map((g) => ({
    slug: g.slug,
    title: g.meta.title,
    title_en: g.meta.title_en,
    summary: g.meta.summary,
    author: g.meta.author,
    publisher: g.meta.publisher,
    edition: g.meta.edition,
    licence: g.meta.licence,
    url: g.meta.url,
    levels: g.levels,
    types: g.types,
    topics: g.topics,
    date: g.date,
    duration: g.duration,
    count: g.chapters.length,
    chapters: g.chapters.map((c) => ({ slug: c.slug, part: c.meta.part, label: chLabel(c), title: c.meta.title, title_en: c.meta.title_en, level: c.meta.level, type: c.meta.type, duration: c.duration })),
  })).sort((x, y) => y.date.localeCompare(x.date) || x.title.localeCompare(y.title, 'cy'));
  mkdirSync(join(DIST, 'data'), { recursive: true });
  const json = JSON.stringify({ levels: LEVELS.map(([id, en]) => ({ id, en })), types: TYPES.map(([id, label]) => ({ id, label })), articles: index, series: seriesIndex });
  writeFileSync(join(DIST, 'data', 'index.json'), json);
  if (json.length > 1_000_000) warn('data/index.json', `is ${(json.length / 1e6).toFixed(1)} MB; consider splitting search data`);

  // home page (the no-JavaScript fallback list: standalone articles, and each series with its chapters)
  const li = (a, href) => `<li><a href="${href}" lang="cy">${esc(a.meta.title)}</a>${a.meta.title_en ? ` <span lang="en">(${esc(a.meta.title_en)})</span>` : ''}</li>`;
  const units = [
    ...standalone.map((a) => ({ date: a.meta.date, title: a.meta.title, html: li(a, `articles/${a.slug}/`) })),
    ...[...groups.values()].map((g) => ({
      date: g.date,
      title: g.meta.title,
      html: `<li><a href="series/${g.slug}/" lang="cy">${esc(g.meta.title)}</a> <span lang="en">(series, ${g.chapters.length} chapter${g.chapters.length === 1 ? '' : 's'})</span><ol>${g.chapters.map((c) => `<li><a href="articles/${c.slug}/" lang="cy">${esc(chLabel(c))}: ${esc(c.meta.title)}</a></li>`).join('')}</ol></li>`,
    })),
  ].sort((x, y) => y.date.localeCompare(x.date) || x.title.localeCompare(y.title, 'cy'));
  const list = units.length ? `<ul>${units.map((u) => u.html).join('')}</ul>` : '<p>No articles yet.</p>';
  const home = fill(readFileSync(join(SITE, 'index.html'), 'utf8'), {
    site_title: SITE_TITLE,
    tagline: SITE_TAGLINE,
    noscript_list: list,
  }, 'index.html');
  writeFileSync(join(DIST, 'index.html'), home);

  console.log(`Built ${articles.length} article(s)${groups.size ? ` and ${groups.size} series page(s)` : ''} into dist/.`);
}

main();
