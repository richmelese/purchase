import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { IssuesController } from './issues.controller';
import { StockController } from './stock.controller';
import { InventoryService } from './inventory.service';

@Module({
  controllers: [ProductsController, IssuesController, StockController],
  providers: [InventoryService],
})
export class InventoryModule {}
