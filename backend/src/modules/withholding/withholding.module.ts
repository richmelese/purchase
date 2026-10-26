import { Module } from '@nestjs/common';
import { WithholdingController } from './withholding.controller';
import { WithholdingService } from './withholding.service';

@Module({
  controllers: [WithholdingController],
  providers: [WithholdingService],
})
export class WithholdingModule {}
