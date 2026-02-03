import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EnrichmentService } from './enrichment.service';
import { MockEnrichmentProvider } from './providers/mock.provider';
import { ClearbitProvider } from './providers/clearbit.provider';
import { ENRICHMENT_PROVIDER } from './interfaces/enrichment-provider.interface';

@Module({
  imports: [ConfigModule],
  providers: [
    EnrichmentService,
    MockEnrichmentProvider,
    ClearbitProvider,
    {
      provide: ENRICHMENT_PROVIDER,
      useFactory: (configService: ConfigService) => {
        const provider = configService.get<string>(
          'ENRICHMENT_PROVIDER',
          'MOCK',
        );

        // Provider switch based on environment variable
        switch (provider.toUpperCase()) {
          case 'CLEARBIT':
            return new ClearbitProvider();
          case 'MOCK':
          default:
            return new MockEnrichmentProvider();
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: [EnrichmentService],
})
export class EnrichmentModule {}
