import { html } from '../../lib/dom';

export function emptyStateHtml({ id, title, text }) {
  return html`
    <div id="${id}" class="card empty-state">
      <b class="empty-state__title">${title}</b>
      ${text ? html`<span class="muted empty-state__text">${text}</span>` : ''}
    </div>`;
}
