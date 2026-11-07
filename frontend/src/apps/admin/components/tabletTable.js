import { html } from '../../../lib/dom';
import { STATUS_TEXT } from '../../../services/tablets';
import { relativeTime } from '../../../utils/formatTime';

export function tabletRowsHtml(rows, variant = 'status') {
  if (rows.length === 0) return html`<tr><td colspan="5" class="muted">Tidak ada tablet di filter ini.</td></tr>`;
  return rows.map((r) => html`
    <tr id="${variant === 'manage' ? `sa-tablet-${r.id}` : `sa-tablet-row-${r.id}`}">
      <td class="tbl__strong">${r.label}</td>
      ${variant === 'manage' ? html`<td class="mono tbl__mono">${r.deviceId}</td>` : ''}
      <td>${r.bedLabel}</td>
      <td><span class="tablet-status" data-status="${r.status}"><span class="dot"></span>${STATUS_TEXT[r.status]}</span></td>
      ${variant === 'status' ? html`
        <td>
          <span class="battery" data-level="${r.battery}" data-low="${String(r.battery < 20)}">
            <span class="battery__box"><span class="battery__fill" style="width:${Math.round(r.battery * 0.42)}px"></span></span>
            ${r.battery}%
          </span>
        </td>
        <td class="muted">${relativeTime(r.lastSeen)}</td>` : ''}
      ${variant === 'manage' ? html`
        <td>
          <button id="sa-btn-disable-${r.id}" type="button" class="btn btn--sm ${r.disabled ? '' : 'btn--danger'}" data-action="toggle" data-id="${r.id}">
            ${r.disabled ? 'Aktifkan lagi' : 'Nonaktifkan'}
          </button>
        </td>` : ''}
    </tr>`);
}
