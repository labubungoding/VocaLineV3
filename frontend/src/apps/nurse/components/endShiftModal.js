import { html, on, setHtml } from '../../../lib/dom';
import { watchDb } from '../../../lib/realtime';
import { openModal } from '../../../components/ui/modal';
import { logout } from '../../../store/authStore';
import { handoverAlarm, resolveAlarm } from '../../../services/alarms';
import { bedShort } from '../../../services/rooms';
import { ALARM_LEVELS } from '../../../constants/alarmLevels';

export function openEndShiftModal(user) {
  let stop = () => {};
  const m = openModal({
    id: 'nr-modal-end-shift',
    title: 'Akhiri shift?',
    maxWidth: 540,
    onClose: () => stop(),
    body: html`
      <p class="muted end-shift__intro">
        Selesaikan atau serahkan dulu alarm yang masih atas nama Anda, supaya perawat shift berikutnya bisa mengambilnya.
      </p>
      <ul id="nr-end-shift-open-alarms" class="end-shift__list"></ul>
      <div class="modal__actions">
        <button type="button" class="btn btn--ghost" data-action="back">Kembali</button>
        <button id="nr-btn-confirm-logout" type="button" class="btn btn--primary">Logout</button>
      </div>`,
  });

  const list = m.root.querySelector('#nr-end-shift-open-alarms');
  const logoutBtn = m.root.querySelector('#nr-btn-confirm-logout');

  stop = watchDb((db) => {
    const mine = db.alarms.filter((a) => a.status === 'handling' && a.handledBy === user.id);
    logoutBtn.disabled = mine.length > 0;
    setHtml(list, mine.length === 0
      ? html`<li class="alert alert--ok end-shift__empty">Tidak ada alarm yang masih Anda tangani.</li>`
      : mine.map((a) => {
        const lvl = ALARM_LEVELS[a.level];
        return html`
          <li class="end-shift__item" data-level="${a.level}">
            <div class="end-shift__item-head">
              <span class="end-shift__badge">${lvl.label}</span>
              <b>Kamar ${bedShort(db, a.bedId)}</b>
              <span class="muted">${a.patientName ? `${a.patientName} · ` : ''}${a.summary.toLowerCase()}</span>
            </div>
            <div class="end-shift__item-actions">
              <button id="nr-btn-end-shift-resolve-${a.id}" type="button" class="btn btn--success" data-action="resolve" data-id="${a.id}">Tandai selesai</button>
              <button id="nr-btn-end-shift-handover-${a.id}" type="button" class="btn" data-action="handover" data-id="${a.id}">Serahkan ke shift berikutnya</button>
            </div>
          </li>`;
      }));
  });

  on(m.root, 'click', '[data-action]', (e, b) => {
    if (b.dataset.action === 'back') m.dismiss();
    if (b.dataset.action === 'resolve') resolveAlarm(b.dataset.id);
    if (b.dataset.action === 'handover') handoverAlarm(b.dataset.id);
  });

  logoutBtn.addEventListener('click', () => {
    stop();
    m.close();
    logout();
    window.location.href = '/login';
  });
}
