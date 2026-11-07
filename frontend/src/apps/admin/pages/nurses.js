import { $, on, setHtml } from '../../../lib/dom';
import { getDb, watchDb } from '../../../lib/realtime';
import { resetPassword, setUserActive } from '../../../services/users';
import { toast } from '../../../store/uiStore';
import { mountAdminShell } from '../components/adminShell';
import { nurseRowsHtml } from '../components/nurseTable';
import { openNurseModal } from '../components/nurseModal';

const search = $('#sa-search-nurse');
const body = $('#sa-nurse-rows');

function render(db) {
  const q = search.value.trim().toLowerCase();
  const rows = db.users
    .filter((u) => u.role === 'nurse')
    .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.includes(q));
  const wardName = (id) => db.wards.find((w) => w.id === id)?.name || '—';
  setHtml(body, nurseRowsHtml(rows, wardName));
}

if (mountAdminShell()) {
  search.addEventListener('input', () => render(getDb()));
  $('#sa-btn-add-nurse').addEventListener('click', () => openNurseModal(getDb().wards));

  on(body, 'click', '[data-switch="active"]', (e, b) => {
    const u = getDb().users.find((x) => x.id === b.closest('[data-id]').dataset.id);
    const next = !u.active;
    setUserActive(u.id, next);
    toast(`Akun ${u.name} ${next ? 'diaktifkan' : 'dinonaktifkan'}`);
  });
  on(body, 'click', '[data-action="edit"]', (e, b) => {
    const db = getDb();
    const u = db.users.find((x) => x.id === b.closest('[data-id]').dataset.id);
    if (u) openNurseModal(db.wards, u);
  });
  on(body, 'click', '[data-action="reset"]', async (e, b) => {
    const u = getDb().users.find((x) => x.id === b.closest('[data-id]').dataset.id);
    b.disabled = true;
    const err = await resetPassword(u.id);
    b.disabled = false;
    if (err) return toast(err, 'error');
    toast(`Tautan reset kata sandi dikirim ke ${u.email}`, 'success');
  });

  watchDb(render);
}
