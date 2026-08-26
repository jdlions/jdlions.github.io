import { editorialUrl } from '../config.js';
import { api } from '../services/api-client.js';

export class ProductionAuthService {
  constructor(session) { this.session=session; this.mode='production'; }
  static async create() {
    try { const result=await api('/api/session'); return new ProductionAuthService(result?.authenticated ? result.user : null); }
    catch { return new ProductionAuthService(null); }
  }
  getSession() { return this.session; }
  validateSession() { return Promise.resolve(this.session); }
  login(returnTo=location.pathname) { location.href=editorialUrl(`/auth/login?returnTo=${encodeURIComponent(returnTo || '/editorial/login/')}`); }
  async logout() { await api('/auth/logout',{method:'POST'}); this.session=null; location.href=editorialUrl('/editorial/login/'); }
}

