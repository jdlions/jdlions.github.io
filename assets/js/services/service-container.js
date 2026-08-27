import { ProductionEditorialService } from './production-editorial-service.js';
import { authService } from '../auth/auth-service.js';
export const editorialService = ProductionEditorialService.empty(authService.getSession());
let loading;
export function loadEditorialService(){return loading||(loading=editorialService.load().catch(error=>{loading=null;throw error;}));}
