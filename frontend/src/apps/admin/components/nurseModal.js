import { html } from '../../../lib/dom';
import { openModal } from '../../../components/ui/modal';
import { addNurse, updateNurse } from '../../../services/users';
import { toast } from '../../../store/uiStore';

export function openNurseModal(wards, nurse = null) {
  const edit = Boolean(nurse);
  const m = openModal({
    id: 'sa-modal-nurse',
    title: edit ? 'Edit perawat' : 'Tambah perawat',
    maxWidth: 460,
    body: html`
      <form class="modal__form">
        <label class="lbl">Nama<input id="sa-input-nurse-name" class="fi" required maxlength="120" autofocus value="${nurse?.name || ''}" /></label>
        <label class="lbl">Email<input id="sa-input-nurse-email" class="fi" type="email" required maxlength="200" value="${nurse?.email || ''}" ${edit ? 'disabled' : ''} /></label>
        <label class="lbl">
          Bangsal
          <select id="sa-select-nurse-ward" class="fi" required>
            <option value="" disabled ${nurse?.wardId ? '' : 'selected'}>${wards.length ? 'Pilih bangsal' : 'Belum ada bangsal'}</option>
            ${wards.map((w) => html`<option value="${w.id}" ${w.id === nurse?.wardId || (!edit && wards.length === 1) ? 'selected' : ''}>${w.name}</option>`)}
          </select>
        </label>
        <p id="sa-nurse-error" role="alert" class="alert alert--error" ${wards.length ? 'hidden' : ''}>${wards.length ? '' : 'Buat bangsal dulu di halaman Denah sebelum menambah perawat.'}</p>
        ${edit ? '' : html`<p class="muted text-xs">Undangan berisi tautan buat kata sandi dikirim ke email ini.</p>`}
        <div class="modal__actions">
          <button id="app-modal-confirm-cancel" type="button" class="btn">Batal</button>
          <button id="sa-btn-save-nurse" type="submit" class="btn btn--primary" ${wards.length ? '' : 'disabled'}>Simpan</button>
        </div>
      </form>`,
  });

  const $ = (id) => m.root.querySelector(id);
  const save = $('#sa-btn-save-nurse');
  const showError = (err) => {
    $('#sa-nurse-error').textContent = err;
    $('#sa-nurse-error').hidden = false;
  };
  $('#app-modal-confirm-cancel').addEventListener('click', m.dismiss);
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#sa-input-nurse-email').value;
    const fields = { name: $('#sa-input-nurse-name').value, email, wardId: $('#sa-select-nurse-ward').value };
    save.disabled = true;
    const err = edit ? await updateNurse(nurse.id, fields) : await addNurse(fields);
    save.disabled = false;
    if (err) return showError(err);
    toast(edit ? `Data ${fields.name.trim()} diperbarui` : `Undangan dikirim ke ${email}`, 'success');
    m.dismiss();
  });
}
