import { MockEditorialService } from './mock-editorial-service.js';
import { ProductionEditorialService } from './production-editorial-service.js';
import { editorialConfig } from '../config.js';
import { authService } from '../auth/auth-service.js';
export const editorialService = editorialConfig.mode === 'production' ? await ProductionEditorialService.create(authService.getSession()) : new MockEditorialService();
