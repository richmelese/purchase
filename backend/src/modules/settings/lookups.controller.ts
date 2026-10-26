import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { CurrentUser } from '../../common/current-user.decorator';
import { SettingsService } from './settings.service';

@Controller('api/lookups')
@UseGuards(AuthGuard)
export class LookupsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.getLookups();
  }

  @Post(':list')
  @RequirePermission('lookups', 'edit')
  add(@Param('list') list: string, @Body() body: { value?: string; label: string }, @CurrentUser() user: AuthUser) {
    return this.settings.addLookupValue(list, body, user);
  }

  @Put(':list/:value')
  @RequirePermission('lookups', 'edit')
  rename(
    @Param('list') list: string,
    @Param('value') value: string,
    @Body() body: { label: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.settings.renameLookupValue(list, value, body, user);
  }

  @Delete(':list/:value')
  @RequirePermission('lookups', 'edit')
  remove(@Param('list') list: string, @Param('value') value: string, @CurrentUser() user: AuthUser) {
    return this.settings.deleteLookupValue(list, value, user);
  }

  @Post(':list/:value/move')
  @RequirePermission('lookups', 'edit')
  move(
    @Param('list') list: string,
    @Param('value') value: string,
    @Body() body: { dir: 'up' | 'down' },
    @CurrentUser() user: AuthUser,
  ) {
    return this.settings.moveLookupValue(list, value, body.dir, user);
  }
}
