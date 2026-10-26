import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import type { AuthUser } from '../../common/auth.guard';
import { InvoicesService, ListQuery } from './invoices.service';

@UseGuards(AuthGuard)
@Controller('api/sales')
export class SalesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission('sales', 'view')
  list(@Query() query: ListQuery) {
    return this.invoices.list('S', query);
  }

  @Get('next-number')
  @RequirePermission('sales', 'view')
  nextNumber() {
    return { number: this.invoices.nextNumber('S') };
  }

  @Get(':id')
  @RequirePermission('sales', 'view')
  detail(@Param('id') id: string) {
    return this.invoices.getDetail('S', Number(id));
  }

  @Post()
  @RequirePermission('sales', 'create')
  create(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.invoices.create('S', body, user);
  }

  @Post('report-status')
  @RequirePermission('sales', 'edit')
  reportStatus(@Body() body: { ids: number[]; status: string }, @CurrentUser() user: AuthUser) {
    this.invoices.bulkReportStatus('S', body.ids, body.status, user);
    return { ok: true };
  }

  @Put(':id')
  @RequirePermission('sales', 'edit')
  update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.invoices.update('S', Number(id), body, user);
  }

  @Put(':id/withholding')
  @RequirePermission('sales', 'edit')
  withholding(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.invoices.updateWithholding('S', Number(id), body, user);
  }

  @Post(':id/payments')
  @RequirePermission('sales', 'edit')
  addPayment(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.invoices.addPayment('S', Number(id), body, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('sales', 'delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    this.invoices.remove('S', Number(id), user);
  }
}
