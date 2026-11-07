import { $, $$, html, setHtml } from '../../../lib/dom';
import { getDb } from '../../../lib/realtime';
import { uid } from '../../../lib/mockDb';
import { bindTabs } from '../../../components/ui/tabs';
import { saveSchedules } from '../../../services/schedules';
import { toast } from '../../../store/uiStore';
import { mountNurseShell } from '../components/nurseShell';
import { scheduleRowHtml } from '../components/scheduleRow';

const shell = mountNurseShell({ onWardChange: () => resetRoom() });

let scope = 'ward';
let roomId = '';
let rows = [];

const rowsBox = $('#nr-schedule-rows');
const roomSelect = $('#nr-select-schedule-room');

const roomsOfWard = () => getDb().rooms.filter((r) => r.wardId === shell.wardId);

function setDirty(dirty) {
  $('#nr-schedule-dirty').hidden = !dirty;
}

function renderRows() {
  setHtml(rowsBox, rows.map(scheduleRowHtml));
  $('#nr-schedule-room-info').hidden = !(scope === 'room' && rows.length === 0);
}

function load() {
  const db = getDb();
  const saved = db.schedules.filter((s) =>
    scope === 'ward' ? s.scope === 'ward' && s.wardId === shell.wardId : s.scope === 'room' && s.roomId === roomId,
  );
  rows = saved.map((s) => ({ ...s })).sort((a, b) => a.time.localeCompare(b.time));
  $$('#nr-select-schedule-scope .seg').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === scope)));
  $('#nr-schedule-room-field').hidden = scope !== 'room';
  setDirty(false);
  renderRows();
}

function resetRoom() {
  const rooms = roomsOfWard();
  roomId = rooms[0]?.id || '';
  setHtml(roomSelect, rooms.map((r) => html`<option value="${r.id}">Kamar ${r.number}</option>`));
  roomSelect.value = roomId;
  load();
}

if (shell) {
  bindTabs($('#nr-select-schedule-scope'), (value) => {
    scope = value;
    load();
  });

  roomSelect.addEventListener('change', () => {
    roomId = roomSelect.value;
    load();
  });

  rowsBox.addEventListener('change', (e) => {
    const field = e.target.dataset.field;
    const row = rows.find((r) => r.id === e.target.closest('[data-row]')?.dataset.row);
    if (!row || !field) return;
    row[field] = e.target.value;
    setDirty(true);
  });

  rowsBox.addEventListener('click', (e) => {
    const rowEl = e.target.closest('[data-row]');
    if (!rowEl) return;
    const row = rows.find((r) => r.id === rowEl.dataset.row);
    if (e.target.closest('[data-switch="active"]')) {
      row.active = !row.active;
      setDirty(true);
      renderRows();
    }
    if (e.target.closest('[data-field="delete"]')) {
      rows = rows.filter((r) => r.id !== row.id);
      setDirty(true);
      renderRows();
    }
  });

  $('#nr-btn-add-schedule').addEventListener('click', () => {
    rows = [...rows, { id: uid('s'), time: '15:00', type: 'Camilan', active: true }];
    setDirty(true);
    renderRows();
  });

  $('#nr-btn-save-schedule').addEventListener('click', () => {
    saveSchedules({ wardId: shell.wardId, scope, roomId, rows });
    setDirty(false);
    toast('Jadwal disimpan dan dikirim ke tablet', 'success');
  });

  resetRoom();
}
