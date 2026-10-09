// Custom audio bar + sentence sync. Falls back to the native <audio controls>
// (already in the page) if this module never runs.
import { fmtTime } from './util.js';

const SPEEDS = [0.6, 0.75, 1, 1.25];
const EPS = 0.05; // guards against float rounding when seeking exactly to a start time

export function initPlayer({ audio, segs, timings, fallbackDuration }) {
  const $ = (id) => document.getElementById(id);
  const bar = $('player');
  const playBtn = $('p-play');
  const prevBtn = $('p-prev');
  const nextBtn = $('p-next');
  const seek = $('p-seek');
  const cur = $('p-cur');
  const dur = $('p-dur');
  const speed = $('p-speed');
  const followBtn = $('p-follow');

  const sync = Array.isArray(timings) && timings.length === segs.length && segs.length > 0;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  audio.removeAttribute('controls');
  bar.hidden = false;
  document.body.classList.add('has-player');
  if (sync) document.body.classList.add('synced');
  prevBtn.disabled = nextBtn.disabled = !sync;

  let index = -1;
  let following = true;
  let scrubbing = false;
  let raf = 0;

  const indexAt = (t) => {
    let lo = 0;
    let hi = timings.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (timings[mid] <= t + EPS) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  };

  function setIndex(i) {
    if (i === index) return;
    if (segs[index]) { segs[index].classList.remove('is-current'); segs[index].removeAttribute('aria-current'); }
    index = i;
    const el = segs[i];
    el.classList.add('is-current');
    el.setAttribute('aria-current', 'true');
    if (following) el.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }

  function setDuration() {
    const d = Number.isFinite(audio.duration) ? audio.duration : fallbackDuration;
    if (!d) return;
    seek.max = d;
    dur.textContent = fmtTime(d);
  }

  function render() {
    const t = audio.currentTime;
    if (!scrubbing) seek.value = t;
    cur.textContent = fmtTime(t);
    if (sync) setIndex(indexAt(t));
  }

  function loop() {
    render();
    if (!audio.paused && !audio.ended) raf = requestAnimationFrame(loop);
  }

  function updateButton() {
    const playing = !audio.paused && !audio.ended;
    playBtn.classList.toggle('is-playing', playing);
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  function toggle() {
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function startFollowing() {
    following = true;
    followBtn.hidden = true;
    segs[index]?.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }

  function jump(t) {
    following = true;
    followBtn.hidden = true;
    audio.currentTime = t;
    render();
  }

  function goPrev() {
    if (!sync) return;
    const i = indexAt(audio.currentTime);
    jump(audio.currentTime - timings[i] > 1 || i === 0 ? timings[i] : timings[i - 1]);
  }

  function goNext() {
    if (!sync) return;
    const i = indexAt(audio.currentTime);
    if (i + 1 < timings.length) jump(timings[i + 1]);
  }

  function changeSpeed(dir) {
    const i = SPEEDS.indexOf(Number(speed.value));
    const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + dir))];
    speed.value = String(next);
    audio.playbackRate = next;
  }

  // transport
  playBtn.addEventListener('click', toggle);
  prevBtn.addEventListener('click', goPrev);
  nextBtn.addEventListener('click', goNext);
  speed.addEventListener('change', () => { audio.playbackRate = Number(speed.value); });
  audio.playbackRate = Number(speed.value);

  seek.addEventListener('pointerdown', () => { scrubbing = true; });
  window.addEventListener('pointerup', () => { scrubbing = false; });
  seek.addEventListener('input', () => { audio.currentTime = Number(seek.value); render(); });

  audio.addEventListener('play', () => { updateButton(); cancelAnimationFrame(raf); loop(); });
  for (const ev of ['pause', 'ended']) audio.addEventListener(ev, () => { updateButton(); render(); });
  for (const ev of ['timeupdate', 'seeked']) audio.addEventListener(ev, render);
  for (const ev of ['loadedmetadata', 'durationchange']) audio.addEventListener(ev, setDuration);
  setDuration();
  updateButton();
  if (sync) setIndex(0);

  // click a sentence to seek and play (glossed words only show their tooltip)
  if (sync) {
    document.getElementById('text').addEventListener('click', (e) => {
      if (!(e.target instanceof Element) || e.target.closest('.gloss')) return;
      const seg = e.target.closest('.seg');
      if (!seg || String(window.getSelection()).length) return;
      jump(timings[Number(seg.dataset.i)]);
      audio.play().catch(() => {});
    });

    // stop auto-following as soon as the reader scrolls by hand
    const stopFollowing = () => { if (following) { following = false; followBtn.hidden = false; } };
    window.addEventListener('wheel', stopFollowing, { passive: true });
    window.addEventListener('touchmove', stopFollowing, { passive: true });
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t instanceof Element && t.closest('input, select, textarea')) return;
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key)) stopFollowing();
    });
    followBtn.addEventListener('click', startFollowing);
  }

  return { toggle, goPrev, goNext, changeSpeed, hasSync: sync };
}
