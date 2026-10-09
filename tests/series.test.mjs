import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../tools/lint-core.js');
const R = require('../tools/render-core.js');
const E = require('../tools/editor-core.js');

import { REPO, site, build, page } from './helpers.mjs';

const chapter = (n, extra = {}) => ({ fm: { series: 'book', part: n, ...extra } });

test('validateMeta: series needs a part, part needs a series, both well formed', () => {
  const m = (x) => L.validateMeta({ title: 't', level: 'uwch', type: 'news', date: '2026-01-01', summary: 's', ...x }).map((v) => `${v.severity}:${v.message}`);
  assert.deepEqual(m({ series: 'cymraeg-byw', part: '3', part_label: 'Uned 3' }), []);
  assert.ok(m({ series: 'cymraeg-byw' }).some((x) => /needs a part number/.test(x)));
  assert.ok(m({ part: '2' }).some((x) => /part needs a series/.test(x)));
  assert.ok(m({ series: 'Cymraeg Byw', part: '1' }).some((x) => /lowercase/.test(x)));
  for (const bad of ['0', '-1', '1.5', 'three', '12345']) assert.ok(m({ series: 'a', part: bad }).some((x) => /whole number/.test(x)), bad);
  assert.ok(m({ part_label: 'Uned 1' }).some((x) => /only used when/.test(x)));
});

test('validateSeriesMeta', () => {
  assert.deepEqual(L.validateSeriesMeta({ title: 'Cymraeg Byw', url: 'https://example.org' }), []);
  assert.ok(L.validateSeriesMeta({}).some((v) => /title/.test(v.message)));
  assert.ok(L.validateSeriesMeta({ title: 'x', url: 'ftp://x' }).some((v) => v.severity === 'error'));
  assert.ok(L.validateSeriesMeta({ title: 'x', colour: 'red' }).some((v) => v.severity === 'warn'));
});

test('checkSeriesSet: duplicates are errors; gaps, drafts, strays and orphans are warnings', () => {
  const ch = (slug, part, draft) => ({ slug, series: 'book', part, draft });
  const issues = L.checkSeriesSet([ch('a', 1), ch('b', 2), ch('c', 2), ch('e', 5), ch('d', 4, true)], []);
  assert.ok(issues.some((i) => i.severity === 'error' && /part 2/.test(i.message) && i.where.includes('/c/')));
  const gap = issues.find((i) => /no chapter for part/.test(i.message));
  assert.match(gap.message, /part 3, 4/);
  assert.match(gap.message, /part 4 is a draft/);
  assert.ok(L.checkSeriesSet([ch('only', 1)], []).some((i) => /typo/.test(i.message)));
  assert.deepEqual(L.checkSeriesSet([ch('only', 1)], ['book']), []);
  assert.ok(L.checkSeriesSet([], ['lonely']).some((i) => /no published chapter/.test(i.message)));
  assert.deepEqual(L.checkSeriesSet([{ slug: 'solo', series: '', part: 0 }], []), []);
});

test('chapterLabel prefers the author\'s label', () => {
  assert.equal(R.chapterLabel(3), 'Part 3');
  assert.equal(R.chapterLabel(3, 'Uned 3'), 'Uned 3');
  assert.equal(R.chapterLabel(3, '  '), 'Part 3');
});

test('editor: series fields and the series file round-trip', () => {
  const meta = Object.assign(E.newMeta(), { title: 'T', level: 'sylfaen', type: 'news', summary: 'S', date: '2026-01-01', series: 'cymraeg-byw', part: '3', part_label: 'Uned 3' });
  const md = E.serialize(meta, [{ kind: 'seg', cy: 'Un.', en: 'One.', breakBefore: false }]).md;
  assert.match(md, /series: cymraeg-byw\npart: 3\npart_label: Uned 3\n/);
  const back = E.parseArticle({ md }).meta;
  assert.deepEqual([back.series, back.part, back.part_label], ['cymraeg-byw', '3', 'Uned 3']);
  assert.deepEqual(L.analyse({ md }).issues.filter((i) => i.severity === 'error'), []);
  const sm = Object.assign(E.newSeriesMeta(), { title: 'Cymraeg Byw', author: 'A. Learner', url: 'https://example.org' });
  const parsed = E.parseSeriesFile(E.seriesFileText(sm));
  assert.deepEqual(parsed.meta, sm);
  assert.deepEqual(parsed.problems, []);
});

test('build: a series gets a page, ordered chapters, labels and a book credit', () => {
  const root = site(
    { c3: chapter(3, { part_label: 'Uned 3' }), c1: chapter(1, { part_label: 'Uned 1' }), c2: chapter(2, { part_label: 'Uned 2' }), solo: { fm: {} } },
    { book: '---\ntitle: Cymraeg Byw\ntitle_en: Living Welsh\nsummary: A course.\nauthor: A. Learner\npublisher: Example Press\nedition: 2nd\nlicence: CC BY\nurl: https://example.org/book\n---\n' },
  );
  try {
    const r = build(root);
    assert.equal(r.status, 0, r.stderr);
    const s = page(root, 'series', 'book', 'index.html');
    const order = [...s.matchAll(/data-slug="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(order, ['c1', 'c2', 'c3'], 'chapters in part order, not folder order');
    assert.match(s, /Uned 1/);
    assert.match(s, /By A\. Learner · Published by Example Press, 2nd · Licence: CC BY · <a href="https:\/\/example\.org\/book"/);
    assert.match(s, /Start with Uned 1/);

    const mid = page(root, 'articles', 'c2', 'index.html');
    assert.match(mid, /class="series-banner"><a href="\.\.\/\.\.\/series\/book\/">Cymraeg Byw<\/a>.*<strong>Uned 2<\/strong>/);
    assert.match(mid, /rel="prev"[^>]*><span class="nav-label">← Uned 1<\/span>/);
    assert.match(mid, /rel="next"[^>]*><span class="nav-label">Uned 3 →<\/span>/);
    assert.match(mid, /id="mark-read"/);
    assert.match(mid, /All 3 chapters/);

    const first = page(root, 'articles', 'c1', 'index.html');
    assert.doesNotMatch(first, /rel="prev"/, 'the first chapter has no previous link');

    const solo = page(root, 'articles', 'solo', 'index.html');
    assert.doesNotMatch(solo, /series-banner|mark-read/);
    assert.doesNotMatch(solo, /Uned/, 'a standalone article never links into a series');

    const idx = JSON.parse(page(root, 'data', 'index.json'));
    assert.equal(idx.series.length, 1);
    assert.equal(idx.series[0].count, 3);
    assert.equal(idx.series[0].chapters[0].label, 'Uned 1');
    assert.equal(idx.articles.find((a) => a.slug === 'c2').series, 'book');
    assert.match(idx.articles.find((a) => a.slug === 'c2').search, /living welsh/, 'series text is searchable from each chapter');
    assert.equal(idx.articles.find((a) => a.slug === 'solo').series, '');

    const home = page(root, 'index.html');
    assert.match(home, /series, 3 chapters/, 'the no-JS list shows the series with its chapters');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('build: without a series file the title comes from the name; labels default to Part N', () => {
  const root = site({ a: chapter(1), b: chapter(2) });
  try {
    const r = build(root);
    assert.equal(r.status, 0, r.stderr);
    const s = page(root, 'series', 'book', 'index.html');
    assert.match(s, /<h1 lang="cy">Book<\/h1>/);
    assert.match(s, /Part 1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('build: gaps and a stray one-chapter series warn but do not fail', () => {
  const root = site({ a: chapter(1), c: chapter(3), d: chapter(2, { draft: 'true' }), typo: { fm: { series: 'bok', part: 1 } } });
  try {
    const r = build(root);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no chapter for part 2 \(part 2 is a draft\)/);
    assert.match(r.stdout, /series "bok": has a single chapter/);
    const s = page(root, 'series', 'book', 'index.html');
    assert.doesNotMatch(s, /data-slug="d"/, 'drafts are not listed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const [name, articles, series, expect] of [
  ['a duplicate part number', { a: chapter(1), b: chapter(1) }, {}, /part 1 of series "book" is also used by "a"/],
  ['a series without a part', { a: { fm: { series: 'book' } } }, {}, /needs a part number/],
  ['a part without a series', { a: { fm: { part: 2 } } }, {}, /part needs a series/],
  ['a bad series name', { a: { fm: { series: 'My Book', part: 1 } } }, {}, /series "My Book" must be lowercase/],
  ['a series file without a title', { a: chapter(1), b: chapter(2) }, { book: '---\nauthor: x\n---\n' }, /missing required field "title"/],
  ['a series file with a bad link', { a: chapter(1), b: chapter(2) }, { book: '---\ntitle: T\nurl: nope\n---\n' }, /must start with http/],
  ['a series file with a bad name', { a: chapter(1), b: chapter(2) }, { 'My Book': '---\ntitle: T\n---\n' }, /file name must be a lowercase ASCII slug/],
]) {
  test(`build fails on ${name} and writes nothing`, () => {
    const root = site(articles, series);
    try {
      const r = build(root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, expect);
      assert.equal(existsSync(join(root, 'dist')), false, 'no site is written when anything is wrong');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test('lint CLI: reports series problems across the whole content tree', () => {
  const root = site({ a: chapter(1), b: chapter(1), c: chapter(4) }, { orphan: '---\ntitle: O\n---\n', broken: '---\nurl: nope\n---\n' });
  try {
    const r = spawnSync('node', [join(REPO, 'scripts', 'lint.mjs'), '--quiet'], { env: { ...process.env, GAD_ROOT: root, NO_COLOR: '1' }, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /part 1 of series "book" is also used by "a"/);
    assert.match(r.stdout, /no chapter for part 2, 3/);
    assert.match(r.stdout, /content\/series\/orphan\.md\s+warn\s+no published chapter/);
    assert.match(r.stdout, /content\/series\/broken\.md\s+error\s+missing required field "title"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('lint CLI: a clean series passes', () => {
  const root = site({ a: chapter(1), b: chapter(2) }, { book: '---\ntitle: Book\n---\n' });
  try {
    const r = spawnSync('node', [join(REPO, 'scripts', 'lint.mjs'), '--quiet'], { env: { ...process.env, GAD_ROOT: root, NO_COLOR: '1' }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /series[\s\S]*no problems/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
