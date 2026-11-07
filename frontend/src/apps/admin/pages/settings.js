import { $, $$ } from '../../../lib/dom';
import { getDb } from '../../../lib/realtime';
import { saveSettings } from '../../../services/settings';
import { toast } from '../../../store/uiStore';
import { mountAdminShell } from '../components/adminShell';

if (mountAdminShell()) {
  const { ages, escalation } = getDb().settings;
  $$('[data-age]').forEach((i) => {
    i.value = ages[i.dataset.age];
  });
  $$('[data-escalation]').forEach((i) => {
    i.value = escalation[i.dataset.escalation];
  });

  const saveBtn = $('#sa-btn-save-settings');
  saveBtn.addEventListener('click', async () => {
    const read = (attr) => Object.fromEntries($$(`[data-${attr}]`).map((i) => [i.dataset[attr], i.value]));
    saveBtn.disabled = true;
    const err = await saveSettings({ ages: read('age'), escalation: read('escalation') });
    saveBtn.disabled = false;
    const box = $('#sa-settings-error');
    box.textContent = err || '';
    box.hidden = !err;
    if (!err) toast('Pengaturan disimpan dan dikirim ke semua tablet.', 'success');
  });
}
