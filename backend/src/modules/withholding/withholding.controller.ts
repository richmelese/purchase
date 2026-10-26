import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { WithholdingService } from './withholding.service';

@Controller('api/withholding')
@UseGuards(AuthGuard)
@RequirePermission('withholding', 'view')
export class WithholdingController {
  constructor(private readonly service: WithholdingService) {}

  @Get('purchases')
  purchases(@Query('fy') fy?: string, @Query('month') month?: string) {
    return this.service.list('P', fy, month);
  }

  @Get('sales')
  sales(@Query('fy') fy?: string, @Query('month') month?: string) {
    return this.service.list('S', fy, month);
  }
}
