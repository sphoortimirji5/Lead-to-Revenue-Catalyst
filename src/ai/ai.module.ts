import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './ai.service';
import { LeadProcessor } from './lead.processor';
import { Lead } from '../leads/lead.entity';
import { CrmModule } from '../crm/crm.module';
import { AI_PROVIDER } from './interfaces/ai-provider.interface';
import { GeminiProvider } from './providers/gemini.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead]),
    ConfigModule,
    CrmModule,
  ],
  providers: [
    AiService,
    LeadProcessor,
    {
      provide: AI_PROVIDER,
      useClass: GeminiProvider,
    },
  ],
  exports: [AiService],
})
export class AiModule { }
