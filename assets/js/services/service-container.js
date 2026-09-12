import { ProductionEditorialService } from './production-editorial-service.js';
import { authService } from '../auth/auth-service.js';
export const editorialService = ProductionEditorialService.empty(authService.getSession());
export function loadEditorialService(resources){return editorialService.load(resources);}
