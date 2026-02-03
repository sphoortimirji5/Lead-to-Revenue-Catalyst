import { Injectable, Logger } from '@nestjs/common';
import {
  EnrichmentProvider,
  CompanyData,
} from '../interfaces/enrichment-provider.interface';

/**
 * Clearbit Enrichment Provider
 * Production implementation using Clearbit API
 *
 * NOTE: This is a stub. Full implementation requires:
 * 1. npm install clearbit
 * 2. Clearbit API key in AWS Secrets Manager
 * 3. API subscription
 */
@Injectable()
export class ClearbitProvider implements EnrichmentProvider {
  private readonly logger = new Logger(ClearbitProvider.name);

  constructor() {
    this.logger.log('ClearbitProvider initialized (stub mode)');
  }

  getCompanyByDomain(domain: string): Promise<CompanyData | null> {
    this.logger.warn(
      `Clearbit API not implemented - returning null for domain: ${domain}`,
    );

    // TODO: Implement with Clearbit SDK
    // const clearbit = require('clearbit')(process.env.CLEARBIT_API_KEY);
    // const company = await clearbit.Company.find({ domain });
    // return {
    //   name: company.name,
    //   domain: company.domain,
    //   employees: company.metrics.employees,
    //   industry: company.category.industry,
    //   techStack: company.tech || [],
    //   geo: company.geo.city,
    // };

    return Promise.resolve(null);
  }
}
