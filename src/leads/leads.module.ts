import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { Lead } from './lead.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead]),
    BullModule.registerQueue({
      name: 'lead-processing',
    }),
  ],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule { }
