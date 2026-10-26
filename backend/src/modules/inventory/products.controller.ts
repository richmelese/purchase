import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { CurrentUser } from '../../common/current-user.decorator';
import { InventoryService, type ProductBody } from './inventory.service';

@Controller('api/products')
@UseGuards(AuthGuard)
export class ProductsController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @RequirePermission('products', 'view')
  list() {
    return this.inventory.listProducts();
  }

  @Get('next-code')
  @RequirePermission('products', 'view')
  nextCode() {
    return { code: this.inventory.getNextProductCode() };
  }

  @Get(':id/movements')
  @RequirePermission('products', 'view')
  movements(@Param('id', ParseIntPipe) id: number) {
    return this.inventory.getProductMovements(id);
  }

  @Post()
  @RequirePermission('products', 'create')
  create(@Body() body: ProductBody, @CurrentUser() user: AuthUser) {
    return this.inventory.createProduct(body, user);
  }

  @Put(':id')
  @RequirePermission('products', 'edit')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: ProductBody, @CurrentUser() user: AuthUser) {
    return this.inventory.updateProduct(id, body, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('products', 'delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    this.inventory.deleteProduct(id, user);
  }
}
