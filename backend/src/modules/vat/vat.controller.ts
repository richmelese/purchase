import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { currentFiscalYear } from '../../common/ethiopian';
import { VatService } from './vat.service';

@Controller('api/vat')
@UseGuards(AuthGuard)
export class VatController {
  constructor(private readonly service: VatService) {}

  @Get()
  @RequirePermission('vat', 'view')
  get(@Query('fy') fy?: string) {
    const year = fy !== undefined && fy !== '' ? Number(fy) : currentFiscalYear();
    return this.service.get(year);
  }

  @Put('adjustments')
  @RequirePermission('vat', 'edit')
  update(@Body() body: { fy: number; items: { line_no: number; fy_month: number; amount: number }[] }) {
    return this.service.updateAdjustments(Number(body.fy), Array.isArray(body.items) ? body.items : []);
  }
}
