import { $ } from '../../../lib/dom';
import { homeFor } from '../../../lib/auth';
import { getUser, logout } from '../../../store/authStore';

const user = getUser();
const logoutBtn = $('#app-btn-logout-403');

$('#app-btn-go-home').addEventListener('click', () => {
  window.location.href = homeFor(getUser());
});

if (user && logoutBtn) {
  logoutBtn.hidden = false;
  logoutBtn.addEventListener('click', () => {
    logout();
    window.location.href = '/login';
  });
}
