import { el, html } from '../../lib/dom';

export function openDrawer({ id, onClose }) {
  const backdrop = el(html`<div class="drawer-backdrop"><aside id="${id}" class="drawer" role="dialog" aria-modal="true"></aside></div>`);
  const onKey = (e) => e.key === 'Escape' && api.dismiss();
  const api = {
    root: backdrop.querySelector('aside'),
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
  document.body.appendChild(backdrop);
  return api;
}
