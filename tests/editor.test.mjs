import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../tools/editor-core.js');
const L = require('../tools/lint-core.js');
const R = require('../tools/render-core.js');

const read = (slug, f) => readFileSync(new URL(`../content/articles/${slug}/${f}`, import.meta.url), 'utf8');

test('slugify: diacritics, apostrophes, punctuation', () => {
  assert.equal(E.slugify('Diwrnod yn y farchnad'), 'diwrnod-yn-y-farchnad');
  assert.equal(E.slugify('Ydy tyrbinau gwynt yn ddiogel i adar?'), 'ydy-tyrbinau-gwynt-yn-ddiogel-i-adar');
  assert.equal(E.slugify('Ŵy a chŵn: Môr & Mynydd'), 'wy-a-chwn-mor-mynydd');
  assert.equal(E.slugify("Rhaid i'r plant"), 'rhaid-ir-plant');
  assert.ok(E.slugify('a '.repeat(80)).length <= 60);
});

for (const slug of ['wind-turbines', 'diwrnod-yn-y-farchnad']) {
  test(`${slug}: parse then serialize gives back equivalent files`, () => {
    const md = read(slug, 'article.md');
    const en = read(slug, 'article.en.md');
    const { meta, items, problems } = E.parseArticle({ md, en });
    assert.deepEqual(problems, []);
    const out = E.serialize(meta, items);
    // same sentences, same paragraph structure, same frontmatter values
    const again = E.parseArticle({ md: out.md, en: out.en });
    assert.deepEqual(again.items, items);
    assert.deepEqual(again.meta, meta);
    // and the generated files pass the real linter with no errors
    const r = L.analyse({ md: out.md, en: out.en });
    assert.deepEqual(r.issues.filter((i) => i.severity !== 'info'), []);
    assert.equal(r.counts.cy, r.counts.en);
  });
}

test('serialize: paragraph breaks, headings and the line map', () => {
  const meta = E.newMeta();
  Object.assign(meta, { title: 'T', level: 'sylfaen', summary: 'S', date: '2026-01-01' });
  const items = [
    { kind: 'seg', cy: 'Un.', en: 'One.', breakBefore: false },
    { kind: 'seg', cy: 'Dau.', en: 'Two.', breakBefore: true },
    { kind: 'heading', cy: 'Teitl', en: 'Title', breakBefore: false },
    { kind: 'seg', cy: 'Tri.', en: 'Three.', breakBefore: true },
  ];
  const out = E.serialize(meta, items);
  const lines = out.md.split('\n');
  assert.equal(lines[out.mdMap.indexOf(1) - 1], 'Dau.');
  assert.equal(lines[out.mdMap.indexOf(2) - 1], '## Teitl');
  assert.equal(lines[out.mdMap.indexOf(3) - 1], 'Tri.');
  assert.deepEqual(out.en.split('\n'), ['One.', '', 'Two.', '', '## Title', '', 'Three.', '']);
  assert.equal(L.analyse({ md: out.md, en: out.en }).issues.filter((i) => i.severity === 'error').length, 0);
});

test('serialize: newlines in cells are flattened and an empty English cell is skipped', () => {
  const meta = Object.assign(E.newMeta(), { title: 'T', level: 'sylfaen', summary: 'S', date: '2026-01-01' });
  const out = E.serialize(meta, [
    { kind: 'seg', cy: 'Un\ndau.', en: 'One.', breakBefore: false },
    { kind: 'seg', cy: 'Tri.', en: '', breakBefore: false },
  ]);
  assert.ok(out.md.includes('\nUn dau.\nTri.\n'));
  assert.equal(out.en, 'One.\n');
  const r = L.analyse({ md: out.md, en: out.en });
  assert.ok(r.issues.some((i) => i.rule === 'count-mismatch' && i.severity === 'error'));
});

test('serialize: unknown frontmatter keys survive; optional empties are omitted', () => {
  const md = '---\ntitle: T\nlevel: uwch\ndate: 2026-01-01\nsummary: S\ncolour: green\n---\nUn.\n';
  const { meta, items } = E.parseArticle({ md });
  assert.deepEqual(meta.extra, { colour: 'green' });
  const out = E.serialize(meta, items);
  assert.match(out.md, /colour: green/);
  assert.doesNotMatch(out.md, /narrator|dialect|title_en|topics|draft/);
  assert.equal(out.en, null);
});

test('parseArticle: plain pasted text without frontmatter, and surplus English lines', () => {
  const a = E.parseArticle({ md: 'Un.\nDau.\n', en: 'One.\nTwo.\nThree.\n' });
  assert.equal(a.items.length, 3);
  assert.deepEqual(a.items[2], { kind: 'seg', cy: '', en: 'Three.', breakBefore: false });
  const b = E.parseArticle({ md: 'Un.\n', en: '---\ntitle: x\n---\nOne.\n' });
  assert.equal(b.items[0].en, 'One.');
  assert.ok(b.problems.some((p) => /frontmatter/.test(p)));
});

test('splitSentences and splitText', () => {
  assert.deepEqual(E.splitSentences('Helo. Sut wyt ti? Da iawn! Dyma Dr. Jones.'), ['Helo.', 'Sut wyt ti?', 'Da iawn!', 'Dyma Dr. Jones.']);
  const items = E.splitText('Un. Dau.\nTri.\n\nPedwar.\n\n## Teitl\nPump.', 'sentences');
  assert.deepEqual(items.map((i) => [i.kind, i.cy, i.breakBefore]), [
    ['seg', 'Un.', false], ['seg', 'Dau.', false], ['seg', 'Tri.', false],
    ['seg', 'Pedwar.', true], ['heading', 'Teitl', false], ['seg', 'Pump.', false],
  ]);
  const lines = E.splitText('Un. Dau.\nTri.', 'lines');
  assert.deepEqual(lines.map((i) => i.cy), ['Un. Dau.', 'Tri.']);
});

const gloss = (extra) => ({ surface: 'tyrbinau gwynt', tip: 'wind turbines', entries: [{ cy: ['tyrbin', 'tyrbinau'], tag: 'eg', en: 'turbine' }, { cy: ['gwynt'], tag: 'eg', en: 'wind' }], notes: [], ...extra });

test('formatGloss round-trips through the real parser', () => {
  const markup = E.formatGloss(gloss({ notes: ["soft mutation after i'r"] }));
  assert.equal(markup, "{{tyrbinau gwynt|wind turbines|tyrbin, tyrbinau, eg = turbine|gwynt, eg = wind|note: soft mutation after i'r}}");
  const problems = [];
  const part = L.parseInline(markup, problems).find((p) => p.surface);
  assert.deepEqual(problems, []);
  assert.equal(part.tip, 'wind turbines');
  assert.deepEqual(part.entries[1], { cy: ['gwynt'], tag: 'eg', en: 'wind' });
  assert.equal(part.note, "soft mutation after i'r");
});

test('validateGloss', () => {
  assert.deepEqual(E.validateGloss(gloss()), []);
  assert.ok(E.validateGloss(gloss({ tip: '' })).some((m) => /translation/.test(m)));
  assert.ok(E.validateGloss(gloss({ tip: 'a|b' })).some((m) => /cannot contain/.test(m)));
  assert.ok(E.validateGloss(gloss({ entries: [{ cy: ['x'], tag: 'eg', en: 'wind (m)' }] })).some((m) => /remove the typed/.test(m)));
  assert.ok(E.validateGloss(gloss({ entries: [{ cy: [], tag: '', en: 'x' }] })).some((m) => /Welsh word/.test(m)));
});

test('wrapSelection: plain text, existing glosses, escapes and error cases', () => {
  const raw = "Mae gwledydd yn adeiladu tyrbinau gwynt mawr a {{ddiogel|safe}} iawn.";
  const plain = E.plainOf(raw);
  const s = plain.indexOf('tyrbinau gwynt');
  const w = E.wrapSelection(raw, s, s + 'tyrbinau gwynt'.length, gloss());
  assert.ok(w.raw.startsWith('Mae gwledydd yn adeiladu {{tyrbinau gwynt|wind turbines|'));
  assert.ok(w.raw.endsWith('}} mawr a {{ddiogel|safe}} iawn.'));
  assert.equal(E.plainOf(w.raw), plain); // visible text is unchanged
  // inside an existing gloss -> edit it
  const d = plain.indexOf('ddiogel');
  assert.deepEqual(E.wrapSelection(raw, d + 1, d + 4, gloss()), { edit: 0 });
  // overlapping / nesting
  assert.ok(E.wrapSelection(raw, d - 3, d + 3, gloss()).error);
  assert.ok(E.wrapSelection(raw, d - 3, d + 20, gloss()).error);
  assert.ok(E.wrapSelection(raw, 3, 3, gloss()).error);
  // literal braces are preserved through a wrap
  const esc = 'Mae \\{{yma}} a gair.';
  const p2 = E.plainOf(esc);
  const g = p2.indexOf('gair');
  const w2 = E.wrapSelection(esc, g, g + 4, { surface: 'gair', tip: 'word', entries: [], notes: [] });
  assert.equal(E.plainOf(w2.raw), p2);
  assert.ok(w2.raw.startsWith('Mae \\{{yma}} a {{gair|word}}'));
});

test('replaceGloss and removeGloss only touch the chosen gloss', () => {
  const raw = 'A {{x|1}} b {{y|2}} c.';
  assert.equal(E.replaceGloss(raw, 1, { surface: 'y', tip: 'two', entries: [], notes: [] }), 'A {{x|1}} b {{y|two}} c.');
  assert.equal(E.removeGloss(raw, 0), 'A x b {{y|2}} c.');
  assert.equal(E.glossesOf(raw).length, 2);
  assert.equal(E.plainOf(E.removeGloss(raw, 1)), E.plainOf(raw));
});

test('trimRange', () => {
  assert.deepEqual(E.trimRange('ab cd ef', 2, 6), [3, 5]);
});

test('makeZip produces a valid archive that an independent unzip accepts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const audio = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 256);
  const zip = E.makeZip([
    { name: 'my-article/article.md', data: 'Helô, Siân ŵ\n' },
    { name: 'my-article/audio.mp3', data: audio },
  ]);
  const file = join(dir, 'a.zip');
  writeFileSync(file, zip);
  const listing = execFileSync('python3', ['-I', '-c', `
import zipfile,sys
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(sorted(z.namelist())); print(z.read('my-article/article.md').decode('utf-8').strip()); print(len(z.read('my-article/audio.mp3')))
`, file]).toString();
  assert.match(listing, /my-article\/article\.md/);
  assert.match(listing, /Helô, Siân ŵ/);
  assert.match(listing, /5000/);
});

test('the preview pipeline (serialize -> parseBlocks -> renderBody) matches the build markup', () => {
  const md = read('wind-turbines', 'article.md');
  const en = read('wind-turbines', 'article.en.md');
  const { meta, items } = E.parseArticle({ md, en });
  const out = E.serialize(meta, items);
  const body = out.md.split('\n').slice(out.bodyStartLine - 1).join('\n');
  const { blocks } = L.parseBlocks(body, []);
  const enLines = items.filter((i) => i.kind === 'seg').map((i) => i.en);
  const html = R.renderBody(blocks, enLines);
  const built = readFileSync(new URL('../dist/articles/wind-turbines/index.html', import.meta.url), 'utf8');
  assert.ok(built.includes(html), 'editor preview HTML is identical to the built article body');
});
