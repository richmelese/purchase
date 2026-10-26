import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './db/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { BffSecretGuard } from './common/bff-secret.guard';
import { InventoryModule } from './modules/inventory/inventory.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { AuditModule } from './modules/audit/audit.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { SettingsModule } from './modules/settings/settings.module';
import { PartiesModule } from './modules/parties/parties.module';
import { PortalModule } from './modules/portal/portal.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { ExportModule } from './modules/export/export.module';
import { WithholdingModule } from './modules/withholding/withholding.module';
import { CreditModule } from './modules/credit/credit.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { VatModule } from './modules/vat/vat.module';

@Module({
  imports: [
    DatabaseModule, AuthModule, InventoryModule, UsersModule, RolesModule, AuditModule,
    InvoicesModule, SettingsModule, PartiesModule, PortalModule, ReconciliationModule, ExportModule,
    WithholdingModule, CreditModule, DashboardModule, ReportsModule, VatModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: BffSecretGuard }],
})
export class AppModule {}
