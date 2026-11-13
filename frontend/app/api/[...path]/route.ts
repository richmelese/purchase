// Backend-for-frontend: every browser call to /api/* is forwarded to the private NestJS API.
import { proxyToBackend } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = proxyToBackend;
export const HEAD = proxyToBackend;
export const POST = proxyToBackend;
export const PUT = proxyToBackend;
export const PATCH = proxyToBackend;
export const DELETE = proxyToBackend;
