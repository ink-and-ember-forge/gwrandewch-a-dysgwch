import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { analyse, parseInline, parseEntry } = createRequire(import.meta.url)('../tools/lint-core.js');

const FM = '---\ntitle: T\nlevel: sylfaen\ntype: news\ndate: 2026-01-01\nsummary: S\n---\n\n';
const B = FM.split('\n').length; // line number of the first body line, whatever the frontmatter holds
const run = (cy, en) => analyse({ md: FM + cy, en });
const rules = (r, file) => r.issues.filter((i) => !file || i.file === file).map((i) => i.rule);
const has = (r, rule, line) => r.issues.some((i) => i.rule === rule && (line === undefined || i.line === line));

test('a well-formed article with glosses, paragraphs and English is clean', () => {
  const dir = new URL('./fixtures/market/', import.meta.url);
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
  assert.ok(has(r, 'double-space', B + 1));
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
  assert.deepEqual(lines, [B + 2]);
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
  assert.ok(has(r, 'hard-wrap', B));
  assert.ok(has(run(`${'gair '.repeat(60)}.\n`), 'long-line'));
});

test('multiple sentences on a line are a note, abbreviations are not', () => {
  assert.ok(has(run('Helo. Sut wyt ti?\n'), 'multi-sentence'));
  assert.ok(!has(run('Dyma Dr. Jones yn siarad.\n'), 'multi-sentence'));
  assert.ok(!has(run('Dyma J. Jones yn siarad.\n'), 'multi-sentence'));
  assert.ok(has(run('Dw i eisiau gweld ti. Mae hi yma.\n'), 'multi-sentence'), 'a sentence ending in a short Welsh word still counts');
});

test('gloss syntax errors carry a line number', () => {
  const r = run('Un {{a|}} dau.\nTri {{b\n');
  assert.ok(r.issues.filter((i) => i.rule === 'gloss' && i.severity === 'error').length >= 2);
  assert.ok(has(r, 'gloss', B) && has(r, 'gloss', B + 1));
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
  const r = analyse({ md: '---\ntitle: T\nlevel: nope\ntype: poetry\ndate: 2026-13-45\n---\nUn.\n' });
  assert.ok(r.issues.some((i) => i.rule === 'frontmatter' && /level/.test(i.message)));
  assert.ok(r.issues.some((i) => i.rule === 'frontmatter' && /date/.test(i.message)));
  assert.ok(r.issues.some((i) => i.rule === 'frontmatter' && /type "poetry" is not one of/.test(i.message)));
  assert.ok(r.issues.some((i) => i.rule === 'frontmatter' && /summary/.test(i.message)));
  assert.ok(analyse({ md: 'Un.\n' }).issues.some((i) => i.rule === 'frontmatter'));
});

test('CRLF and BOM are notes, and do not shift line numbers', () => {
  const r = analyse({ md: `﻿${FM.replace(/\n/g, '\r\n')}Un.\r\nDwy  fawr.\r\n` });
  assert.ok(r.issues.some((i) => i.rule === 'crlf' && i.severity === 'info'));
  assert.ok(has(r, 'double-space', B + 1));
});

const gloss = (src) => {
  const problems = [];
  const part = parseInline(src, problems).find((p) => p.surface !== undefined);
  return { part, problems };
};

test('gloss entries: one field per word, gender tag typed once per word', () => {
  const { part, problems } = gloss('{{tyrbinau gwynt|wind turbines|tyrbin, tyrbinau, eg = turbine|gwynt, eg = wind}}');
  assert.deepEqual(problems, []);
  assert.equal(part.tip, 'wind turbines');
  assert.deepEqual(part.entries, [
    { cy: ['tyrbin', 'tyrbinau'], tag: 'eg', en: 'turbine' },
    { cy: ['gwynt'], tag: 'eg', en: 'wind' },
  ]);
});

test('entry tags: genders, type labels and Welsh aliases', () => {
  assert.equal(parseEntry('marchnad, marchnadoedd, eb = market').entry.tag, 'eb');
  assert.equal(parseEntry('cath, egb = cat').entry.tag, 'egb');
  assert.equal(parseEntry('glân, ans = clean').entry.tag, 'adj');
  assert.equal(parseEntry('cerdded, be = to walk').entry.tag, 'verb');
  assert.equal(parseEntry('ar, ardd = on').entry.tag, 'prep');
});

test('a plural that merely looks like a tag is kept as a form unless it is a known tag', () => {
  assert.deepEqual(parseEntry('tad, tadau = father').entry, { cy: ['tad', 'tadau'], tag: null, en: 'father' });
});

test('entries can be mixed with notes; plain and "note:" fields are notes', () => {
  const { part } = gloss("{{farchnad|market|marchnad, marchnadoedd, eb = market|note: soft mutation after i'r|second note}}");
  assert.equal(part.entries.length, 1);
  assert.equal(part.note, "soft mutation after i'r\nsecond note");
});

test('old-style glosses (plain third field) are still notes', () => {
  const { part, problems } = gloss('{{nheulu|family|nasal mutation of teulu after fy}}');
  assert.deepEqual(problems, []);
  assert.equal(part.note, 'nasal mutation of teulu after fy');
  assert.deepEqual(part.entries, []);
});

test('malformed entries are errors with the gloss named', () => {
  assert.match(gloss('{{a|b|eg = thing}}').problems[0], /no Welsh word/);
  assert.match(gloss('{{a|b|gair, eg = }}').problems[0], /nothing after the =/);
  assert.match(gloss('{{a|b|note: }}').problems[0], /empty note/);
});

test('typing (m)/(f) by hand in an entry is flagged; the tag is added automatically', () => {
  const r = run('Mae {{gwynt|wind|gwynt, eg = wind (m)}} yma.\n');
  assert.ok(r.issues.some((i) => i.rule === 'gloss-entry' && /remove the typed/.test(i.message)));
  assert.deepEqual(run('Mae {{gwynt|wind|gwynt, eg = wind}} yma.\n').issues, []);
});
