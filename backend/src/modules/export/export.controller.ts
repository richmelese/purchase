import { Controller, ForbiddenException, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type ExcelJS from 'exceljs';
import { createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuthGuard, type AuthUser } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { CurrentUser } from '../../common/current-user.decorator';
import { currentFiscalYear } from '../../common/ethiopian';
import { DatabaseService } from '../../db/database.service';
import { ExportService } from './export.service';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function numOrUndef(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

@Controller('api')
@UseGuards(AuthGuard)
export class ExportController {
  constructor(private readonly svc: ExportService, private readonly db: DatabaseService) {}

  @Get('exports')
  listExports(@CurrentUser() user: AuthUser) {
    return this.svc.getCatalog(user);
  }

  /** Admin-only raw SQLite file download — checked manually per the task spec, not via the permission system. */
  @Get('backup')
  backup(@CurrentUser() user: AuthUser, @Res({ passthrough: false }) res: Response) {
    if (user.role !== 'admin') throw new ForbiddenException('Administrator access required');
    this.db.exec('PRAGMA wal_checkpoint(FULL);'); // flush WAL so the copied file is self-consistent
    const dbPath = resolve(process.env.DATABASE_PATH || 'data/psm.db');
    const stat = statSync(dbPath);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="psm-backup-${date}.db"`);
    res.setHeader('Content-Length', String(stat.size));
    createReadStream(dbPath).pipe(res);
  }

  @Get('export/credit')
  @RequirePermission('credit', 'export')
  async exportCredit(@Res({ passthrough: false }) res: Response) {
    await this.send(res, this.svc.buildCreditWorkbook(), 'credit.xlsx');
  }

  @Get('export/stock')
  @RequirePermission('inventory', 'export')
  async exportStock(@Res({ passthrough: false }) res: Response) {
    await this.send(res, this.svc.buildStockWorkbook(), 'stock.xlsx');
  }

  @Get('export/list/stock-in')
  @RequirePermission('inventory', 'export')
  async exportStockIn(@Res({ passthrough: false }) res: Response) {
    await this.send(res, this.svc.buildStockInWorkbook(), 'stock-in.xlsx');
  }

  @Get('export/list/stock-out')
  @RequirePermission('inventory', 'export')
  async exportStockOut(@Res({ passthrough: false }) res: Response) {
    await this.send(res, this.svc.buildStockOutWorkbook(), 'stock-out.xlsx');
  }

  @Get('export/list/parties')
  @RequirePermission('parties', 'export')
  async exportParties(@Res({ passthrough: false }) res: Response) {
    await this.send(res, this.svc.buildPartiesListWorkbook(), 'supplier-lists.xlsx');
  }

  @Get('export/list/products')
  @RequirePermission('products', 'export')
  async exportProducts(@Res({ passthrough: false }) res: Response) {
    await this.send(res, this.svc.buildProductsListWorkbook(), 'product-lists.xlsx');
  }

  @Get('export/purchases')
  @RequirePermission('purchases', 'export')
  async exportPurchases(@Query('fy') fy: string, @Query('month') month: string, @Res({ passthrough: false }) res: Response) {
    const wb = this.svc.buildPurchasesSalesWorkbook('P', numOrUndef(fy), numOrUndef(month));
    await this.send(res, wb, 'purchases.xlsx');
  }

  @Get('export/sales')
  @RequirePermission('sales', 'export')
  async exportSales(@Query('fy') fy: string, @Query('month') month: string, @Res({ passthrough: false }) res: Response) {
    const wb = this.svc.buildPurchasesSalesWorkbook('S', numOrUndef(fy), numOrUndef(month));
    await this.send(res, wb, 'sales.xlsx');
  }

  @Get('export/withholding')
  @RequirePermission('withholding', 'export')
  async exportWithholding(@Query('fy') fy: string, @Query('month') month: string, @Res({ passthrough: false }) res: Response) {
    const wb = this.svc.buildWithholdingWorkbook(numOrUndef(fy), numOrUndef(month));
    await this.send(res, wb, 'withholding.xlsx');
  }

  @Get('export/vat')
  @RequirePermission('vat', 'export')
  async exportVat(@Query('fy') fy: string, @Res({ passthrough: false }) res: Response) {
    const wb = this.svc.buildVatWorkbook(numOrUndef(fy) ?? currentFiscalYear());
    await this.send(res, wb, 'vat-declaration.xlsx');
  }

  @Get('export/report/:type')
  @RequirePermission('reports', 'export')
  async exportReport(@Param('type') type: string, @Query('fy') fy: string, @Query('month') month: string, @Res({ passthrough: false }) res: Response) {
    const wb = this.svc.buildReportWorkbook(type, numOrUndef(fy) ?? currentFiscalYear(), numOrUndef(month));
    await this.send(res, wb, `report-${type}.xlsx`);
  }

  private async send(res: Response, wb: ExcelJS.Workbook, filename: string) {
    res.setHeader('Content-Type', XLSX_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  }
}
