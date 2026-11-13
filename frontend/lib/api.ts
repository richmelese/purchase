// Browser-side API client.
export class ApiError extends Error {
  status: number;
  fields: Record<string, unknown>;

  constructor(message: string, status: number, fields?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

/** `file`: a File/Blob sent as the raw request body (Excel imports) instead of JSON. */
async function request<T = any>(method: string, url: string, body?: unknown, file?: Blob): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: file ? { 'Content-Type': 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: file ?? (body !== undefined ? JSON.stringify(body) : undefined),
    cache: 'no-store',
  });
  if (res.status === 401 && !url.startsWith('/auth/') && typeof window !== 'undefined') {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    return new Promise<T>(() => {});
  }
  if (res.status === 204) return null as T;
  const data = await res.json().catch(() => ({}));
  // The API refuses everything else until a generated password is replaced, and keeps company
  // accounts inside their portal: send the browser to the right page.
  const goTo = res.status === 403 && typeof window !== 'undefined'
    && ({ PASSWORD_CHANGE_REQUIRED: '/change-password', COMPANY_ACCOUNT: '/portal' } as Record<string, string>)[data.code];
  if (goTo && window.location.pathname !== goTo) {
    window.location.href = goTo;
    return new Promise<T>(() => {});
  }
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.fields);
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T = any>(url: string) => request<T>('DELETE', url),
  /** Uploads a file (e.g. an .xlsx import) as the raw body. */
  upload: <T = any>(url: string, file: Blob) => request<T>('POST', url, undefined, file),
};

// `object` (not `Record<string, unknown>`) so a plain interface without its own index signature
// (e.g. a local `{fy, month}` filter type) can still be passed without every caller needing one.
export const qs = (params: object): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
