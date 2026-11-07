import { el, html } from '../../lib/dom';

export function openModal({ id, title, subtitle, body, maxWidth = 480, onClose }) {
  const backdrop = el(html`
    <div class="modal-backdrop">
      <div id="${id}" class="modal" role="dialog" aria-modal="true" aria-labelledby="${id}-title" style="max-width:${maxWidth}px">
        <div class="modal__head">
          <div>
            ${subtitle ? html`<span class="cap">${subtitle}</span>` : ''}
            <h2 id="${id}-title" class="modal__title">${title}</h2>
          </div>
          <button id="app-modal-close" type="button" class="btn btn--ghost btn--icon" aria-label="Tutup">×</button>
        </div>
        <div class="modal__body">${body}</div>
      </div>
    </div>`);

  const onKey = (e) => e.key === 'Escape' && api.dismiss();
  const api = {
    root: backdrop.querySelector('.modal__body'),
    close() {
      window.removeEventListener('keydown', onKey);
      backdrop.remove();
    },
    dismiss() {
      api.close();
      onClose?.();
    },
  };

  window.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (e) => e.target === backdrop && api.dismiss());
  backdrop.querySelector('#app-modal-close').addEventListener('click', api.dismiss);
  document.body.appendChild(backdrop);
  backdrop.querySelector('[autofocus]')?.focus();
  return api;
}
