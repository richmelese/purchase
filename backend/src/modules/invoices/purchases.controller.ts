import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import type { AuthUser } from '../../common/auth.guard';
import { InvoicesService, ListQuery } from './invoices.service';

@UseGuards(AuthGuard)
@Controller('api/purchases')
export class PurchasesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission('purchases', 'view')
  list(@Query() query: ListQuery) {
    return this.invoices.list('P', query);
  }

  @Get('next-number')
  @RequirePermission('purchases', 'view')
  nextNumber() {
    return { number: this.invoices.nextNumber('P') };
  }

  @Get(':id')
  @RequirePermission('purchases', 'view')
  detail(@Param('id') id: string) {
    return this.invoices.getDetail('P', Number(id));
  }

  @Post()
  @RequirePermission('purchases', 'create')
  create(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.invoices.create('P', body, user);
  }

  @Post('report-status')
  @RequirePermission('purchases', 'edit')
  reportStatus(@Body() body: { ids: number[]; status: string }, @CurrentUser() user: AuthUser) {
    this.invoices.bulkReportStatus('P', body.ids, body.status, user);
    return { ok: true };
  }

  @Put(':id')
  @RequirePermission('purchases', 'edit', 'update_purchase')
  update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.invoices.update('P', Number(id), body, user);
  }

  @Put(':id/withholding')
  @RequirePermission('purchases', 'edit', 'update_purchase')
  withholding(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.invoices.updateWithholding('P', Number(id), body, user);
  }

  @Post(':id/payments')
  @RequirePermission('purchases', 'edit', 'record_payment_p')
  addPayment(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.invoices.addPayment('P', Number(id), body, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('purchases', 'delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    this.invoices.remove('P', Number(id), user);
  }
}
