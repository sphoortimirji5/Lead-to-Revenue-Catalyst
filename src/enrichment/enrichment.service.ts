import { Injectable, Inject } from '@nestjs/common';
import { ENRICHMENT_PROVIDER } from './interfaces/enrichment-provider.interface';
import type {
  EnrichmentProvider,
  CompanyData,
} from './interfaces/enrichment-provider.interface';

export type { CompanyData }; // Re-export for consumers

@Injectable()
export class EnrichmentService {
  constructor(
    @Inject(ENRICHMENT_PROVIDER)
    private readonly provider: EnrichmentProvider,
  ) {}

  async getCompanyByEmail(email: string): Promise<CompanyData | null> {
    if (!email || !email.includes('@')) return null;
    const domain = email.split('@')[1];
    return this.getCompanyByDomain(domain);
  }

  getCompanyByDomain(domain: string): Promise<CompanyData | null> {
    return this.provider.getCompanyByDomain(domain);
  }
}
