// Server-side only: how the Next.js backend-for-frontend (BFF) talks to the NestJS API.
// The browser never sees BACKEND_URL or BFF_SHARED_SECRET; it only calls same-origin /api/*.

export const BACKEND_URL = (process.env.BACKEND_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');
export const SESSION_COOKIE = 'psm_session';

const TIMEOUT_MS = 120_000; // Excel imports / exports can take a while

// Request headers passed on to the API. Everything else (host, connection, browser hints…) stays here.
const FORWARD_REQUEST = ['accept', 'accept-language', 'content-type', 'cookie', 'if-none-match', 'user-agent'];
// Response headers never copied back (hop-by-hop, or recomputed by the runtime).
const DROP_RESPONSE = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length',
  'set-cookie', 'x-powered-by', 'access-control-allow-origin', 'access-control-allow-credentials', 'vary',
]);

function backendHeaders(incoming) {
  const headers = new Headers();
  for (const name of FORWARD_REQUEST) {
    const value = incoming.get(name);
    if (value) headers.set(name, value);
  }
  if (process.env.BFF_SHARED_SECRET) headers.set('x-bff-secret', process.env.BFF_SHARED_SECRET);
  return headers;
}

// Client address and scheme, so the API's login lockout, audit log and Secure cookies see the real user.
function forwardedHeaders(request, headers) {
  const url = new URL(request.url);
  const chain = request.headers.get('x-forwarded-for');
  const client = request.headers.get('x-real-ip');
  if (chain || client) headers.set('x-forwarded-for', chain || client);
  headers.set('x-forwarded-proto', request.headers.get('x-forwarded-proto') || url.protocol.replace(':', ''));
  headers.set('x-forwarded-host', request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host);
}

const json = (status, error) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });

/** Forwards an /api/* request to the backend and streams the answer back unchanged. */
export async function proxyToBackend(request) {
  const url = new URL(request.url);
  const headers = backendHeaders(request.headers);
  forwardedHeaders(request, headers);
  const hasBody = !['GET', 'HEAD'].includes(request.method);

  let res;
  try {
    res = await fetch(`${BACKEND_URL}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') return json(504, 'The server took too long to respond. Please try again.');
    console.error(`[bff] ${request.method} ${url.pathname} → backend unreachable:`, err?.cause?.code || err?.message);
    return json(502, 'The server is not reachable right now. Please try again in a moment.');
  }

  const out = new Headers();
  res.headers.forEach((value, name) => { if (!DROP_RESPONSE.has(name)) out.set(name, value); });
  for (const cookie of res.headers.getSetCookie()) out.append('set-cookie', cookie);
  if (!out.has('cache-control')) out.set('cache-control', 'no-store');

  const noBody = res.status === 204 || res.status === 304 || request.method === 'HEAD';
  return new Response(noBody ? null : res.body, { status: res.status, statusText: res.statusText, headers: out });
}

/**
 * Resolves the signed-in user for a page request.
 * Returns the user, `null` when not signed in, or `undefined` when the API could not be reached.
 */
export async function sessionUser(cookieHeader) {
  if (!cookieHeader || !cookieHeader.includes(`${SESSION_COOKIE}=`)) return null;
  const headers = new Headers({ cookie: cookieHeader, accept: 'application/json' });
  if (process.env.BFF_SHARED_SECRET) headers.set('x-bff-secret', process.env.BFF_SHARED_SECRET);
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/me`, { headers, cache: 'no-store', signal: AbortSignal.timeout(5_000) });
    if (res.ok) return await res.json();
    return res.status === 401 ? null : undefined;
  } catch {
    return undefined;
  }
}
