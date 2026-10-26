import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { ReportsService } from './reports.service';

@Controller('api/reports')
@UseGuards(AuthGuard)
@RequirePermission('reports', 'view')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('monthly')
  monthly(@Query('fy') fy: string) {
    return this.service.monthly(Number(fy));
  }

  @Get('products')
  products(@Query('fy') fy: string, @Query('month') month?: string) {
    return this.service.products(Number(fy), month);
  }

  @Get('parties/purchases')
  partiesPurchases(@Query('fy') fy: string, @Query('month') month?: string) {
    return this.service.parties('P', Number(fy), month);
  }

  @Get('parties/sales')
  partiesSales(@Query('fy') fy: string, @Query('month') month?: string) {
    return this.service.parties('S', Number(fy), month);
  }
}
