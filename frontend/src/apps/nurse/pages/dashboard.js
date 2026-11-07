import { $, $$, on, setHtml } from '../../../lib/dom';
import { getDb, watchDb } from '../../../lib/realtime';
import { emptyStateHtml } from '../../../components/ui/emptyState';
import { bindTabs } from '../../../components/ui/tabs';
import { handleAlarm, resolveAlarm } from '../../../services/alarms';
import { toast } from '../../../store/uiStore';
import { formatTimer } from '../../../utils/formatTime';
import { isEscalated } from '../../../utils/sortAlarms';
import { mountNurseShell } from '../components/nurseShell';
import { alarmCardHtml } from '../components/alarmCard';
import { floorMapHtml } from '../components/floorMap';
import { openBedDrawer } from '../components/bedDrawer';
import { openActivatePatientModal } from '../components/activatePatientModal';
import { openPairTabletModal } from '../components/pairTabletModal';
import { alarmQueue } from '../logic/alarmQueue';
import { floorRooms } from '../logic/floorMap';

const shell = mountNurseShell({ onWardChange: () => render(getDb()) });
let filter = 'all';

function render(db) {
  if (!shell) return;
  const now = Date.now();
  const wardId = shell.wardId;

  $('#nr-ward-name').textContent = db.wards.find((w) => w.id === wardId)?.name || '';
  setHtml($('#nr-floor-map'), floorMapHtml(floorRooms(db, wardId)));

  const { alarms, waitingCount } = alarmQueue(db, wardId, filter);
  const count = $('#nr-alarm-count');
  count.textContent = `${waitingCount} menunggu`;
  count.dataset.waiting = String(waitingCount);
  $$('#nr-filter-alarm .seg').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.value === filter)));
  setHtml($('#nr-alarm-list'), alarms.length === 0
    ? emptyStateHtml({ id: 'nr-alarm-empty', title: filter === 'all' ? 'Semua pasien aman' : 'Tidak ada alarm di filter ini', text: 'Alarm baru akan muncul di sini dengan bunyi.' })
    : alarms.map((a) => alarmCardHtml(a, db, now)));
}

function tickTimers() {
  const db = getDb();
  const now = Date.now();
  $$('.alarm-card__timer[data-alarm]').forEach((t) => {
    const alarm = db.alarms.find((a) => a.id === t.dataset.alarm);
    if (!alarm) return;
    t.textContent = formatTimer(now - alarm.createdAt);
    const esc = isEscalated(alarm, db.settings, now);
    t.dataset.escalated = String(esc);
    t.title = esc ? 'Melewati batas eskalasi' : '';
  });
}

function openDrawer(bedId) {
  openBedDrawer({
    bedId,
    onEdit: (id) => {
      const patient = getDb().patients.find((p) => p.bedId === id);
      if (patient) openActivatePatientModal({ bedId: id, patient, onClose: () => openDrawer(id) });
    },
    onReplaceTablet: (id) => openPairTabletModal({ bedId: id, mode: 'replace', onClose: () => openDrawer(id) }),
  });
}

function onBedClick(bedId, state) {
  if (state === 'no-tablet') openPairTabletModal({ bedId, mode: 'pair' });
  else if (state === 'empty') openActivatePatientModal({ bedId });
  else openDrawer(bedId);
}

function locate(bedId) {
  const bed = document.getElementById(`nr-bed-${bedId}`);
  if (!bed) return;
  bed.classList.remove('flash');
  requestAnimationFrame(() => bed.classList.add('flash'));
  bed.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

if (shell) {
  on($('#nr-floor-map'), 'click', '.bed[data-bed]', (e, b) => onBedClick(b.dataset.bed, b.dataset.bedState));

  on($('#nr-alarm-list'), 'click', '[data-action]', (e, b) => {
    const alarm = getDb().alarms.find((a) => a.id === b.dataset.id);
    if (!alarm) return;
    if (b.dataset.action === 'handle') {
      handleAlarm(alarm.id, shell.user.id);
      toast('Anda menangani alarm ini. Tablet pasien diberi tahu.', 'success');
    }
    if (b.dataset.action === 'resolve') resolveAlarm(alarm.id);
    if (b.dataset.action === 'locate') locate(alarm.bedId);
  });

  bindTabs($('#nr-filter-alarm'), (value) => {
    filter = value;
    render(getDb());
  });

  watchDb(render);
  setInterval(tickTimers, 1000);
}
