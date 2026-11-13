import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import type { AuthUser } from '../../common/auth.guard';
import { CrvService, CrvListQuery } from './crv.service';

/**
 * CRV declarations ("Module 2" in the client's phasing doc), kept deliberately separate from
 * purchase/sale declaration ("Module 1"): `credit_collection` (money collected against a Credit
 * purchase/sale, requires `invoice_id`) plus three standalone money-in events with no invoice
 * behind them — loan received, shareholder contribution, other/refund. This is the ONLY place a
 * payment/collection can be created or removed; there is no `.../:id/payments` route on
 * purchases/sales. Gated by the 'crv' permission resource (see common/permissions.ts), but a
 * credit_collection additionally requires purchases/sales edit rights + company access on the
 * linked invoice (enforced in CrvService), same as before this module existed.
 */
@UseGuards(AuthGuard)
@Controller('api/crv')
export class CrvController {
  constructor(private readonly crv: CrvService) {}

  @Get()
  @RequirePermission('crv', 'view')
  list(@Query() query: CrvListQuery) {
    return this.crv.list(query);
  }

  @Get(':id')
  @RequirePermission('crv', 'view')
  detail(@Param('id') id: string) {
    return this.crv.getDetail(Number(id));
  }

  @Post()
  @RequirePermission('crv', 'create')
  create(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.crv.create(body, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('crv', 'delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.crv.remove(Number(id), user);
  }
}
