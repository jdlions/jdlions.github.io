import { MockAuthService } from './mock-auth-service.js';
import { ProductionAuthService } from './production-auth-service.js';
import { editorialConfig } from '../config.js';
export const authService = editorialConfig.mode === 'production' ? await ProductionAuthService.create() : new MockAuthService();
