import { authService } from './auth-service.js';
export function requireRole(role) {
  const session = authService.getSession();
  if (!session) { location.replace(`../login/?reason=login&returnTo=${encodeURIComponent(location.pathname)}`); return null; }
  if (session.role !== role) { location.replace(session.role === 'admin' ? '../admin/' : '../student/'); return null; }
  return session;
}
