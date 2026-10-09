// Home page: loads data/index.json, renders cards, handles search and filters.
// The list shows standalone articles and one card per series. Search and filters work
// on chapters: a series appears when any of its chapters matches, listing the matches.
import { fold, cap, fmtTime, readQuery, writeQuery } from './util.js';
import { readSet } from './progress.js';

const $ = (id) => document.getElementById(id);
const state = { q: '', levels: new Set(), topics: new Set(), series: new Set() };
let data = null;

function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid) node.append(kid);
  return node;
}

const levelInfo = (id) => data.levels.find((l) => l.id === id);
const levelRank = (id) => data.levels.findIndex((l) => l.id === id) + 1;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function matches(a, terms) {
  if (state.series.size && !state.series.has(a.series)) return false;
  if (state.levels.size && !state.levels.has(a.level)) return false;
  if (state.topics.size && !a.topics.some((t) => state.topics.has(t))) return false;
  return terms.every((t) => a.search.includes(t));
}

function levelBadge(level) {
  const rank = levelRank(level);
  const dots = '●'.repeat(rank) + '○'.repeat(data.levels.length - rank);
  return h('span', { class: 'badge badge-level' },
    h('span', { class: 'dots', 'aria-hidden': 'true', text: dots }),
    document.createTextNode(` ${cap(level)} `),
    h('span', { class: 'badge-en', lang: 'en', text: levelInfo(level)?.en || '' }));
}

function renderCard(a) {
  const meta = h('div', { class: 'card-meta' },
    levelBadge(a.level),
    a.dialect && h('span', { text: `${cap(a.dialect)} dialect` }),
    a.duration && h('span', { text: fmtTime(a.duration) }),
    a.has_english && h('span', { class: 'feature', title: 'English translation available', text: 'EN' }),
    a.has_sync && h('span', { class: 'feature', title: 'Sentences highlight as the audio plays', text: '♪ Synced' }));

  const tags = a.topics.length
    ? h('div', { class: 'badges' }, a.topics.map((t) => h('span', { class: 'badge badge-topic', text: t })))
    : null;

  return h('li', { class: 'card' },
    h('h2', { lang: 'cy' }, h('a', { href: `articles/${a.slug}/`, text: a.title })),
    a.title_en && h('p', { class: 'en-title', lang: 'en', text: a.title_en }),
    h('p', { class: 'summary', lang: 'en', text: a.summary }),
    tags,
    meta);
}

function renderSeriesCard(s, chapters, filtering, read) {
  const first = s.levels[0];
  const last = s.levels[s.levels.length - 1];
  const levelText = first === last ? cap(first) : `${cap(first)} – ${cap(last)}`;
  const done = s.chapters.filter((c) => read.has(c.slug)).length;
  const meta = h('div', { class: 'card-meta' },
    h('span', { class: 'badge badge-level', text: levelText }),
    h('span', { text: plural(s.count, 'chapter') }),
    s.duration && h('span', { text: fmtTime(s.duration) }),
    s.author && h('span', { text: s.author }),
    done > 0 && h('span', { class: 'feature', text: `${done} of ${s.count} read` }));

  const label = filtering && chapters.length < s.count
    ? `${chapters.length} of ${s.count} chapters match`
    : `Chapters (${s.count})`;
  const list = h('ol', { class: 'card-chapter-list' }, chapters.map((c) => h('li', { class: read.has(c.slug) ? 'is-read' : '' },
    h('a', { href: `articles/${c.slug}/` },
      h('span', { class: 'ch-label', text: c.label }),
      h('span', { class: 'ch-title', lang: 'cy', text: c.title })),
    read.has(c.slug) && h('span', { class: 'read-mark', text: 'Read' }))));
  const details = h('details', { class: 'card-chapters' }, h('summary', { text: label }), list);
  if (filtering) details.open = true;

  return h('li', { class: 'card card-series' },
    h('p', { class: 'kicker', text: 'Series' }),
    h('h2', { lang: 'cy' }, h('a', { href: `series/${s.slug}/`, text: s.title })),
    s.title_en && h('p', { class: 'en-title', lang: 'en', text: s.title_en }),
    s.summary && h('p', { class: 'summary', lang: 'en', text: s.summary }),
    meta,
    details);
}

function render() {
  const terms = fold(state.q).split(/\s+/).filter(Boolean);
  const filtering = terms.length > 0 || state.levels.size > 0 || state.topics.size > 0 || state.series.size > 0;
  const matched = data.articles.filter((a) => matches(a, terms));
  const read = readSet();

  const units = matched.filter((a) => !a.series).map((a) => ({ date: a.date, title: a.title, node: () => renderCard(a) }));
  let chapterTotal = 0;
  let seriesCount = 0;
  for (const s of data.series) {
    const chapters = matched.filter((a) => a.series === s.slug).sort((x, y) => x.part - y.part);
    if (!chapters.length) continue;
    seriesCount++;
    chapterTotal += chapters.length;
    units.push({ date: s.date, title: s.title, node: () => renderSeriesCard(s, chapters, filtering, read) });
  }
  units.sort((x, y) => y.date.localeCompare(x.date) || x.title.localeCompare(y.title, 'cy'));

  $('cards').replaceChildren(...units.map((u) => u.node()));
  $('empty').hidden = units.length > 0;

  const standalone = units.length - seriesCount;
  const parts = [];
  if (standalone) parts.push(plural(standalone, 'article'));
  if (seriesCount) parts.push(`${plural(seriesCount, 'series')}${filtering ? ` (${plural(chapterTotal, 'matching chapter')})` : ''}`);
  $('count').textContent = parts.join(' · ');
  $('clear').hidden = !filtering;
  for (const chip of document.querySelectorAll('.chip')) {
    const set = state[chip.dataset.kind === 'level' ? 'levels' : chip.dataset.kind === 'topic' ? 'topics' : 'series'];
    chip.setAttribute('aria-pressed', String(set.has(chip.dataset.value)));
  }
}

function persist(push) {
  writeQuery({ q: state.q, levels: [...state.levels], topics: [...state.topics], series: [...state.series] }, push);
}

const SET_FOR = { level: 'levels', topic: 'topics', series: 'series' };

function buildChips(container, kind, label, entries) {
  if (!entries.length) return;
  container.replaceChildren(h('span', { class: 'filter-label', text: label }));
  for (const [value, count, text] of entries) {
    const chip = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', 'data-kind': kind, 'data-value': value },
      document.createTextNode(text), document.createTextNode(' '), h('span', { class: 'n', text: `(${count})` }));
    chip.addEventListener('click', () => {
      const set = state[SET_FOR[kind]];
      if (!set.delete(value)) set.add(value);
      persist(true);
      render();
    });
    container.append(chip);
  }
  container.hidden = false;
}

function applyQuery() {
  const q = readQuery();
  const levelIds = new Set(data.levels.map((l) => l.id));
  const topicIds = new Set(data.articles.flatMap((a) => a.topics));
  const seriesIds = new Set(data.series.map((s) => s.slug));
  state.q = q.q;
  state.levels = new Set(q.levels.filter((l) => levelIds.has(l)));
  state.topics = new Set(q.topics.filter((t) => topicIds.has(t)));
  state.series = new Set(q.series.filter((s) => seriesIds.has(s)));
  $('q').value = state.q;
}

async function main() {
  try {
    const res = await fetch('data/index.json');
    if (!res.ok) throw new Error(res.statusText);
    data = await res.json();
    data.series = data.series || [];
  } catch {
    $('error').hidden = false;
    return;
  }

  const levelCounts = new Map();
  const topicCounts = new Map();
  for (const a of data.articles) {
    levelCounts.set(a.level, (levelCounts.get(a.level) || 0) + 1);
    for (const t of a.topics) topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
  }
  buildChips($('series-filters'), 'series', 'Series',
    data.series.map((s) => [s.slug, s.count, s.title]));
  buildChips($('level-filters'), 'level', 'Level',
    data.levels.filter((l) => levelCounts.has(l.id)).map((l) => [l.id, levelCounts.get(l.id), cap(l.id)]));
  buildChips($('topic-filters'), 'topic', 'Topic',
    [...topicCounts].sort((x, y) => x[0].localeCompare(y[0])).map(([t, n]) => [t, n, t]));

  if (data.articles.length) $('q').hidden = false;
  applyQuery();

  $('q').addEventListener('input', (e) => { state.q = e.target.value; persist(false); render(); });
  $('clear').addEventListener('click', () => {
    state.q = ''; state.levels.clear(); state.topics.clear(); state.series.clear();
    $('q').value = '';
    persist(true);
    render();
  });
  window.addEventListener('popstate', () => { applyQuery(); render(); });

  render();
}

main();
