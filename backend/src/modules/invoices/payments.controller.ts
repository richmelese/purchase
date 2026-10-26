import { Controller, Delete, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import type { AuthUser } from '../../common/auth.guard';
import { InvoicesService } from './invoices.service';

/** Shared route — not nested under /purchases or /sales, per the API contract. */
@UseGuards(AuthGuard)
@Controller('api/payments')
export class PaymentsController {
  constructor(private readonly invoices: InvoicesService) {}

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.invoices.removePaymentShared(Number(id), user);
  }
}
