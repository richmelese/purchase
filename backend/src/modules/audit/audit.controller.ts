import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { AUDIT_ENTITIES } from '../../common/activity-log';
import { AuditService } from './audit.service';

@Controller('api/audit')
@UseGuards(AuthGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('entities')
  @RequirePermission('audit', 'view')
  entities() {
    return AUDIT_ENTITIES;
  }

  @Get()
  @RequirePermission('audit', 'view')
  list(@Query('limit') limit?: string, @Query('entity') entity?: string, @Query('q') q?: string) {
    return this.audit.query({ limit, entity, q });
  }
}
