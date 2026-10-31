import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { DatabaseService } from '../db/database.service';

export const SESSION_COOKIE = 'psm_session';
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface SessionRow {
  id: string;
  user_id: number;
  remember: number;
  expires_at: string;
}

export function isSecure(req: Request): boolean {
  return req.header('x-forwarded-proto') === 'https' || req.protocol === 'https';
}

export async function createSession(db: DatabaseService, req: Request, res: Response, userId: number, remember: boolean) {
  const id = randomUUID();
  const ttl = remember ? REMEMBER_MS : DEFAULT_MS;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  await db.run('INSERT INTO sessions (id, user_id, remember, expires_at) VALUES (?, ?, ?, ?)', [id, userId, remember ? 1 : 0, expiresAt]);
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(req),
    path: '/',
    ...(remember ? { maxAge: REMEMBER_MS } : {}),
  });
  return id;
}

export async function destroySession(db: DatabaseService, req: Request, res: Response) {
  const id = req.cookies?.[SESSION_COOKIE];
  if (id) await db.run('DELETE FROM sessions WHERE id = ?', [id]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function currentSession(db: DatabaseService, req: Request): Promise<SessionRow | undefined> {
  const id = req.cookies?.[SESSION_COOKIE];
  if (!id) return undefined;
  const session = await db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', [id]);
  if (!session) return undefined;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await db.run('DELETE FROM sessions WHERE id = ?', [id]);
    return undefined;
  }
  return session;
}

export function clientIp(req: Request): string {
  return (req.header('x-forwarded-for') || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}
