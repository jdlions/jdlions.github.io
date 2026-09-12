import { authService } from './auth-service.js';
import { editorialUrl } from '../config.js';
export function requireRole(role) {
  const session = authService.getSession();
  if (!session) { location.replace(editorialUrl(`/editorial/login/?reason=${authService.error?'session_error':'login'}&returnTo=${encodeURIComponent(location.pathname)}`)); return null; }
  if (session.role !== role) { location.replace(editorialUrl(session.role === 'admin' ? '/editorial/admin/' : '/editorial/student/')); return null; }
  return session;
}
