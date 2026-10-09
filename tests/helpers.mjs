import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Shared by the tests that build a throwaway site: the real templates and tools, content made here.
export const REPO = resolve(new URL('..', import.meta.url).pathname);
export const MP3 = Buffer.concat(Array.from({ length: 400 }, () => Buffer.concat([Buffer.from([0xff, 0xfb, 0x50, 0xc0]), Buffer.alloc(204)])));

// A throwaway site: the real templates and tools, with content made here.
export function site(articles, series = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gad-'));
  symlinkSync(join(REPO, 'site'), join(root, 'site'));
  symlinkSync(join(REPO, 'tools'), join(root, 'tools'));
  for (const [slug, a] of Object.entries(articles)) {
    const dir = join(root, 'content', 'articles', slug);
    mkdirSync(dir, { recursive: true });
    const fm = { title: slug.toUpperCase(), level: 'sylfaen', type: 'story', date: '2026-01-01', summary: 'S', audio: 'audio.mp3', ...a.fm };
    const head = Object.entries(fm).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`).join('\n');
    writeFileSync(join(dir, 'article.md'), `---\n${head}\n---\n\n${a.body || 'Un {{gair|word}}.'}\n`);
    writeFileSync(join(dir, 'audio.mp3'), MP3);
  }
  if (Object.keys(series).length) mkdirSync(join(root, 'content', 'series'), { recursive: true });
  for (const [slug, text] of Object.entries(series)) writeFileSync(join(root, 'content', 'series', `${slug}.md`), text);
  return root;
}
export const build = (root) => spawnSync('node', [join(REPO, 'scripts', 'build.mjs')], { env: { ...process.env, GAD_ROOT: root }, encoding: 'utf8' });
export const page = (root, ...p) => readFileSync(join(root, 'dist', ...p), 'utf8');
