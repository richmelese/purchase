// Browser-side API client.
export class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

async function request(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401 && !url.startsWith('/auth/') && typeof window !== 'undefined') {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    return new Promise(() => {});
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  // The API refuses everything else until a generated password is replaced, and keeps company
  // accounts inside their portal: send the browser to the right page.
  const goTo = res.status === 403 && typeof window !== 'undefined'
    && { PASSWORD_CHANGE_REQUIRED: '/change-password', COMPANY_ACCOUNT: '/portal' }[data.code];
  if (goTo && window.location.pathname !== goTo) {
    window.location.href = goTo;
    return new Promise(() => {});
  }
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.fields);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  put: (url, body) => request('PUT', url, body ?? {}),
  del: (url) => request('DELETE', url),
};

export const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
