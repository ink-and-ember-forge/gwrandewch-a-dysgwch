import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { site, REPO, page } from './helpers.mjs';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const G = require('../tools/gate.js');

const buildWith = (root, env) =>
  spawnSync('node', [join(REPO, 'scripts', 'build.mjs')], { env: { ...process.env, GAD_ROOT: root, AUTHORING_PASSWORD: '', ...env }, encoding: 'utf8' });

test('no password set: the shipped config is open', () => {
  const root = site({ a: {} });
  const r = buildWith(root, {});
  assert.equal(r.status, 0, r.stderr);
  assert.match(page(root, 'tools', 'gate-config.js'), /GAD_GATE = null/);
});

test('password set: config holds a salted hash that the browser algorithm reproduces, not the password', async () => {
  const root = site({ a: {} });
  const r = buildWith(root, { AUTHORING_PASSWORD: 'correct horse' });
  assert.equal(r.status, 0, r.stderr);
  const cfg = page(root, 'tools', 'gate-config.js');
  assert.ok(!cfg.includes('correct horse'));
  const { salt, iterations, hash } = JSON.parse(cfg.match(/= (\{.*\});/)[1]);
  assert.equal(await G.derive('correct horse', salt, iterations), hash);
  assert.notEqual(await G.derive('wrong', salt, iterations), hash);
});

test('the source tools/gate-config.js stays open and is not changed by a build', () => {
  const root = site({ a: {} });
  buildWith(root, { AUTHORING_PASSWORD: 'x' });
  assert.match(require('node:fs').readFileSync(join(REPO, 'tools', 'gate-config.js'), 'utf8'), /GAD_GATE = null/);
});

test('every authoring page loads the gate, the dashboard links the three tools, and the site links the dashboard once', () => {
  const root = site({ a: {} });
  buildWith(root, {});
  for (const f of ['index.html', 'editor.html', 'check.html', 'sync-tool.html']) {
    const html = page(root, 'tools', f);
    assert.match(html, /<script src="gate-config\.js"><\/script>\s*<script src="gate\.js"><\/script>/, f);
    assert.match(html, /noindex/, f);
  }
  const dash = page(root, 'tools', 'index.html');
  for (const f of ['editor.html', 'sync-tool.html', 'check.html']) assert.ok(dash.includes(`href="${f}"`), f);
  const home = page(root, 'index.html');
  assert.equal((home.match(/href="tools\//g) || []).length, 1);
  assert.ok(existsSync(join(root, 'dist', 'tools', 'gate.js')));
});

test('isUnlocked: open without config, locked until the stored hash matches', () => {
  const store = {};
  const win = { sessionStorage: { getItem: (k) => store[k] ?? null } };
  assert.equal(G.isUnlocked(win, null), true);
  assert.equal(G.isUnlocked(win, { hash: 'abc' }), false);
  store[G.KEY] = 'abc';
  assert.equal(G.isUnlocked(win, { hash: 'abc' }), true);
  store[G.KEY] = 'old';
  assert.equal(G.isUnlocked(win, { hash: 'abc' }), false);
});
