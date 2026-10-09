// Series page: show which chapters this reader has finished and where to continue.
import { readSet } from './progress.js';

const items = [...document.querySelectorAll('.chapters li')];
const read = readSet();
let done = 0;
for (const li of items) {
  if (!read.has(li.dataset.slug)) continue;
  done++;
  li.classList.add('is-read');
  const mark = li.querySelector('.read-mark');
  if (mark) mark.textContent = 'Read';
}

if (done) {
  const progress = document.getElementById('series-progress');
  if (progress) progress.textContent = `· ${done} of ${items.length} read`;
  const next = items.find((li) => !read.has(li.dataset.slug));
  const start = document.getElementById('series-start');
  const target = next || items[0];
  if (start && target) {
    start.href = target.querySelector('a').getAttribute('href');
    const label = target.querySelector('.ch-label').textContent;
    start.textContent = next ? `Continue with ${label}` : 'You have read every chapter. Start again?';
  }
}
