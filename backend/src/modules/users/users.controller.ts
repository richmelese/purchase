import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { CurrentUser } from '../../common/current-user.decorator';
import { DatabaseService } from '../../db/database.service';
import { logActivity } from '../../common/activity-log';
import { UsersService, type CreateUserBody, type UpdateUserBody } from './users.service';

const ASSIGNMENT_FIELDS = ['role_id', 'role', 'access_all_parties', 'party_ids', 'party_rights'];

@Controller('api/users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService, private readonly db: DatabaseService) {}

  @Get()
  @RequirePermission('users', 'view')
  list() {
    return this.users.list();
  }

  @Post()
  @RequirePermission('users', 'create')
  create(@Body() body: CreateUserBody, @CurrentUser() actingUser: AuthUser) {
    const created = this.users.create(body);
    logActivity(this.db, actingUser, 'create', 'users', created.id, `created user ${created.username}`);
    return created;
  }

  // No @RequirePermission here — this route accepts a mix of field groups (profile vs. role/company
  // assignment) in one request, each gated by its own task, so UsersService.update does the
  // fine-grained can() checks itself and throws 403 only for groups actually present in the body.
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateUserBody, @CurrentUser() actingUser: AuthUser) {
    const updated = this.users.update(id, body, actingUser);
    let summary: string;
    if (body.password) summary = `reset password for ${updated.username}`;
    else if (ASSIGNMENT_FIELDS.some((k) => k in body)) summary = `updated role/company access for ${updated.username}`;
    else summary = `updated user ${updated.username}`;
    logActivity(this.db, actingUser, 'update', 'users', id, summary);
    return updated;
  }

  @Delete(':id')
  @RequirePermission('users', 'delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() actingUser: AuthUser) {
    const target = this.db.get<{ username: string }>('SELECT username FROM users WHERE id = ?', [id]);
    const list = this.users.remove(id, actingUser);
    logActivity(this.db, actingUser, 'delete', 'users', id, `deleted user ${target?.username ?? id}`);
    return list;
  }
}
