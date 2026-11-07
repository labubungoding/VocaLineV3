import { $, $$, html, setHtml } from '../../../lib/dom';
import { getDb, watchDb } from '../../../lib/realtime';
import { tabletStatus } from '../../../services/tablets';
import { bedShort } from '../../../services/rooms';
import { markSetupComplete } from '../../../services/settings';
import { toast } from '../../../store/uiStore';
import { mountAdminShell } from '../components/adminShell';

const STATUS_TEXT = { ready: 'Siap', fail: 'Perlu dicek perawat', pending: 'Menunggu perawat' };
let step = 3;

function pairingRows(db) {
  return db.beds.map((bed) => {
    const tablet = db.tablets.find((t) => t.id === bed.tabletId);
    const cmd = tablet && db.commands.find((c) => c.deviceId === tablet.deviceId);
    let status = 'ready';
    let label = tablet?.label;
    if (!tablet) {
      status = 'pending';
      label = 'belum ada tablet';
    } else if (tabletStatus(tablet) === 'offline') {
      status = 'fail';
      label = `${tablet.label} · offline`;
    } else if (cmd?.status === 'fail') {
      status = 'fail';
      label = `${tablet.label} · uji ${cmd.type} gagal`;
    }
    return { bed, status, label };
  });
}

function render(db) {
  $$('#sa-setup-stepper li').forEach((li) => {
    const n = Number(li.dataset.step);
    li.dataset.state = n < step ? 'done' : n === step ? 'current' : 'todo';
    const btn = li.querySelector('button');
    if (n === step) btn.setAttribute('aria-current', 'step');
    else btn.removeAttribute('aria-current');
  });
  $$('[data-panel]').forEach((p) => {
    p.hidden = Number(p.dataset.panel) !== step;
  });

  const counts = { wards: db.wards.length, rooms: db.rooms.length, beds: db.beds.length, nurses: db.users.filter((u) => u.role === 'nurse' && u.active).length };
  $$('[data-count]').forEach((s) => {
    s.textContent = counts[s.dataset.count];
  });

  const rows = pairingRows(db);
  const ready = rows.filter((r) => r.status === 'ready').length;
  const allReady = rows.length > 0 && ready === rows.length;
  $('.progress__bar').style.width = `${(ready / Math.max(1, rows.length)) * 100}%`;
  $('#sa-pairing-progress-text').textContent = `${ready} dari ${rows.length} kasur siap`;
  setHtml($('#sa-pairing-rows'), rows.map(({ bed, status, label }) => html`
    <div id="sa-pairing-row-${bed.id}" class="pairing-row" data-status="${status}">
      <b class="pairing-row__bed">Kamar ${bedShort(db, bed.id)}</b>
      <span class="muted pairing-row__label">${label}</span>
      <span class="pairing-row__status">${STATUS_TEXT[status]}</span>
    </div>`));

  $('#sa-setup-done').hidden = !db.setupComplete;
  $('#sa-btn-setup-prev').disabled = step === 1;
  $('#sa-btn-setup-next').disabled = step === 3;
  const complete = $('#sa-btn-setup-complete');
  complete.disabled = !allReady || db.setupComplete;
  complete.title = allReady ? '' : 'Semua kasur harus siap dulu';
}

const goTo = (n) => {
  step = Math.min(3, Math.max(1, n));
  render(getDb());
};

if (mountAdminShell()) {
  $('#sa-setup-stepper').addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (b) goTo(Number(b.dataset.goto));
  });
  $('#sa-btn-setup-prev').addEventListener('click', () => goTo(step - 1));
  $('#sa-btn-setup-next').addEventListener('click', () => goTo(step + 1));
  $('#sa-btn-setup-complete').addEventListener('click', () => {
    markSetupComplete();
    toast('Sistem ditandai siap', 'success');
  });
  watchDb(render);
}
