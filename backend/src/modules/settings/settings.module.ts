import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { CompanyProfileController } from './company-profile.controller';
import { LookupsController } from './lookups.controller';
import { FiscalYearsController } from './fiscal-years.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController, CompanyProfileController, LookupsController, FiscalYearsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
