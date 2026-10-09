import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { analyse } = createRequire(import.meta.url)('../tools/lint-core.js');

const FM = '---\ntitle: T\nlevel: sylfaen\ndate: 2026-01-01\nsummary: S\n---\n\n';
const run = (cy, en) => analyse({ md: FM + cy, en });
const rules = (r, file) => r.issues.filter((i) => !file || i.file === file).map((i) => i.rule);
const has = (r, rule, line) => r.issues.some((i) => i.rule === rule && (line === undefined || i.line === line));

test('the shipped sample articles are clean', () => {
  const dir = new URL('../content/articles/diwrnod-yn-y-farchnad/', import.meta.url);
  const r = analyse({
    md: readFileSync(new URL('article.md', dir), 'utf8'),
    en: readFileSync(new URL('article.en.md', dir), 'utf8'),
  });
  assert.deepEqual(r.issues, []);
});

test('good text produces no issues', () => {
  const r = run("Bore dydd Sadwrn, es i i'r {{farchnad|market}}.\nRoedd hi'n brysur iawn.\n", 'On Saturday morning, I went to the market.\nIt was very busy.\n');
  assert.deepEqual(r.issues, []);
  assert.equal(r.counts.cy, 2);
});

test('line numbers are physical file lines', () => {
  const r = run('Un.\nDwy  fawr.\n');
  assert.ok(has(r, 'double-space', 9));
});

test('whitespace problems', () => {
  const r = run('Un.\t\nDau. \n   Tri.\nPedwar  pump.\n');
  for (const rule of ['tab', 'trailing-space', 'leading-space', 'double-space']) assert.ok(rules(r).includes(rule), rule);
});

test('punctuation spacing, dashes and nbsp', () => {
  const r = run('Beth ?\nHelo,byd.\nUn -- dau.\nUn dau.\n');
  for (const rule of ['space-before-punct', 'missing-space', 'dash', 'nbsp']) assert.ok(rules(r).includes(rule), rule);
});

test('invisible characters are errors', () => {
  const r = run('Un​dau.\n');
  assert.ok(r.issues.some((i) => i.rule === 'invisible-char' && i.severity === 'error'));
});

test('decomposed accents are flagged', () => {
  assert.ok(has(run('Cŵn.\n'), 'unicode-nfc'));
  assert.ok(!has(run('Cŵn.\n'), 'unicode-nfc'));
});

test('mixed apostrophes flag the minority lines only', () => {
  const r = run("Hi'n dda.\nTi'n dda.\nFe’i gwelais.\n");
  const lines = r.issues.filter((i) => i.rule === 'apostrophe-mixed').map((i) => i.line);
  assert.deepEqual(lines, [10]);
});

test('apostrophe style differing between files is a note', () => {
  const r = run("Hi'n dda.\n", 'She’s good.\n');
  assert.ok(r.issues.some((i) => i.rule === 'apostrophe-style' && i.severity === 'info'));
});

test('stray markdown is flagged', () => {
  const r = run('- eitem\n1. un\n> dyfyniad\n---\n# Teitl\n###Teitl\n**trwm** ac *italig*\n[a](b)\n<b>x</b>\n`cod`\n');
  const found = new Set(rules(r));
  for (const rule of ['markdown-list', 'markdown-quote', 'markdown-rule', 'heading', 'markdown-emphasis', 'markdown-link', 'markdown-html', 'markdown-code']) {
    assert.ok(found.has(rule), rule);
  }
});

test('"## Heading" is accepted and is not a sentence', () => {
  const r = run('## Teitl\nUn.\n', '## Title\nOne.\n');
  assert.deepEqual(r.issues.filter((i) => i.severity !== 'info'), []);
  assert.equal(r.counts.cy, 1);
});

test('hard-wrapped sentences and long lines', () => {
  const r = run('Mae hon yn frawddeg hir iawn sy wedi\nei thorri dros ddwy linell.\n');
  assert.ok(has(r, 'hard-wrap', 8));
  assert.ok(has(run(`${'gair '.repeat(60)}.\n`), 'long-line'));
});

test('multiple sentences on a line are a note, abbreviations are not', () => {
  assert.ok(has(run('Helo. Sut wyt ti?\n'), 'multi-sentence'));
  assert.ok(!has(run('Dyma Dr. Jones yn siarad.\n'), 'multi-sentence'));
});

test('gloss syntax errors carry a line number', () => {
  const r = run('Un {{a|}} dau.\nTri {{b\n');
  assert.ok(r.issues.filter((i) => i.rule === 'gloss' && i.severity === 'error').length >= 2);
  assert.ok(has(r, 'gloss', 8) && has(r, 'gloss', 9));
});

test('glosses in the English file and frontmatter in the English file', () => {
  assert.ok(has(run('Un.\n', 'One {{x|y}}.\n'), 'gloss-in-english'));
  const r = run('Un.\n', '---\ntitle: x\n---\nOne.\n');
  assert.ok(r.issues.some((i) => i.rule === 'frontmatter-in-english' && i.severity === 'error'));
});

test('count mismatch is an error and hints where lines drift', () => {
  const cy = 'Bore da, sut wyt ti heddiw?\nRwy yn dda iawn diolch.\nBeth wyt ti yn ei wneud nawr?\nRwy yn darllen llyfr.\n';
  const en = 'Good morning, how are you today?\nI am very well thank you. What are you doing now?\nI am reading a book.\n';
  const r = run(cy, en);
  const e = r.issues.find((i) => i.rule === 'count-mismatch' && i.severity === 'error');
  assert.ok(e);
  assert.match(e.message, /4/);
  assert.match(e.message, /3/);
  assert.doesNotMatch(JSON.stringify(r.issues), /undefined|NaN/);
  assert.ok(!rules(r).includes('paragraph-mismatch'));
});

test('swapped or merged pairs are flagged by shape', () => {
  const r = run('Sut wyt ti heddiw?\nRwy yn dda iawn diolch.\n', 'I am very well thank you.\nHow are you today?\n');
  assert.ok(rules(r, 'article.en.md').includes('alignment'));
});

test('paragraph and heading structure should mirror', () => {
  const r = run('Un.\n\nDau.\n', 'One.\nTwo.\n');
  assert.ok(has(r, 'paragraph-mismatch'));
  const h = run('## Teitl\nUn.\n', 'One.\n');
  assert.ok(has(h, 'heading-mismatch'));
});

test('frontmatter errors are reported with the shared rules', () => {
  const r = analyse({ md: '---\ntitle: T\nlevel: nope\ndate: 2026-13-45\n---\nUn.\n' });
  assert.ok(r.issues.some((i) => i.rule === 'frontmatter' && /level/.test(i.message)));
  assert.ok(r.issues.some((i) => i.rule === 'frontmatter' && /date/.test(i.message)));
  assert.ok(r.issues.some((i) => i.rule === 'frontmatter' && /summary/.test(i.message)));
  assert.ok(analyse({ md: 'Un.\n' }).issues.some((i) => i.rule === 'frontmatter'));
});

test('CRLF and BOM are notes, and do not shift line numbers', () => {
  const r = analyse({ md: `﻿${FM.replace(/\n/g, '\r\n')}Un.\r\nDwy  fawr.\r\n` });
  assert.ok(r.issues.some((i) => i.rule === 'crlf' && i.severity === 'info'));
  assert.ok(has(r, 'double-space', 9));
});
