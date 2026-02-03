import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { metricsProviders } from '../common/metrics.providers';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './ai.service';
import { LeadProcessor } from './lead.processor';
import { Lead } from '../leads/lead.entity';
import { AI_PROVIDER } from './interfaces/ai-provider.interface';
import { GeminiProvider } from './providers/gemini.provider';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { DlqProcessor, DlqEventListener } from './dlq';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead]),
    ConfigModule,
    EnrichmentModule,
    // Register DLQ queue
    BullModule.registerQueue({ name: 'lead-processing-dlq' }),
  ],
  providers: [
    AiService,
    LeadProcessor,
    DlqProcessor,
    DlqEventListener,
    {
      provide: AI_PROVIDER,
      useClass: GeminiProvider,
    },
    ...metricsProviders,
  ],
  exports: [AiService],
})
export class AiModule {}
