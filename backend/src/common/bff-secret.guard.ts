import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * When BFF_SHARED_SECRET is set, only requests carrying the matching x-bff-secret header
 * (set by the Next.js BFF, never exposed to the browser) are allowed through. This keeps the
 * API unreachable even if something manages to reach its port directly.
 */
@Injectable()
export class BffSecretGuard implements CanActivate {
  private readonly secret = process.env.BFF_SHARED_SECRET;

  canActivate(context: ExecutionContext): boolean {
    if (!this.secret) return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (req.header('x-bff-secret') !== this.secret) {
      throw new UnauthorizedException('Not reachable directly');
    }
    return true;
  }
}
