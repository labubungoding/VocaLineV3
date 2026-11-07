import { html } from '../../lib/dom';
import { openModal } from './modal';

export function confirmModal({ id = 'app-modal-confirm', title, body, okText = 'Ya', okId = 'app-modal-confirm-ok', danger = true, onOk, onCancel }) {
  const m = openModal({
    id,
    title,
    maxWidth: 460,
    onClose: onCancel,
    body: html`
      <p id="app-modal-confirm-body" class="muted confirm__body">${body}</p>
      <div class="modal__actions">
        <button id="app-modal-confirm-cancel" type="button" class="btn">Batal</button>
        <button id="${okId}" type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}">${okText}</button>
      </div>`,
  });
  m.root.querySelector('#app-modal-confirm-cancel').onclick = m.dismiss;
  m.root.querySelector(`#${okId}`).onclick = () => {
    m.close();
    onOk();
  };
  return m;
}
