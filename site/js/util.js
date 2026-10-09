// Shared helpers. fold() must match fold() in scripts/build.mjs.

export const LEVELS = ['mynediad', 'sylfaen', 'canolradd', 'uwch', 'hyfedredd'];

/** Lowercase and strip diacritics so "wy" finds "ŵy" and "cymraeg" finds "Cymraeg". */
export const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Read ?q=…&level=a,b&topic=x,y&series=s&type=t from the address bar. */
export function readQuery() {
  const p = new URLSearchParams(location.search);
  const list = (k) => (p.get(k) || '').split(',').map((v) => v.trim()).filter(Boolean);
  return { q: p.get('q') || '', levels: list('level'), topics: list('topic'), series: list('series'), types: list('type') };
}

/** Reflect filter state in the URL. `push` adds a history entry (chips); otherwise replaces (typing). */
export function writeQuery({ q, levels, topics, series, types }, push) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (levels.length) p.set('level', levels.join(','));
  if (topics.length) p.set('topic', topics.join(','));
  if (series && series.length) p.set('series', series.join(','));
  if (types && types.length) p.set('type', types.join(','));
  const qs = p.toString().replace(/%2C/g, ',');
  const url = qs ? `?${qs}` : location.pathname;
  try {
    history[push ? 'pushState' : 'replaceState'](null, '', url);
  } catch { /* sandboxed or file:// contexts */ }
}

export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
};
