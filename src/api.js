export class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export function createId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hash = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `FORM-${Date.now()}-${hash}`;
}

export function isValidId(id) { return /^FORM-\d{13}-[A-F0-9]{32}$/.test(id); }

export async function request(action, data = {}, method = 'POST') {
  const endpoint = window.CERTIFICATE_CONFIG.apiUrl;
  if (!endpoint) throw new ApiError('The certificate service is not connected yet. Please contact the organizer.', 'NOT_CONFIGURED');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:') throw new ApiError('The certificate service must use HTTPS.', 'CONFIGURATION');
  const options = { method, redirect: 'follow', credentials: 'omit', signal: AbortSignal.timeout(45000) };
  if (method === 'GET') {
    Object.entries({ action, ...data }).forEach(([key, value]) => url.searchParams.set(key, value));
  } else {
    options.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
    options.body = JSON.stringify({ action, ...data });
  }
  let response;
  try { response = await fetch(url, options); }
  catch { throw new ApiError('Could not reach the certificate service. Please try again; your submission ID will be reused.', 'NETWORK'); }
  if (!response.ok) throw new ApiError('The certificate service is temporarily unavailable.', 'HTTP');
  let result;
  try { result = await response.json(); }
  catch { throw new ApiError('Unexpected service response. Check the Apps Script deployment permissions.', 'RESPONSE'); }
  if (!result.ok) throw new ApiError(result.error?.message || 'The request could not be completed.', result.error?.code);
  return result;
}