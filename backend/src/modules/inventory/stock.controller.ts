import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { InventoryService } from './inventory.service';

@Controller('api/stock')
@UseGuards(AuthGuard)
export class StockController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('in')
  @RequirePermission('inventory', 'view')
  stockIn() {
    return this.inventory.getStockIn();
  }

  @Get('out')
  @RequirePermission('inventory', 'view')
  stockOut() {
    return this.inventory.getStockOut();
  }
}
