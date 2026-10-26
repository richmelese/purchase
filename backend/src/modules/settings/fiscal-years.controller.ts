import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard';
import { SettingsService } from './settings.service';

@Controller('api/fiscal-years')
@UseGuards(AuthGuard)
export class FiscalYearsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.getFiscalYears();
  }
}
