import { Module } from '@nestjs/common';
import { EnrichmentService } from './enrichment.service';
import { MockEnrichmentProvider } from './providers/mock.provider';
import { ENRICHMENT_PROVIDER } from './interfaces/enrichment-provider.interface';

@Module({
  providers: [
    EnrichmentService,
    {
      provide: ENRICHMENT_PROVIDER,
      useClass: MockEnrichmentProvider,
    },
  ],
  exports: [EnrichmentService],
})
export class EnrichmentModule {}
