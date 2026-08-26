import { editorialConfig } from '../config.js';
import { api } from '../services/api-client.js';

export class ProductionAuthService {
  constructor(session) { this.session=session; this.mode='production'; }
  static async create() { const result=await api('/api/session'); return new ProductionAuthService(result.authenticated ? result.user : null); }
  getSession() { return this.session; }
  validateSession() { return Promise.resolve(this.session); }
  login() { location.href=`${editorialConfig.apiBaseUrl}/auth/login?returnTo=${encodeURIComponent(location.pathname)}`; }
  async logout() { await api('/auth/logout',{method:'POST'}); this.session=null; location.href='../login/'; }
}

