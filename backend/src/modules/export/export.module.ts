import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({
  controllers: [ExportController, ImportController],
  providers: [ExportService, ImportService],
})
export class ExportModule {}
