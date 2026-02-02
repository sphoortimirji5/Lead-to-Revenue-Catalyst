import { Module } from '@nestjs/common';
import { metricsProviders } from '../common/metrics.providers';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './ai.service';
import { LeadProcessor } from './lead.processor';
import { Lead } from '../leads/lead.entity';
import { AI_PROVIDER } from './interfaces/ai-provider.interface';
import { GeminiProvider } from './providers/gemini.provider';
import { EnrichmentModule } from '../enrichment/enrichment.module';

@Module({
  imports: [TypeOrmModule.forFeature([Lead]), ConfigModule, EnrichmentModule],
  providers: [
    AiService,
    LeadProcessor,
    {
      provide: AI_PROVIDER,
      useClass: GeminiProvider,
    },
    ...metricsProviders,
  ],
  exports: [AiService],
})
export class AiModule {}
