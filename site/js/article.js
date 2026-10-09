// Article page bootstrap: tooltips, audio player, English toggle, shortcuts.
import { initPlayer } from './player.js';
import { initTooltips } from './tooltip.js';
import { store } from './util.js';
import { readSet, setRead } from './progress.js';

const text = document.getElementById('text');
const audio = document.getElementById('audio');

initTooltips(text);

let timings = null;
try {
  const el = document.getElementById('timings');
  if (el) timings = JSON.parse(el.textContent);
} catch { /* a malformed file fails the build; ignore at runtime */ }

const player = audio
  ? initPlayer({
    audio,
    segs: [...document.querySelectorAll('.seg')],
    timings,
    fallbackDuration: Number(document.body.dataset.duration) || 0,
  })
  : null;

// Chapters of a series: mark as read (kept in this browser only; also set when the audio ends)
const markBtn = document.getElementById('mark-read');
if (markBtn) {
  const slug = document.body.dataset.slug;
  const paint = (on) => markBtn.setAttribute('aria-pressed', String(on));
  markBtn.hidden = false;
  paint(readSet().has(slug));
  markBtn.addEventListener('click', () => {
    const on = markBtn.getAttribute('aria-pressed') !== 'true';
    setRead(slug, on);
    paint(on);
  });
  if (audio) audio.addEventListener('ended', () => { setRead(slug, true); paint(true); });
}

// English toggle (remembered across articles)
const enBtn = document.getElementById('en-toggle');
const hasEnglish = document.body.dataset.hasEn === 'true';
function setEnglish(on) {
  document.body.classList.toggle('show-en', on);
  for (const el of document.querySelectorAll('.seg-en')) el.hidden = !on;
  enBtn.setAttribute('aria-pressed', String(on));
  store.set('gad-show-en', on ? '1' : '0');
}
if (hasEnglish) {
  enBtn.hidden = false;
  enBtn.addEventListener('click', () => setEnglish(enBtn.getAttribute('aria-pressed') !== 'true'));
  if (store.get('gad-show-en') === '1') setEnglish(true);
}

// Keyboard shortcuts: Space play/pause, ←/→ sentence, [ ] speed, E English
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  const t = e.target;
  if (t instanceof Element && t.closest('input, select, textarea, [contenteditable]')) return;
  const onButton = t instanceof Element && t.closest('button, a');
  switch (e.key) {
    case ' ':
      if (!player || onButton) return;
      e.preventDefault();
      player.toggle();
      break;
    case 'ArrowLeft':
      if (!player?.hasSync) return;
      e.preventDefault();
      player.goPrev();
      break;
    case 'ArrowRight':
      if (!player?.hasSync) return;
      e.preventDefault();
      player.goNext();
      break;
    case '[': player?.changeSpeed(-1); break;
    case ']': player?.changeSpeed(1); break;
    case 'e':
    case 'E':
      if (hasEnglish) setEnglish(enBtn.getAttribute('aria-pressed') !== 'true');
      break;
    default:
  }
});
