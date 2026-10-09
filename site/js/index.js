// Home page: loads data/index.json, renders cards, handles search and filters.
import { fold, cap, fmtTime, readQuery, writeQuery } from './util.js';

const $ = (id) => document.getElementById(id);
const state = { q: '', levels: new Set(), topics: new Set() };
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

function matches(a, terms) {
  if (state.levels.size && !state.levels.has(a.level)) return false;
  if (state.topics.size && !a.topics.some((t) => state.topics.has(t))) return false;
  return terms.every((t) => a.search.includes(t));
}

function renderCard(a) {
  const rank = levelRank(a.level);
  const dots = '●'.repeat(rank) + '○'.repeat(data.levels.length - rank);
  const meta = h('div', { class: 'card-meta' },
    h('span', { class: 'badge badge-level' },
      h('span', { class: 'dots', 'aria-hidden': 'true', text: dots }),
      document.createTextNode(` ${cap(a.level)} `),
      h('span', { class: 'badge-en', lang: 'en', text: levelInfo(a.level)?.en || '' })),
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

function render() {
  const terms = fold(state.q).split(/\s+/).filter(Boolean);
  const shown = data.articles.filter((a) => matches(a, terms));
  $('cards').replaceChildren(...shown.map(renderCard));
  $('empty').hidden = shown.length > 0;
  const filtering = terms.length || state.levels.size || state.topics.size;
  $('count').textContent = filtering
    ? `${shown.length} of ${data.articles.length} article${data.articles.length === 1 ? '' : 's'}`
    : `${data.articles.length} article${data.articles.length === 1 ? '' : 's'}`;
  $('clear').hidden = !filtering;
  for (const chip of document.querySelectorAll('.chip')) {
    const set = chip.dataset.kind === 'level' ? state.levels : state.topics;
    chip.setAttribute('aria-pressed', String(set.has(chip.dataset.value)));
  }
}

function persist(push) {
  writeQuery({ q: state.q, levels: [...state.levels], topics: [...state.topics] }, push);
}

function buildChips(container, kind, label, entries) {
  if (!entries.length) return;
  container.replaceChildren(h('span', { class: 'filter-label', text: label }));
  for (const [value, count, text] of entries) {
    const chip = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', 'data-kind': kind, 'data-value': value },
      document.createTextNode(text), document.createTextNode(' '), h('span', { class: 'n', text: `(${count})` }));
    chip.addEventListener('click', () => {
      const set = kind === 'level' ? state.levels : state.topics;
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
  state.q = q.q;
  state.levels = new Set(q.levels.filter((l) => levelIds.has(l)));
  state.topics = new Set(q.topics.filter((t) => topicIds.has(t)));
  $('q').value = state.q;
}

async function main() {
  try {
    const res = await fetch('data/index.json');
    if (!res.ok) throw new Error(res.statusText);
    data = await res.json();
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
  buildChips($('level-filters'), 'level', 'Level',
    data.levels.filter((l) => levelCounts.has(l.id)).map((l) => [l.id, levelCounts.get(l.id), cap(l.id)]));
  buildChips($('topic-filters'), 'topic', 'Topic',
    [...topicCounts].sort((x, y) => x[0].localeCompare(y[0])).map(([t, n]) => [t, n, t]));

  if (data.articles.length) $('q').hidden = false;
  applyQuery();

  $('q').addEventListener('input', (e) => { state.q = e.target.value; persist(false); render(); });
  $('clear').addEventListener('click', () => {
    state.q = ''; state.levels.clear(); state.topics.clear();
    $('q').value = '';
    persist(true);
    render();
  });
  window.addEventListener('popstate', () => { applyQuery(); render(); });

  render();
}

main();
