import { getUser } from '../store/authStore';

export function requireRole(role) {
  const user = getUser();
  if (!user) {
    window.location.replace('/login');
    return null;
  }
  if (user.role !== role) {
    window.location.replace('/403');
    return null;
  }
  return user;
}
