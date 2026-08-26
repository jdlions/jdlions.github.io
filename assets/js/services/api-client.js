import { editorialConfig } from '../config.js';

export class ApiError extends Error { constructor(message, code, status) { super(message); this.code=code; this.status=status; } }
export async function api(path, init = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (!['GET','HEAD'].includes(init.method || 'GET')) headers.set('X-Editorial-CSRF', '1');
  let response;
  try { response = await fetch(`${editorialConfig.apiBaseUrl}${path}`, { ...init, headers, credentials:'include' }); }
  catch { throw new ApiError('Editorial service is unavailable. Please try again.', 'network_error', 0); }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error?.message || 'Editorial request failed.', data?.error?.code || 'request_failed', response.status);
  return data;
}

