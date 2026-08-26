import { ProductionEditorialService } from './production-editorial-service.js';
import { authService } from '../auth/auth-service.js';
export const editorialService = await ProductionEditorialService.create(authService.getSession());
