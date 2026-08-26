import { MockAuthService } from './mock-auth-service.js';
// Production swaps this factory for a backend session client. Browser role input
// must never become an authorization decision outside development mode.
export const authService = new MockAuthService();
