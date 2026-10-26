import { BadRequestException, Controller, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, type AuthUser } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { CurrentUser } from '../../common/current-user.decorator';
import { ImportService } from './import.service';

/**
 * These two routes expect a raw .xlsx body (`Content-Type: application/octet-stream`), not JSON —
 * see the `express.raw()` middleware registered for the `/api/import` path prefix in `main.ts`.
 */
@Controller('api/import')
@UseGuards(AuthGuard)
export class ImportController {
  constructor(private readonly svc: ImportService) {}

  @Post('parties')
  @RequirePermission('parties', 'create')
  importParties(@Req() req: Request, @Query('type') type: string | undefined, @CurrentUser() user: AuthUser) {
    const buf = this.rawBody(req);
    const partyType: 'Supplier' | 'Customer' = type === 'Customer' ? 'Customer' : 'Supplier';
    return this.svc.importParties(buf, partyType, user);
  }

  @Post('products')
  @RequirePermission('products', 'create')
  importProducts(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const buf = this.rawBody(req);
    return this.svc.importProducts(buf, user);
  }

  private rawBody(req: Request): Buffer {
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body)) {
      throw new BadRequestException('Expected a raw .xlsx file in the request body (Content-Type: application/octet-stream)');
    }
    return body;
  }
}
