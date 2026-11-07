import { el, html } from '../../lib/dom';

function container() {
  let c = document.getElementById('app-toast-container');
  if (!c) {
    c = el(html`<div id="app-toast-container" class="toast-container" role="status" aria-live="polite"></div>`);
    document.body.appendChild(c);
  }
  return c;
}

export function showToast(text, kind = 'info', ms = 4000) {
  const t = el(html`<div class="toast toast--${kind}">${text}</div>`);
  container().appendChild(t);
  setTimeout(() => t.remove(), ms);
}
