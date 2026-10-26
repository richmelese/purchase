import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser } from '../../common/auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { PortalService } from './portal.service';

@Controller('api/portal')
@UseGuards(AuthGuard)
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('company')
  company(@CurrentUser() user: AuthUser) {
    return this.portal.company(user);
  }

  @Get('statement')
  statement(@CurrentUser() user: AuthUser) {
    return this.portal.statement(user);
  }

  @Get('invoices')
  invoices(@CurrentUser() user: AuthUser, @Query('kind') kind?: string) {
    return this.portal.invoices(user, kind);
  }

  @Get('invoices/:id')
  invoiceDetail(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.portal.invoiceDetail(user, id);
  }
}
