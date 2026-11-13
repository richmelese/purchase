import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { PurchasesController } from './purchases.controller';
import { SalesController } from './sales.controller';

@Module({
  controllers: [PurchasesController, SalesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
