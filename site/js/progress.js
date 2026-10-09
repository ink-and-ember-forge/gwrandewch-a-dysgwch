// Which articles this reader has finished. Stored only in this browser (no accounts).
import { store } from './util.js';

const KEY = 'gad-read';

export function readSet() {
  try {
    const v = JSON.parse(store.get(KEY) || '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function setRead(slug, on) {
  const s = readSet();
  if (on) s.add(slug); else s.delete(slug);
  store.set(KEY, JSON.stringify([...s]));
  return s;
}
