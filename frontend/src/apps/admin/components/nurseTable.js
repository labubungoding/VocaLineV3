import { html } from '../../../lib/dom';
import { switchHtml } from '../../../components/ui/switch';

export function nurseRowsHtml(rows, wardName) {
  if (rows.length === 0) return html`<tr><td colspan="5" class="muted">Tidak ada perawat yang cocok.</td></tr>`;
  return rows.map((u) => html`
    <tr id="sa-nurse-${u.id}" class="nurse-row" data-id="${u.id}" data-active="${String(u.active)}">
      <td class="tbl__strong">${u.name}</td>
      <td>${u.email}</td>
      <td>${wardName(u.wardId)}</td>
      <td>${switchHtml({ id: `sa-toggle-nurse-${u.id}`, label: 'Akun aktif', checked: u.active, data: 'active' })}</td>
      <td>
        <span class="nurse-row__actions">
          <button id="sa-btn-edit-nurse-${u.id}" type="button" class="btn btn--sm" data-action="edit">Edit</button>
          <button id="sa-btn-reset-password-${u.id}" type="button" class="btn btn--sm" data-action="reset">Reset kata sandi</button>
        </span>
      </td>
    </tr>`);
}
