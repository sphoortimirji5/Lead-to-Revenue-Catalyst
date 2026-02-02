import { Injectable } from '@nestjs/common';
import {
  EnrichmentProvider,
  CompanyData,
} from '../interfaces/enrichment-provider.interface';

@Injectable()
export class MockEnrichmentProvider implements EnrichmentProvider {
  // Mock Database for "Clearbit-like" data
  private readonly mockDb: Record<string, CompanyData> = {
    'stripe.com': {
      name: 'Stripe',
      domain: 'stripe.com',
      employees: '5000-10000',
      industry: 'Fintech',
      techStack: ['Ruby', 'React', 'AWS'],
      geo: 'San Francisco, CA',
    },
    'netflix.com': {
      name: 'Netflix',
      domain: 'netflix.com',
      employees: '10000+',
      industry: 'Entertainment',
      techStack: ['Java', 'React', 'AWS'],
      geo: 'Los Gatos, CA',
    },
  };

  getCompanyByDomain(domain: string): Promise<CompanyData | null> {
    return Promise.resolve(this.mockDb[domain.toLowerCase()] || null);
  }
}
