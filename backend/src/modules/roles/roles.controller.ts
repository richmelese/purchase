import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { CurrentUser } from '../../common/current-user.decorator';
import { DatabaseService } from '../../db/database.service';
import { logActivity } from '../../common/activity-log';
import { RESOURCES, RIGHTS } from '../../common/permissions';
import { RolesService, type RoleBody } from './roles.service';

@Controller('api/roles')
@UseGuards(AuthGuard)
export class RolesController {
  constructor(private readonly roles: RolesService, private readonly db: DatabaseService) {}

  @Get()
  @RequirePermission('roles', 'view')
  list() {
    return this.roles.list();
  }

  // Gated by sign-in only (not `roles.view`) — the Roles & Permissions editor needs this catalog
  // to render, and the UI itself already hides the page without `roles.view`; the server still
  // requires an authenticated session via the controller-level AuthGuard.
  @Get('resources')
  resources() {
    return { resources: RESOURCES, rights: RIGHTS };
  }

  @Post()
  @RequirePermission('roles', 'create')
  async create(@Body() body: RoleBody, @CurrentUser() user: AuthUser) {
    const created = await this.roles.create(body);
    await logActivity(this.db, user, 'create', 'roles', created.id, `created role ${created.label}`);
    return created;
  }

  @Put(':id')
  @RequirePermission('roles', 'edit')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: RoleBody, @CurrentUser() user: AuthUser) {
    const updated = await this.roles.update(id, body);
    await logActivity(this.db, user, 'update', 'roles', id, `updated role ${updated.label}`);
    return updated;
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('roles', 'delete')
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    const removed = await this.roles.remove(id);
    await logActivity(this.db, user, 'delete', 'roles', id, `deleted role ${removed.label}`);
  }
}
