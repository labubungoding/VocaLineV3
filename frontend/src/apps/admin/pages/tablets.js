import { $, on, setHtml } from '../../../lib/dom';
import { getDb, watchDb } from '../../../lib/realtime';
import { confirmModal } from '../../../components/ui/confirmModal';
import { setTabletDisabled } from '../../../services/tablets';
import { toast } from '../../../store/uiStore';
import { mountAdminShell } from '../components/adminShell';
import { tabletRowsHtml } from '../components/tabletTable';
import { tabletRows } from '../logic/tabletStatus';

if (mountAdminShell()) {
  const body = $('#sa-tablet-rows');
  watchDb((db) => setHtml(body, tabletRowsHtml(tabletRows(db).rows, 'manage')));

  on(body, 'click', '[data-action="toggle"]', (e, b) => {
    const t = tabletRows(getDb()).rows.find((r) => r.id === b.dataset.id);
    if (!t) return;
    if (t.disabled) {
      setTabletDisabled(t.id, false);
      toast(`${t.label} aktif lagi. Perawat bisa memasangkannya ke kasur.`, 'success');
      return;
    }
    confirmModal({
      title: `Nonaktifkan ${t.label}?`,
      body: `Tablet dilepas dari ${t.bedLabel.toLowerCase()} dan tidak bisa dipasangkan lagi sampai diaktifkan kembali.`,
      okText: 'Ya, nonaktifkan',
      onOk: () => {
        setTabletDisabled(t.id, true);
        toast(`${t.label} dinonaktifkan`, 'success');
      },
    });
  });
}
