import { Module } from '@nestjs/common';
import { CrvService } from './crv.service';
import { CrvController } from './crv.controller';

@Module({
  controllers: [CrvController],
  providers: [CrvService],
  exports: [CrvService],
})
export class CrvModule {}

