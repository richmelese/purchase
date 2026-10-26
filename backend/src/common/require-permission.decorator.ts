import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { can } from './permissions';

export const PERMISSION_KEY = 'permission';
export interface PermissionMeta { resource: string; right: string; task?: string }

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = this.reflector.get<PermissionMeta | undefined>(PERMISSION_KEY, context.getHandler());
    if (!meta) return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (!can(req.user, meta.resource, meta.right, meta.task)) {
      throw new ForbiddenException(`Missing ${meta.resource}.${meta.right}${meta.task ? `/${meta.task}` : ''}`);
    }
    return true;
  }
}

/** Declarative route guard: `@RequirePermission('purchases', 'edit', 'update_purchase')`. */
export function RequirePermission(resource: string, right: string, task?: string) {
  return applyDecorators(SetMetadata(PERMISSION_KEY, { resource, right, task }), UseGuards(PermissionGuard));
}
