import { $, html, setHtml } from '../../../lib/dom';
import { getDb, watchDb } from '../../../lib/realtime';
import { requireRole } from '../../../lib/guard';
import { mountShell, connectionHtml, watchConnection } from '../../../components/layout/shell';
import { toast } from '../../../store/uiStore';
import { isEscalated } from '../../../utils/sortAlarms';
import { bedName } from '../../../services/rooms';
import { alarmQueue } from '../logic/alarmQueue';
import { createAlarmSound } from '../logic/alarmSound';
import { openEndShiftModal } from './endShiftModal';

const WARD_KEY = 'nr-ward';
const MUTE_KEY = 'nr-muted-until';

export function mountNurseShell({ onWardChange } = {}) {
  const user = requireRole('nurse');
  if (!user) return null;

  const state = { user, wardId: sessionStorage.getItem(WARD_KEY) || user.wardId || getDb().wards[0]?.id };
  let mutedUntil = Number(sessionStorage.getItem(MUTE_KEY)) || 0;
  let seen = null;

  mountShell({
    center: html`<span class="nurse-ward"><select id="nr-select-ward" class="fi" aria-label="Pilih bangsal"></select></span>`,
    right: html`
      ${connectionHtml()}
      <button id="nr-btn-mute-sound" type="button" class="btn btn--icon" aria-pressed="false" aria-label="Bisukan suara alarm 1 menit">Bisukan</button>`,
    nav: [
      { href: '/nurse', label: 'Dashboard' },
      { href: '/nurse/schedule', label: 'Jadwal', id: 'nr-nav-schedule' },
    ],
    onLogout: () => openEndShiftModal(user),
  });
  watchConnection();

  const select = $('#nr-select-ward');
  const muteBtn = $('#nr-btn-mute-sound');
  const sound = createAlarmSound();

  const refresh = () => {
    const db = getDb();
    const now = Date.now();
    if (!db.wards.some((w) => w.id === state.wardId)) state.wardId = db.wards[0]?.id;

    setHtml(select, db.wards.map((w) => html`<option value="${w.id}">Bangsal ${w.name}</option>`));
    select.value = state.wardId;

    const muted = now < mutedUntil;
    muteBtn.textContent = muted ? 'Suara mati 1 mnt' : 'Bisukan';
    muteBtn.setAttribute('aria-pressed', String(muted));

    const { allActive } = alarmQueue(db, state.wardId);
    const waiting = allActive.filter((a) => a.status === 'waiting');
    sound.update({
      hasRed: waiting.some((a) => a.level === 'red'),
      hasOrange: waiting.some((a) => a.level !== 'red'),
      escalated: waiting.some((a) => isEscalated(a, db.settings, now)),
      muted,
    });

    if (seen) {
      waiting
        .filter((a) => !seen.has(a.id))
        .forEach((a) => toast(`Alarm baru · ${bedName(db, a.bedId)} · ${a.level === 'red' ? 'darurat' : 'butuh bantuan'}`, 'info', 6000));
    }
    seen = new Set(allActive.map((a) => a.id));
  };

  select.addEventListener('change', () => {
    state.wardId = select.value;
    sessionStorage.setItem(WARD_KEY, state.wardId);
    seen = null;
    refresh();
    onWardChange?.(state.wardId);
  });

  muteBtn.addEventListener('click', () => {
    mutedUntil = Date.now() < mutedUntil ? 0 : Date.now() + 60 * 1000;
    sessionStorage.setItem(MUTE_KEY, String(mutedUntil));
    refresh();
  });

  watchDb(refresh);
  setInterval(refresh, 5000);
  return state;
}
