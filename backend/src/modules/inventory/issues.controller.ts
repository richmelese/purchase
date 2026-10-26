import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { CurrentUser } from '../../common/current-user.decorator';
import { InventoryService, type IssueBody } from './inventory.service';

@Controller('api/issues')
@UseGuards(AuthGuard)
export class IssuesController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @RequirePermission('inventory', 'view')
  list() {
    return this.inventory.listIssues();
  }

  @Post()
  @RequirePermission('inventory', 'create')
  create(@Body() body: IssueBody, @CurrentUser() user: AuthUser) {
    return this.inventory.createIssue(body, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('inventory', 'delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    this.inventory.deleteIssue(id, user);
  }
}
