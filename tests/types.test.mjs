import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { site, build, page, REPO } from './helpers.mjs';

const require = createRequire(import.meta.url);
const L = require('../tools/lint-core.js');
const R = require('../tools/render-core.js');
const E = require('../tools/editor-core.js');

test('the type list is well formed: unique slugs, readable labels', () => {
  assert.ok(L.TYPES.length >= 8);
  assert.deepEqual(L.TYPE_IDS, L.TYPES.map((t) => t[0]));
  assert.equal(new Set(L.TYPE_IDS).size, L.TYPE_IDS.length, 'ids are unique');
  assert.equal(new Set(L.TYPES.map((t) => t[1])).size, L.TYPES.length, 'labels are unique');
  for (const [id, label] of L.TYPES) {
    assert.match(id, L.SLUG_RE, `${id} is a lowercase slug`);
    assert.ok(label.trim().length > 1, `${id} has a label`);
  }
  for (const wanted of ['news', 'story', 'song', 'poem', 'dialogue', 'podcast', 'video']) assert.ok(L.TYPE_IDS.includes(wanted), wanted);
});

test('validateMeta: type is required and must be on the list', () => {
  const m = (x) => L.validateMeta({ title: 't', level: 'uwch', date: '2026-01-01', summary: 's', ...x }).filter((v) => /type/.test(v.message)).map((v) => `${v.severity}: ${v.message}`);
  assert.deepEqual(m({ type: 'song' }), []);
  assert.deepEqual(m({}), ['error: missing required frontmatter field "type"']);
  assert.match(m({ type: 'poetry' })[0], /type "poetry" is not one of: news, article, story, poem, song/);
  assert.match(m({ type: 'Poem' })[0], /is not one of/, 'ids are lowercase');
});

test('render-core: badge and label come from the list; unknown types render nothing', () => {
  assert.equal(R.typeLabel('story'), 'Short story');
  assert.match(R.typeBadge('news'), /class="badge badge-type" data-type="news">News article</);
  assert.equal(R.typeBadge('nonsense'), '');
  assert.equal(R.typeLabel('nonsense'), '');
});

test('editor: type survives a round trip and is validated like the build', () => {
  const meta = Object.assign(E.newMeta(), { title: 'T', level: 'sylfaen', type: 'poem', summary: 'S', date: '2026-01-01' });
  const md = E.serialize(meta, [{ kind: 'seg', cy: 'Un.', en: 'One.', breakBefore: false }]).md;
  assert.match(md, /level: sylfaen\ntype: poem\n/);
  assert.equal(E.parseArticle({ md }).meta.type, 'poem');
  assert.deepEqual(L.analyse({ md }).issues.filter((i) => i.severity === 'error'), []);
  meta.type = '';
  const noType = L.analyse({ md: E.serialize(meta, [{ kind: 'seg', cy: 'Un.', en: 'One.', breakBefore: false }]).md });
  assert.ok(noType.issues.some((i) => /missing required frontmatter field "type"/.test(i.message)));
});

test('build: type shows as a badge on the article and the series page, and in the index and search', () => {
  const root = site(
    {
      a: { fm: { type: 'dialogue', series: 'book', part: 1 } },
      b: { fm: { type: 'song', series: 'book', part: 2 } },
      c: { fm: { type: 'news' } },
    },
    { book: '---\ntitle: Book\n---\n' },
  );
  try {
    const r = build(root);
    assert.equal(r.status, 0, r.stderr);
    assert.match(page(root, 'articles', 'a', 'index.html'), /badge badge-type" data-type="dialogue">Dialogue</);
    assert.match(page(root, 'articles', 'c', 'index.html'), /badge badge-type" data-type="news">News article</);
    const series = page(root, 'series', 'book', 'index.html');
    assert.match(series, /Dialogue · Sylfaen/, 'chapter rows say what each chapter is');
    assert.match(series, /Song · Sylfaen/);
    assert.match(series, /data-type="song"[\s\S]*data-type="dialogue"/, 'the series page lists the types its chapters use, in the order of the one list (song comes before dialogue)');
    const idx = JSON.parse(page(root, 'data', 'index.json'));
    assert.deepEqual(idx.types.map((t) => t.id), L.TYPE_IDS, 'filter order and labels come from the one list');
    assert.equal(idx.types[0].label, 'News article');
    assert.equal(idx.articles.find((x) => x.slug === 'c').type, 'news');
    assert.deepEqual(idx.series[0].types, ['song', 'dialogue']);
    assert.equal(idx.series[0].chapters[1].type, 'song');
    assert.match(idx.articles.find((x) => x.slug === 'b').search, /song/, 'the type is searchable');
    assert.match(idx.articles.find((x) => x.slug === 'a').search, /dialogue/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const [name, fm, expect] of [
  ['a missing type', { type: undefined }, /missing required frontmatter field "type"/],
  ['a type that is not on the list', { type: 'poetry' }, /type "poetry" is not one of/],
]) {
  test(`build fails on ${name} and writes nothing`, () => {
    const root = site({ a: { fm } });
    try {
      const r = build(root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, expect);
      assert.equal(existsSync(join(root, 'dist')), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test('a draft without a type does not fail the build (drafts are not validated)', () => {
  const root = site({ a: { fm: { type: 'song' } }, wip: { fm: { type: undefined, draft: 'true' } } });
  try {
    const r = build(root);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(root, 'dist', 'articles', 'wip')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the real content in the repository declares a valid type', () => {
  // the build and lint steps in CI also enforce this; here it fails fast with a clear message
  const dir = join(REPO, 'content', 'articles');
  for (const slug of existsSync(dir) ? require('node:fs').readdirSync(dir) : []) {
    const fm = L.parseFrontmatter(L.normalise(readFileSync(join(dir, slug, 'article.md'), 'utf8')));
    if (fm.data && fm.data.draft === 'true') continue;
    assert.ok(L.TYPE_IDS.includes(fm.data.type), `${slug}: type is "${fm.data.type}"`);
  }
});
