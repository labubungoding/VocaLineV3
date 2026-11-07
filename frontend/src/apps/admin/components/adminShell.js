import { html } from '../../../lib/dom';
import { requireRole } from '../../../lib/guard';
import { mountShell } from '../../../components/layout/shell';

const NAV = [
  { href: '/admin/setup', label: 'Pemasangan' },
  { href: '/admin', label: 'Ringkasan' },
  { href: '/admin/layout', label: 'Denah' },
  { href: '/admin/tablets', label: 'Tablet' },
  { href: '/admin/nurses', label: 'Akun perawat' },
  { href: '/admin/settings', label: 'Umur & eskalasi' },
  { href: '/admin/stats', label: 'Statistik alarm' },
];

export function mountAdminShell() {
  const user = requireRole('superadmin');
  if (!user) return null;
  mountShell({
    badge: html`<span class="pill app-header__badge">Superadmin</span>`,
    nav: NAV,
  });
  return user;
}
