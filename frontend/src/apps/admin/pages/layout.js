import { $, html, on, setHtml } from '../../../lib/dom';
import { getDb, watchDb } from '../../../lib/realtime';
import { openModal } from '../../../components/ui/modal';
import { confirmModal } from '../../../components/ui/confirmModal';
import { addBed, addRoom, addWard, deleteBed, deleteRoom, deleteWard, renameRoom, renameWard } from '../../../services/rooms';
import { toast } from '../../../store/uiStore';
import { mountAdminShell } from '../components/adminShell';
import { wardListHtml } from '../components/wardList';
import { roomEditorHtml } from '../components/roomEditor';

const MODALS = {
  addWard: { id: 'sa-modal-ward', title: 'Tambah bangsal', label: 'Nama bangsal', input: 'sa-input-ward-name', save: 'sa-btn-save-ward' },
  editWard: { id: 'sa-modal-ward', title: 'Ubah nama bangsal', label: 'Nama bangsal', input: 'sa-input-ward-name', save: 'sa-btn-save-ward' },
  addRoom: { id: 'sa-modal-room', title: 'Tambah kamar', label: 'Nomor kamar', input: 'sa-input-room-number', save: 'sa-btn-save-room' },
  editRoom: { id: 'sa-modal-room', title: 'Ubah nomor kamar', label: 'Nomor kamar', input: 'sa-input-room-number', save: 'sa-btn-save-room' },
  addBed: { id: 'sa-modal-bed', title: 'Tambah kasur', label: 'Nomor kasur', input: 'sa-input-bed-number', save: 'sa-btn-save-bed' },
};

let wardId = getDb().wards[0]?.id;

const report = (err, ok) => (err ? toast(err, 'error') : ok && toast(ok, 'success'));
const currentWard = (db) => db.wards.find((w) => w.id === wardId) || db.wards[0];

function render(db) {
  const ward = currentWard(db);
  wardId = ward?.id;
  const rooms = db.rooms.filter((r) => r.wardId === ward?.id).sort((a, b) => a.number.localeCompare(b.number, 'id', { numeric: true }));
  const tabletLabel = (bed) => db.tablets.find((t) => t.id === bed.tabletId)?.label || 'belum ada tablet';

  setHtml($('#sa-ward-list'), wardListHtml(db.wards, ward?.id));
  $('#sa-layout-ward-name').textContent = ward?.name || '';
  $('#sa-btn-add-room').disabled = !ward;
  setHtml($('#sa-room-grid'), rooms.length === 0
    ? html`<p class="muted">Belum ada kamar. Tambahkan kamar pertama.</p>`
    : rooms.map((room) => roomEditorHtml(room, db.beds.filter((b) => b.roomId === room.id).sort((a, b) => a.label.localeCompare(b.label)), tabletLabel)));
}

function askText(kind, target, value = '') {
  const cfg = MODALS[kind];
  const m = openModal({
    id: cfg.id,
    title: cfg.title,
    maxWidth: 440,
    body: html`
      <form class="modal__form">
        <label class="lbl">
          ${cfg.label}
          <input id="${cfg.input}" class="fi" value="${value}" autofocus />
        </label>
        <div class="modal__actions">
          <button id="app-modal-confirm-cancel" type="button" class="btn">Batal</button>
          <button id="${cfg.save}" type="submit" class="btn btn--primary">Simpan</button>
        </div>
      </form>`,
  });
  m.root.querySelector('#app-modal-confirm-cancel').addEventListener('click', m.dismiss);
  m.root.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = m.root.querySelector('input').value.trim();
    if (!v) return;
    if (kind === 'addWard') addWard(v);
    if (kind === 'editWard') renameWard(target.id, v);
    if (kind === 'addRoom') report(addRoom(wardId, v));
    if (kind === 'editRoom') renameRoom(target.id, v);
    if (kind === 'addBed') report(addBed(target.id, v));
    m.dismiss();
  });
}

const ask = (title, body, run) => confirmModal({ title, body, okText: 'Ya, hapus', onOk: run });

if (mountAdminShell()) {
  $('#sa-btn-add-ward').addEventListener('click', () => askText('addWard'));
  $('#sa-btn-add-room').addEventListener('click', () => askText('addRoom'));

  on($('#sa-ward-list'), 'click', '[data-action]', (e, b) => {
    const w = getDb().wards.find((x) => x.id === b.dataset.id);
    if (!w) return;
    if (b.dataset.action === 'select') {
      wardId = w.id;
      render(getDb());
    }
    if (b.dataset.action === 'edit') askText('editWard', w, w.name);
    if (b.dataset.action === 'delete') {
      ask(`Hapus bangsal ${w.name}?`, 'Semua kamar dan kasur di bangsal ini ikut terhapus.', () => report(deleteWard(w.id), 'Bangsal dihapus'));
    }
  });

  on($('#sa-room-grid'), 'click', '[data-action]', (e, b) => {
    const db = getDb();
    const id = b.dataset.id;
    const room = db.rooms.find((r) => r.id === id);
    const bed = db.beds.find((x) => x.id === id);
    switch (b.dataset.action) {
      case 'edit-room':
        askText('editRoom', room, room.number);
        break;
      case 'delete-room':
        ask(`Hapus Kamar ${room.number}?`, 'Kasur di kamar ini ikut terhapus.', () => report(deleteRoom(room.id), 'Kamar dihapus'));
        break;
      case 'add-bed':
        askText('addBed', room);
        break;
      case 'delete-bed':
        ask(`Hapus Kasur ${bed.label}?`, 'Tablet di kasur ini dilepas.', () => report(deleteBed(bed.id), 'Kasur dihapus'));
        break;
      default:
    }
  });

  watchDb(render);
}
