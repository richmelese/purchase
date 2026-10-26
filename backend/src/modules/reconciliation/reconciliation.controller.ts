import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ReconciliationService } from './reconciliation.service';
import { AuthGuard } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { CurrentUser } from '../../common/current-user.decorator';
import type { AuthUser } from '../../common/auth.guard';

@Controller('api/reconciliation')
@UseGuards(AuthGuard)
export class ReconciliationController {
  constructor(private readonly service: ReconciliationService) {}

  @Get('summary')
  @RequirePermission('reconciliation', 'view')
  summary() {
    return this.service.getSummary();
  }

  @Get('banks')
  @RequirePermission('reconciliation', 'view')
  getBanks() {
    return this.service.getBanks();
  }

  @Post('banks')
  @RequirePermission('reconciliation', 'create')
  createBank(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.service.createBank(user, body);
  }

  @Put('banks/:id')
  @RequirePermission('reconciliation', 'edit')
  updateBank(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.service.updateBank(user, Number(id), body);
  }

  @Get('transactions')
  @RequirePermission('reconciliation', 'view')
  getTransactions(@Query('bankAccountId') bankAccountId: string, @Query('search') search: string) {
    return this.service.getTransactions(bankAccountId ? Number(bankAccountId) : undefined, search || '');
  }

  @Post('transactions')
  @RequirePermission('reconciliation', 'create', 'create_bank_tx')
  createTransaction(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.service.createTransaction(user, body);
  }

  @Put('transactions/:id')
  @RequirePermission('reconciliation', 'edit')
  updateTransaction(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.service.updateTransaction(user, Number(id), body);
  }

  @Delete('transactions/:id')
  @HttpCode(204)
  @RequirePermission('reconciliation', 'delete')
  deleteTransaction(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.service.deleteTransaction(user, Number(id));
  }

  @Get('purchases')
  @RequirePermission('reconciliation', 'view')
  getPurchases(@Query('status') status: string, @Query('search') search: string) {
    return this.service.getPurchases(status || 'all', search || '');
  }

  @Get('sales')
  @RequirePermission('reconciliation', 'view')
  getSales(@Query('status') status: string, @Query('search') search: string) {
    return this.service.getSales(status || 'all', search || '');
  }

  @Post('auto-match')
  @RequirePermission('reconciliation', 'edit', 'run_automatch')
  autoMatch(@CurrentUser() user: AuthUser) {
    return this.service.autoMatch(user);
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermission('reconciliation', 'create', 'import_bank')
  importXlsx(@CurrentUser() user: AuthUser, @Req() req: Request) {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
    return this.service.importXlsx(user, buf);
  }

  @Get('export')
  @RequirePermission('reconciliation', 'export')
  async exportXlsx(@Res() res: Response) {
    const buffer = await this.service.exportXlsx();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="bank-reconciliation.xlsx"',
    });
    res.send(buffer);
  }
}
