// Suggestions form: submits to Web3Forms without leaving the page.
// Without JavaScript the form still works as an ordinary POST (Web3Forms shows its own thank-you page).

const form = document.getElementById('contact-form');
const status = document.getElementById('cf-status');
const send = document.getElementById('cf-send');

// Links from an article carry ?article=<slug>: say so, and include it in the email.
const slug = new URLSearchParams(location.search).get('article');
if (slug && /^[a-z0-9-]{1,100}$/.test(slug)) {
  document.getElementById('cf-article').value = slug;
  const about = document.getElementById('cf-about');
  about.textContent = `About the article “${slug}”.`;
  about.hidden = false;
} else {
  document.getElementById('cf-article').disabled = true;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  send.disabled = true;
  status.className = 'cf-status';
  status.textContent = 'Sending…';
  try {
    const body = Object.fromEntries(new FormData(form));
    const res = await fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || `Error ${res.status}`);
    form.reset();
    status.className = 'cf-status is-ok';
    status.textContent = 'Thank you, your message has been sent. Diolch!';
  } catch (err) {
    status.className = 'cf-status is-error';
    status.textContent = `Sorry, that did not send (${err.message}). Please try again in a moment.`;
  } finally {
    send.disabled = false;
  }
});
