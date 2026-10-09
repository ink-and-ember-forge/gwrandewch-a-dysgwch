#!/usr/bin/env node
// Checks article.md / article.en.md formatting. Report-only: never edits files.
//
//   node scripts/lint.mjs                 check every article
//   node scripts/lint.mjs <slug|path>...  check specific articles (folder, slug, or article.md path)
//   --align    also print Welsh and English side by side
//   --strict   exit non-zero on warnings too (errors always fail)
//   --quiet    hide info-level notes
//
// Rules live in tools/lint-core.js, which the browser checker (tools/check.html) also uses.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content', 'articles');
const { analyse, plainText } = createRequire(import.meta.url)('../tools/lint-core.js');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const targets = args.filter((a) => !a.startsWith('--'));
for (const f of flags) {
  if (!['--align', '--strict', '--quiet', '--help'].includes(f)) { console.error(`Unknown option ${f}`); process.exit(2); }
}
if (flags.has('--help')) {
  console.log('Usage: node scripts/lint.mjs [--align] [--strict] [--quiet] [slug|folder|article.md ...]');
  process.exit(0);
}

const IN_ACTIONS = !!process.env.GITHUB_ACTIONS;
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const STYLE = { error: (s) => paint(31, s), warn: (s) => paint(33, s), info: (s) => paint(36, s), dim: (s) => paint(2, s), bold: (s) => paint(1, s) };

function resolveFolder(t) {
  const p = resolve(t);
  if (existsSync(p) && statSync(p).isFile()) return dirname(p);
  if (existsSync(p) && statSync(p).isDirectory()) return p;
  return join(CONTENT, t);
}

const folders = targets.length
  ? targets.map(resolveFolder)
  : readdirSync(CONTENT).filter((n) => !n.startsWith('.') && statSync(join(CONTENT, n)).isDirectory()).sort().map((n) => join(CONTENT, n));

const rel = (p) => p.replace(`${ROOT}/`, '');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

function printAlignment(r) {
  const width = Math.max(20, Math.floor(((process.stdout.columns || 100) - 12) / 2));
  console.log(STYLE.dim(`\n  ${'#'.padStart(3)}  ${clip('Welsh (article.md)', width)}  ${clip('English (article.en.md)', width)}`));
  const n = Math.max(r.counts.cy, r.counts.en);
  for (let i = 0; i < n; i++) {
    const cy = r.cy.segs[i];
    const en = r.en?.segs[i];
    for (const h of r.cy.headings.filter((x) => x.beforeIndex === i)) console.log(STYLE.bold(`       ## ${h.text}`));
    if (i > 0 && cy && r.cy.segs[i - 1] && cy.para !== r.cy.segs[i - 1].para) console.log('');
    const missing = STYLE.error(clip('— missing —', width));
    console.log(`  ${String(i + 1).padStart(3)}  ${cy ? clip(plainText(cy.text), width) : missing}  ${en ? clip(en.text, width) : missing}`);
  }
}

let nErr = 0;
let nWarn = 0;
let nInfo = 0;
let checked = 0;

for (const dir of folders) {
  const mdPath = join(dir, 'article.md');
  const enPath = join(dir, 'article.en.md');
  if (!existsSync(mdPath)) { console.error(STYLE.error(`${rel(dir)}: no article.md`)); nErr++; continue; }
  checked++;
  const r = analyse({
    md: readFileSync(mdPath, 'utf8'),
    en: existsSync(enPath) ? readFileSync(enPath, 'utf8') : null,
  });
  const draft = r.meta?.draft === 'true';
  const issues = r.issues
    .map((i) => (draft && i.severity === 'error' ? { ...i, severity: 'warn' } : i))
    .filter((i) => !(flags.has('--quiet') && i.severity === 'info'));

  console.log(`\n${STYLE.bold(rel(dir))}${draft ? STYLE.dim('  (draft: errors shown as warnings)') : ''}  ${STYLE.dim(`${r.counts.cy} Welsh line(s)${r.hasEnglish ? `, ${r.counts.en} English` : ', no English file'}`)}`);
  if (!issues.length) console.log(`  ${paint(32, '✓')} no problems`);
  for (const i of issues) {
    const file = rel(join(dir, i.file));
    console.log(`  ${file}:${i.line}  ${STYLE[i.severity](i.severity.padEnd(5))}  ${STYLE.dim(`[${i.rule}]`)} ${i.message}`);
    if (IN_ACTIONS && i.severity !== 'info') {
      const level = i.severity === 'error' ? 'error' : 'warning';
      console.log(`::${level} file=${file},line=${i.line},title=${i.rule}::${i.message.replace(/\n/g, ' ')}`);
    }
    if (i.severity === 'error') nErr++;
    else if (i.severity === 'warn') nWarn++;
    else nInfo++;
  }
  if (flags.has('--align') && r.hasEnglish && r.cy) printAlignment(r);
}

console.log(`\nChecked ${checked} article(s): ${nErr} error(s), ${nWarn} warning(s), ${nInfo} note(s).`);
if (nErr || (flags.has('--strict') && nWarn)) process.exit(1);
