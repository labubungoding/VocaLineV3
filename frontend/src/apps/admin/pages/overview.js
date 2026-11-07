import { $, $$, setHtml } from '../../../lib/dom';
import { getDb, watchDb } from '../../../lib/realtime';
import { bindTabs } from '../../../components/ui/tabs';
import { toast } from '../../../store/uiStore';
import { mountAdminShell } from '../components/adminShell';
import { tabletRowsHtml } from '../components/tabletTable';
import { tabletRows } from '../logic/tabletStatus';

let filter = 'all';

function render(db) {
  const { rows, online, offline, lowBattery } = tabletRows(db);
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const values = { online, offline, lowBattery, alarmsToday: db.alarms.filter((a) => a.createdAt >= startOfDay).length };
  $$('[data-stat]').forEach((b) => {
    b.textContent = values[b.dataset.stat];
  });

  $('#sa-setup-reminder').hidden = db.setupComplete;
  $$('#sa-filter-tablet-status .seg').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === filter)));

  const shown = rows.filter((r) => r.status !== 'disabled' && (filter === 'all' || r.status === filter));
  setHtml($('#sa-tablet-status-rows'), tabletRowsHtml(shown, 'status'));
}

if (mountAdminShell()) {
  bindTabs($('#sa-filter-tablet-status'), (value) => {
    filter = value;
    render(getDb());
  });
  $('#sa-btn-refresh-status').addEventListener('click', () => {
    render(getDb());
    toast('Status tablet diperbarui');
  });
  watchDb(render);
}
