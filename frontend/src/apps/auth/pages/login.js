import { $, $$ } from '../../../lib/dom';
import { signIn, homeFor } from '../../../lib/auth';
import { getUser, setUser } from '../../../store/authStore';
import { api, isLive } from '../../../lib/supabase';

if (getUser()) window.location.replace(homeFor(getUser()));

let role = 'admin';
const form = $('#app-login-form');
const error = $('#app-login-error');
const submit = $('#app-login-submit');
const password = $('#app-login-password');
const toggle = $('#app-login-toggle-password');

const submitText = () => (role === 'superadmin' ? 'Masuk sebagai Superadmin' : 'Masuk sebagai Admin');

$$('.role-option').forEach((btn) => {
  btn.addEventListener('click', () => {
    role = btn.dataset.role;
    $$('.role-option').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
    submit.textContent = submitText();
  });
});

toggle.addEventListener('click', () => {
  const show = password.type === 'password';
  password.type = show ? 'text' : 'password';
  toggle.textContent = show ? 'Tutup' : 'Lihat';
  toggle.setAttribute('aria-label', show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!form.reportValidity()) return;
  error.hidden = true;
  submit.disabled = true;
  submit.textContent = 'Memeriksa…';
  try {
    const user = await signIn({ email: $('#app-login-email').value, password: password.value, role });
    setUser(user);
    window.location.replace(homeFor(user));
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    submit.disabled = false;
    submit.textContent = submitText();
  }
});

const forgot = $('#app-login-forgot');
const info = $('#app-login-info');
forgot.hidden = !isLive;
forgot.addEventListener('click', async () => {
  const email = $('#app-login-email');
  error.hidden = true;
  info.hidden = true;
  if (!email.value.trim() || !email.checkValidity()) {
    error.textContent = 'Isi email akun Anda dulu, lalu tekan "Lupa kata sandi?" lagi.';
    error.hidden = false;
    return email.focus();
  }
  forgot.disabled = true;
  try {
    const res = await api('/auth/password/forgot', { method: 'POST', body: { email: email.value.trim() }, token: null });
    info.textContent = res?.message || 'Jika email terdaftar, tautan atur ulang kata sandi sudah dikirim.';
    info.hidden = false;
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    forgot.disabled = false;
  }
});
