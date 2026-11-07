import { html, on, setHtml } from '../../../lib/dom';
import { watchDb } from '../../../lib/realtime';
import { openDrawer } from '../../../components/ui/drawer';
import { confirmModal } from '../../../components/ui/confirmModal';
import { bedName } from '../../../services/rooms';
import { dischargePatient } from '../../../services/patients';
import { sendTabletTest } from '../../../services/tablets';
import { shortName, userName } from '../../../services/users';
import { ageToPersona, personaShort } from '../../../utils/ageToPersona';
import { formatClock, formatDateTime } from '../../../utils/formatTime';
import { toast } from '../../../store/uiStore';
import { tabletPanelHtml } from './tabletPanel';

export function openBedDrawer({ bedId, onEdit, onReplaceTablet }) {
  let stop = () => {};
  const d = openDrawer({ id: 'nr-drawer-bed', onClose: () => stop() });
  const close = () => {
    stop();
    d.close();
  };

  stop = watchDb((db) => {
    const bed = db.beds.find((b) => b.id === bedId);
    const patient = db.patients.find((p) => p.bedId === bedId);
    if (!bed || !patient) return close();

    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const history = db.alarms.filter((a) => a.bedId === bedId && a.createdAt >= startOfDay).sort((a, b) => b.createdAt - a.createdAt);

    setHtml(d.root, html`
      <div class="drawer__head">
        <div class="drawer__head-text">
          <span class="cap">${bedName(db, bedId)}</span>
          <h2 class="drawer__title">${patient.name}</h2>
        </div>
        <button id="nr-btn-close-drawer" type="button" class="btn btn--icon btn--ghost" aria-label="Tutup" data-action="close">×</button>
      </div>
      <dl id="nr-bed-patient-info" class="patient-info">
        <dt class="muted">Umur</dt><dd>${patient.age} tahun</dd>
        <dt class="muted">Penyakit</dt><dd>${patient.diagnosis}</dd>
        <dt class="muted">Persona AI</dt><dd>${personaShort(ageToPersona(patient.age, db.settings.ages))}</dd>
        <dt class="muted">Masuk</dt><dd>${formatDateTime(patient.admittedAt)}</dd>
      </dl>
      ${tabletPanelHtml(db, bed)}
      <div class="bed-history">
        <span class="cap">Alarm hari ini</span>
        <ul id="nr-bed-alarm-history" class="bed-history__list">
          ${history.length === 0 ? html`<li class="muted">Belum ada alarm hari ini.</li>` : ''}
          ${history.map((a) => html`
            <li class="bed-history__item">
              <span class="dot bed-history__dot" data-level="${a.level}"></span>
              <span class="bed-history__text">${a.summary}${a.handledBy ? ` · ditangani ${shortName(userName(db, a.handledBy)).split(' ')[0]}` : ' · menunggu'}</span>
              <span class="muted">${formatClock(a.createdAt)}</span>
            </li>`)}
        </ul>
      </div>
      <span class="drawer__spacer"></span>
      <button id="nr-btn-edit-patient" type="button" class="btn btn--block" data-action="edit">Edit data pasien</button>
      <button id="nr-btn-discharge" type="button" class="btn btn--danger btn--block" data-action="discharge" data-name="${patient.name}">Pasien pulang</button>`);
  });

  on(d.root, 'click', '[data-action]', (e, b) => {
    const action = b.dataset.action;
    if (action === 'close') d.dismiss();
    if (action === 'edit') {
      close();
      onEdit(bedId);
    }
    if (action === 'replace-tablet') {
      close();
      onReplaceTablet(bedId);
    }
    if (action === 'test') sendTabletTest(b.dataset.device, b.dataset.test);
    if (action === 'discharge') {
      const name = b.dataset.name;
      const label = d.root.querySelector('.cap').textContent;
      confirmModal({
        id: 'nr-modal-discharge',
        title: `Pulangkan ${name}?`,
        body: `Data pasien di ${label} dihapus dan tablet direset. Catatan alarm disimpan tanpa nama. Tindakan ini tidak bisa dibatalkan.`,
        okText: 'Ya, pasien pulang',
        okId: 'nr-btn-confirm-discharge',
        onOk: () => {
          close();
          dischargePatient(bedId);
          toast(`${name} dipulangkan. Tablet direset.`, 'success');
        },
      });
    }
  });
}
