const AUTH_KEY = 'lions-pride-mock-session';
const users = {
  public: null,
  student: { id: 'student-demo', name: 'Alex Park', role: 'student', developmentMode: true },
  admin: { id: 'admin-demo', name: 'Morgan Editor', role: 'admin', developmentMode: true }
};
export class MockAuthService {
  getSession() { try { return JSON.parse(sessionStorage.getItem(AUTH_KEY)); } catch { return null; } }
  async login(role) {
    if (role === 'public') { this.logout(); return null; }
    const session = users[role];
    if (!session) throw new Error('This development role is unavailable.');
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(session));
    return session;
  }
  logout() { sessionStorage.removeItem(AUTH_KEY); }
  async validateSession() { return this.getSession(); }
}
