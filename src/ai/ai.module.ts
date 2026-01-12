import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { LeadProcessor } from './lead.processor';
import { Lead } from '../leads/lead.entity';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [TypeOrmModule.forFeature([Lead]), CrmModule],
  providers: [AiService, LeadProcessor],
  exports: [AiService],
})
export class AiModule { }
