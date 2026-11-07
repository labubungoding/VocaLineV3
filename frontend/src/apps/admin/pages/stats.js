import { $, $$, html, setHtml } from '../../../lib/dom';
import { getDb, watchDb } from '../../../lib/realtime';
import { alarmsToCsv } from '../../../services/alarms';
import { bedShort } from '../../../services/rooms';
import { formatDuration, formatDateTime, toDateInput } from '../../../utils/formatTime';
import { ALARM_LEVELS } from '../../../constants/alarmLevels';
import { mountAdminShell } from '../components/adminShell';
import { barsHtml, dayLabelsHtml, responseHtml } from '../components/statsCharts';
import { alarmStats } from '../logic/alarmStats';

const DAY = 24 * 60 * 60 * 1000;
const from = $('#sa-input-date-from');
const to = $('#sa-input-date-to');
const ward = $('#sa-select-stats-ward');
const levels = { red: true, orange: true };
let stats = null;

function render(db) {
  setHtml(ward, html`<option value="all">Semua bangsal</option>${db.wards.map((w) => html`<option value="${w.id}">${w.name}</option>`)}`);
  if (![...ward.options].some((o) => o.value === ward.dataset.value)) ward.dataset.value = 'all';
  ward.value = ward.dataset.value;
  from.max = to.value;
  to.min = from.value;
  $$('#sa-filter-stats-level .chip').forEach((c) => c.setAttribute('aria-pressed', String(levels[c.dataset.level])));

  stats = alarmStats(db, { from: from.value, to: to.value, wardId: ward.value, levels });
  $('#sa-stats-total').textContent = stats.total;
  $('#sa-btn-export-csv').disabled = !stats.total;

  setHtml($('#sa-chart-bars'), barsHtml(stats.days));
  setHtml($('#sa-chart-days'), dayLabelsHtml(stats.days));
  setHtml($('#sa-chart-response'), responseHtml(stats.response));

  setHtml($('#sa-alarm-log-rows'), stats.list.slice(0, 50).map((a) => html`
    <tr>
      <td>${formatDateTime(a.createdAt)}</td>
      <td>${db.wards.find((w) => w.id === a.wardId)?.name || '—'} · ${bedShort(db, a.bedId)}</td>
      <td class="stats__level" data-level="${a.level}">${ALARM_LEVELS[a.level]?.name}</td>
      <td>${a.summary}</td>
      <td>${a.resolvedAt ? formatDuration((a.resolvedAt - a.createdAt) / 1000) : 'belum selesai'}</td>
    </tr>`));
  $('#sa-alarm-log-more').hidden = stats.list.length <= 50;
}

function exportCsv() {
  const blob = new Blob([alarmsToCsv(stats.list, getDb())], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `statistik-alarm-${from.value}-sd-${to.value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

if (mountAdminShell()) {
  from.value = toDateInput(Date.now() - 6 * DAY);
  to.value = toDateInput(Date.now());
  ward.dataset.value = 'all';

  from.addEventListener('change', () => render(getDb()));
  to.addEventListener('change', () => render(getDb()));
  ward.addEventListener('change', () => {
    ward.dataset.value = ward.value;
    render(getDb());
  });
  $('#sa-filter-stats-level').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    levels[chip.dataset.level] = !levels[chip.dataset.level];
    render(getDb());
  });
  $('#sa-btn-export-csv').addEventListener('click', exportCsv);

  watchDb(render);
}
