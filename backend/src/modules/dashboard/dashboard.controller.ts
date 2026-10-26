import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { currentFiscalYear } from '../../common/ethiopian';
import { DashboardService } from './dashboard.service';

@Controller('api/dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  @RequirePermission('reports', 'view')
  get(@Query('fy') fy?: string) {
    const year = fy !== undefined && fy !== '' ? Number(fy) : currentFiscalYear();
    return this.service.summary(year);
  }
}
