import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { site, build, page, REPO } from './helpers.mjs';

const KEY = '11111111-2222-3333-4444-555555555555';
const buildWith = (root, env = {}) => spawnSync('node', [join(REPO, 'scripts', 'build.mjs')], {
  env: { ...process.env, GAD_ROOT: root, WEB3FORMS_ACCESS_KEY: '', ...env }, encoding: 'utf8',
});

const BODY = [
  'Mae {{tyrbinau gwynt|wind turbines|tyrbin, tyrbinau, eg = turbine|gwynt, eg = wind}} yma.',
  'Rwy\'n hoffi {{ddiogel|safe|diogel, adj = safe|note: soft mutation of diogel}} a {{afal|apple|afal, eg = apple}}.',
  'Eto {{tyrbinau gwynt|wind turbines|tyrbin, tyrbinau, eg = turbine|gwynt, eg = wind}}.',
  'A <b> {{a & b|a & b}}.',
].join('\n');

test('the article ends with a Geirfa: every tooltip once, alphabetical, with entries and notes', () => {
  const root = site({ one: { body: BODY } });
  const r = build(root);
  assert.equal(r.status, 0, r.stderr);
  const html = page(root, 'articles', 'one', 'index.html');
  assert.match(html, /<section class="glossary"/);
  assert.match(html, /Geirfa/);
  assert.equal((html.match(/class="gl-item"/g) || []).length, 4, 'duplicate gloss listed once');
  const order = [...html.matchAll(/<dt lang="cy">([^<]*)<\/dt>/g)].map((m) => m[1]);
  assert.deepEqual(order, ['a &amp; b', 'afal', 'ddiogel', 'tyrbinau gwynt']);
  assert.match(html, /tyrbin, tyrbinau<\/span> <span class="tag tag-m"[^>]*>\(eg\)<\/span><span class="tip-sep"/);
  assert.match(html, /class="gl-note" lang="en">soft mutation of diogel/);
  // the glossary comes before the prev/next nav, and the escaped text has no raw markup
  assert.ok(html.indexOf('class="glossary"') < html.indexOf('class="article-nav"'));
  assert.ok(!html.includes('<b>'));
});

test('an article with no glosses gets no Geirfa', () => {
  const root = site({ plain: { body: 'Dim geiriau.' } });
  assert.equal(build(root).status, 0);
  assert.ok(!page(root, 'articles', 'plain', 'index.html').includes('class="glossary"'));
});

test('without a Web3Forms key there is no contact page or link', () => {
  const root = site({ one: {} });
  assert.equal(buildWith(root).status, 0);
  for (const f of [['index.html'], ['articles', 'one', 'index.html']]) assert.ok(!/contact\//.test(page(root, ...f)), f.join('/'));
  assert.throws(() => page(root, 'contact', 'index.html'));
});

test('with a key: contact page is built and linked from the home page, articles and series', () => {
  const root = site({ one: { fm: { series: 's', part: 1 } } }, { s: '---\ntitle: S\n---\n' });
  const r = buildWith(root, { WEB3FORMS_ACCESS_KEY: KEY });
  assert.equal(r.status, 0, r.stderr);
  const contact = page(root, 'contact', 'index.html');
  assert.ok(contact.includes(`name="access_key" value="${KEY}"`));
  assert.match(contact, /action="https:\/\/api\.web3forms\.com\/submit"/);
  assert.match(contact, /name="botcheck"/);
  assert.match(page(root, 'index.html'), /href="contact\/"/);
  assert.match(page(root, 'articles', 'one', 'index.html'), /href="\.\.\/\.\.\/contact\/\?article=one"/);
  assert.match(page(root, 'series', 's', 'index.html'), /href="\.\.\/\.\.\/contact\/"/);
});

test('a malformed key is flagged but does not stop the build', () => {
  const root = site({ one: {} });
  const r = buildWith(root, { WEB3FORMS_ACCESS_KEY: 'oops' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /WEB3FORMS_ACCESS_KEY/);
});
