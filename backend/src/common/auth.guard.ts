import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { DatabaseService } from '../db/database.service';
import { currentSession } from './session';
import { loadFullUser, type FullUser } from './user-loader';

export type AuthUser = FullUser;

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}

const ALWAYS_ALLOWED = ['/api/auth/logout', '/api/auth/me'];

/**
 * Resolves req.user from the session cookie and enforces the two redirects the frontend
 * (lib/api.js) understands: a user who must change their generated password is blocked from
 * everything else (403 PASSWORD_CHANGE_REQUIRED), and a company portal account is confined to
 * /api/portal/* and /api/auth/* (403 COMPANY_ACCOUNT).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const session = currentSession(this.db, req);
    if (!session) throw new UnauthorizedException('Sign in required');

    const user = loadFullUser(this.db, session.user_id);
    if (!user || !user.active) throw new UnauthorizedException('Sign in required');
    req.user = user;

    if (ALWAYS_ALLOWED.includes(req.path)) return true;

    if (user.must_change_password && req.path !== '/api/auth/password') {
      throw new ForbiddenException({ error: 'Password change required', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    if (user.role === 'company' && !req.path.startsWith('/api/portal') && !req.path.startsWith('/api/auth')) {
      throw new ForbiddenException({ error: 'Company accounts use the portal', code: 'COMPANY_ACCOUNT' });
    }
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.user?.role !== 'admin') throw new ForbiddenException('Administrator access required');
    return true;
  }
}
