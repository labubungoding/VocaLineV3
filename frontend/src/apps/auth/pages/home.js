import { homeFor } from '../../../lib/auth';
import { getUser } from '../../../store/authStore';
import './forbidden';

const path = window.location.pathname;
if (path === '/' || path === '/index.html') {
  window.location.replace(homeFor(getUser()));
} else {
  document.getElementById('not-found').hidden = false;
}
