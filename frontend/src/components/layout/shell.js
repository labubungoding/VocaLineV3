import { $, html, setHtml } from '../../lib/dom';
import { watchOnline } from '../../lib/realtime';
import { getUser, logout } from '../../store/authStore';
import { shortName } from '../../services/users';
import { isLive } from '../../lib/supabase';
import { openChangePasswordModal } from './changePasswordModal';

export function mountShell({ badge = '', center = '', right = '', nav, onLogout }) {
  const user = getUser();
  const here = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';

  setHtml($('#app-header'), html`
    <img class="app-header__brand" src="/logo.png" alt="Vocaline" />
    ${badge}
    ${center}
    <span class="app-header__spacer"></span>
    ${right}
    <div id="app-user-menu" class="user-menu">
      <span class="user-menu__name">${shortName(user?.name)}</span>
      ${isLive ? html`<button id="app-btn-change-password" type="button" class="btn btn--ghost user-menu__logout" title="Ganti kata sandi">Ganti sandi</button>` : ''}
      <button id="app-btn-logout" type="button" class="btn btn--ghost user-menu__logout">Logout</button>
    </div>`);

  setHtml($('#app-sidebar'), nav.map((it) => html`
    <a ${it.id ? html`id="${it.id}"` : ''} href="${it.href}" class="sidebar__link${it.href === here ? ' sidebar__link--active' : ''}">${it.label}</a>`));

  $('#app-btn-change-password')?.addEventListener('click', openChangePasswordModal);
  $('#app-btn-logout').addEventListener('click', () => {
    if (onLogout) return onLogout();
    logout();
    window.location.href = '/login';
  });
}

export function connectionHtml() {
  return html`<span id="app-connection-status" class="pill conn-status"><span class="dot"></span><span class="conn-status__text"></span></span>`;
}

export function watchConnection() {
  const pill = $('#app-connection-status');
  if (!pill) return;
  watchOnline((online) => {
    pill.dataset.status = online ? 'online' : 'offline';
    pill.querySelector('.conn-status__text').textContent = online ? 'Realtime terhubung' : 'Koneksi terputus';
  });
}
