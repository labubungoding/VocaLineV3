import { html } from '../../lib/dom';
import { api } from '../../lib/supabase';
import { openModal } from '../ui/modal';
import { toast } from '../../store/uiStore';

export function openChangePasswordModal() {
  const m = openModal({
    id: 'app-modal-change-password',
    title: 'Ganti kata sandi',
    maxWidth: 440,
    body: html`
      <form class="modal__form">
        <label class="lbl">Kata sandi lama<input id="app-input-password-current" class="fi" type="password" required maxlength="200" autocomplete="current-password" autofocus /></label>
        <label class="lbl">Kata sandi baru<input id="app-input-password-new" class="fi" type="password" required minlength="8" maxlength="200" autocomplete="new-password" /></label>
        <label class="lbl">Ulangi kata sandi baru<input id="app-input-password-new2" class="fi" type="password" required minlength="8" maxlength="200" autocomplete="new-password" /></label>
        <p id="app-change-password-error" role="alert" class="alert alert--error" hidden></p>
        <p class="muted text-xs">Minimal 8 karakter. Perangkat lain yang memakai akun ini akan keluar otomatis.</p>
        <div class="modal__actions">
          <button id="app-btn-cancel-change-password" type="button" class="btn">Batal</button>
          <button id="app-btn-save-password" type="submit" class="btn btn--primary">Simpan</button>
        </div>
      </form>`,
  });

  const $ = (id) => m.root.querySelector(id);
  const error = $('#app-change-password-error');
  const save = $('#app-btn-save-password');
  const fail = (text) => {
    error.textContent = text;
    error.hidden = false;
  };
  $('#app-btn-cancel-change-password').addEventListener('click', m.dismiss);
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const currentPassword = $('#app-input-password-current').value;
    const newPassword = $('#app-input-password-new').value;
    if (!currentPassword) return fail('Isi kata sandi lama.');
    if (newPassword.length < 8) return fail('Kata sandi baru minimal 8 karakter.');
    if (newPassword !== $('#app-input-password-new2').value) return fail('Kedua kata sandi baru tidak sama.');
    if (newPassword === currentPassword) return fail('Kata sandi baru harus berbeda dari yang lama.');
    save.disabled = true;
    try {
      await api('/auth/password/change', { method: 'POST', body: { currentPassword, newPassword } });
    } catch (err) {
      save.disabled = false;
      return fail(err.message);
    }
    toast('Kata sandi diganti.', 'success');
    m.dismiss();
  });
}
