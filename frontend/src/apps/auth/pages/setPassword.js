import { $ } from '../../../lib/dom';
import { api, isLive } from '../../../lib/supabase';

const msg = $('#app-setpw-message');
const show = (text, kind = 'info') => {
  msg.textContent = text;
  msg.className = `alert alert--${kind}`;
  msg.hidden = false;
};

const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const token = params.get('token');
if (token) window.history.replaceState(null, '', window.location.pathname);

function showRequestForm(sub) {
  $('#app-setpw-title').textContent = 'Daftar superadmin';
  $('#app-setpw-sub').textContent = sub;
  $('#app-request-form').hidden = false;
}

async function start() {
  if (!isLive) {
    $('#app-setpw-sub').textContent = 'Backend belum disambungkan (VITE_API_URL kosong).';
    return;
  }
  if (!token) return showRequestForm('Tautan undangan tidak ditemukan atau sudah kedaluwarsa.');
  try {
    const res = await api('/auth/password/check', { method: 'POST', body: { token }, token: null });
    if (res.valid) {
      $('#app-setpw-sub').textContent = `Akun: ${res.email}. Minimal 8 karakter.`;
      $('#app-setpw-form').hidden = false;
      return;
    }
  } catch (e) {
    if (e.status === 429) return show(e.message, 'error');
  }
  showRequestForm('Tautan undangan tidak ditemukan atau sudah kedaluwarsa.');
}

$('#app-setpw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p1 = $('#app-setpw-password').value;
  const p2 = $('#app-setpw-password2').value;
  if (p1.length < 8) return show('Kata sandi minimal 8 karakter.', 'error');
  if (p1 !== p2) return show('Kedua kata sandi tidak sama.', 'error');
  $('#app-setpw-submit').disabled = true;
  try {
    await api('/auth/password/set', { method: 'POST', body: { token, password: p1 }, token: null });
  } catch (err) {
    $('#app-setpw-submit').disabled = false;
    return show(err.message, 'error');
  }
  show('Kata sandi tersimpan. Silakan masuk.', 'success');
  $('#app-setpw-form').hidden = true;
  setTimeout(() => window.location.replace('/login'), 1500);
});

$('#app-request-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#app-request-email').value.trim();
  if (!email) return;
  $('#app-request-submit').disabled = true;
  try {
    const body = await api('/auth/superadmin/request', { method: 'POST', body: { email }, token: null });
    show(body?.message || 'Jika email terdaftar, tautan verifikasi sudah dikirim.', 'success');
  } catch (err) {
    show(err.message, 'error');
    $('#app-request-submit').disabled = false;
  }
});

start();
