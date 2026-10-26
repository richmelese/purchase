import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { CreditService } from './credit.service';

@Controller('api/credit')
@UseGuards(AuthGuard)
@RequirePermission('credit', 'view')
export class CreditController {
  constructor(private readonly service: CreditService) {}

  @Get('buckets')
  buckets() {
    return this.service.buckets();
  }

  @Get('purchases')
  purchases(@Query('all') all?: string) {
    return this.service.list('P', !!all);
  }

  @Get('sales')
  sales(@Query('all') all?: string) {
    return this.service.list('S', !!all);
  }
}
