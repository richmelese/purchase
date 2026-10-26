import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { PurchasesController } from './purchases.controller';
import { SalesController } from './sales.controller';
import { PaymentsController } from './payments.controller';

@Module({
  controllers: [PurchasesController, SalesController, PaymentsController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
