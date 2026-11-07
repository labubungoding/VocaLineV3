import { html } from '../../../lib/dom';
import { switchHtml } from '../../../components/ui/switch';

export const MEAL_TYPES = ['Sarapan', 'Makan siang', 'Makan malam', 'Camilan', 'Minum obat'];

export function scheduleRowHtml(row) {
  return html`
    <div class="schedule-row" data-row="${row.id}">
      <input id="nr-input-time-${row.id}" class="fi" type="time" aria-label="Jam" value="${row.time}" data-field="time" />
      <select id="nr-select-type-${row.id}" class="fi" aria-label="Jenis" data-field="type">
        ${MEAL_TYPES.map((t) => html`<option ${t === row.type ? 'selected' : ''}>${t}</option>`)}
      </select>
      ${switchHtml({ id: `nr-toggle-schedule-${row.id}`, label: 'Aktif', checked: row.active, data: 'active' })}
      <button id="nr-btn-delete-schedule-${row.id}" type="button" class="btn btn--icon btn--danger" aria-label="Hapus jadwal" data-field="delete">×</button>
    </div>`;
}
