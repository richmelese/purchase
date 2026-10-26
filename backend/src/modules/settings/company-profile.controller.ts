import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { CurrentUser } from '../../common/current-user.decorator';
import type { CompanyProfile } from '../../common/company-profile';
import { SettingsService } from './settings.service';

@Controller('api/company-profile')
@UseGuards(AuthGuard)
export class CompanyProfileController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.getCompanyProfile();
  }

  @Put()
  @RequirePermission('settings', 'edit')
  update(@Body() body: Partial<CompanyProfile>, @CurrentUser() user: AuthUser) {
    return this.settings.updateCompanyProfile(body, user);
  }
}
