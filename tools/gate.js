// Password gate for the authoring pages. A static site has no server to check a password, so this runs
// in the browser: it keeps casual visitors out, it is not a vault (the tools hold nothing secret).
// The build writes tools/gate-config.js with a salted PBKDF2 hash of the AUTHORING_PASSWORD secret;
// the password itself is never in the site. With no config (a local clone) the pages are open.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.GadGate = api; api.boot(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  const KEY = 'gad-auth';
  const ITERATIONS = 200000;
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

  async function derive(password, saltHex, iterations) {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle) throw new Error('This browser cannot check passwords on an insecure (http) page.');
    const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
    const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return hex(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
  }

  const store = (win, fn) => { try { return fn(win.sessionStorage); } catch { return null; } };
  const isUnlocked = (win, cfg) => !cfg || store(win, (s) => s.getItem(KEY)) === cfg.hash;

  function showPrompt(win, cfg) {
    const doc = win.document;
    const hide = doc.createElement('style');
    hide.textContent = 'body > *:not(#gad-gate){display:none!important}'
      + '#gad-gate{min-height:100vh;display:grid;place-items:center;padding:16px;background:#fbf8f1;color:#1d2a24;font:1rem/1.5 system-ui,sans-serif}'
      + '#gad-gate form{width:100%;max-width:22rem;background:#fff;border:1px solid #ddd6c6;border-radius:12px;padding:1.5rem}'
      + '#gad-gate h1{font:700 1.3rem/1.2 Georgia,serif;margin:0 0 .25rem}#gad-gate p{margin:.25rem 0 1rem;color:#56635b}'
      + '#gad-gate input,#gad-gate button{font:inherit;width:100%;padding:.55rem .7rem;border-radius:8px;border:1px solid #ddd6c6;box-sizing:border-box}'
      + '#gad-gate button{margin-top:.6rem;background:#1f6b45;color:#fff;border-color:#1f6b45;cursor:pointer}'
      + '#gad-gate .err{color:#b3262d;min-height:1.5rem;margin:.5rem 0 0}'
      + '@media (prefers-color-scheme:dark){#gad-gate{background:#111915;color:#eaf0ea}#gad-gate form{background:#19231e;border-color:#2b3a32}'
      + '#gad-gate p{color:#a6b5ab}#gad-gate input{background:#111915;color:#eaf0ea;border-color:#2b3a32}#gad-gate .err{color:#ff8a8f}'
      + '#gad-gate button{background:#5fc58d;color:#0a1710;border-color:#5fc58d}}';
    doc.head.appendChild(hide);

    const wrap = doc.createElement('div');
    wrap.id = 'gad-gate';
    const form = doc.createElement('form');
    const h1 = doc.createElement('h1'); h1.textContent = 'Authoring';
    const p = doc.createElement('p'); p.textContent = 'Enter the password to open the authoring tools.';
    const label = doc.createElement('label'); label.className = 'sr'; label.htmlFor = 'gad-pw';
    label.style.cssText = 'position:absolute;left:-9999px'; label.textContent = 'Password';
    const input = doc.createElement('input');
    Object.assign(input, { type: 'password', id: 'gad-pw', autocomplete: 'current-password', required: true });
    const btn = doc.createElement('button'); btn.type = 'submit'; btn.textContent = 'Unlock';
    const err = doc.createElement('p'); err.className = 'err'; err.setAttribute('role', 'alert');
    form.append(h1, p, label, input, btn, err);
    wrap.appendChild(form);
    const mount = () => { doc.body.appendChild(wrap); input.focus(); };
    if (doc.body) mount(); else doc.addEventListener('DOMContentLoaded', mount);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true; err.textContent = '';
      try {
        const got = await derive(input.value, cfg.salt, cfg.iterations);
        if (got === cfg.hash) { store(win, (s) => s.setItem(KEY, got)); win.location.reload(); return; }
        err.textContent = 'That password is not right.';
        input.select();
      } catch (ex) { err.textContent = ex.message; }
      btn.disabled = false;
    });
  }

  function boot(win) {
    const cfg = win.GAD_GATE || null;
    win.GadGate.locked = !!cfg;
    if (!isUnlocked(win, cfg)) showPrompt(win, cfg);
    win.GadGate.lock = () => { store(win, (s) => s.removeItem(KEY)); win.location.reload(); };
  }

  return { derive, isUnlocked, boot, ITERATIONS, KEY };
});
