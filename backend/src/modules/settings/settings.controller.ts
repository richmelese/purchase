import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { CurrentUser } from '../../common/current-user.decorator';
import { SettingsService } from './settings.service';

@Controller('api/settings')
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.getSettings();
  }

  @Put()
  @RequirePermission('settings', 'edit')
  update(
    @Body() body: { vat_rate: number; wh_rate: number; wh_goods_threshold: number; wh_service_threshold: number },
    @CurrentUser() user: AuthUser,
  ) {
    return this.settings.updateSettings(body, user);
  }
}
