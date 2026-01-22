import { Injectable, Inject } from '@nestjs/common';
import { ENRICHMENT_PROVIDER } from './interfaces/enrichment-provider.interface';
import type { EnrichmentProvider, CompanyData } from './interfaces/enrichment-provider.interface';

export type { CompanyData }; // Re-export for consumers

@Injectable()
export class EnrichmentService {
    constructor(
        @Inject(ENRICHMENT_PROVIDER) private readonly provider: any, // Using 'any' as interface injection is tricky with isolatedModules, or need correct import type usage combined with @Inject token
    ) { }
    // Actually, wait. The error 9bcd31eb... says "A type referenced in a decorated signature must be imported with 'import type' or a namespace import".
    // But if I use 'import type', then it won't be emitted for the decorator metadata, which NestJS needs IF it wasn't using @Inject.
    // Since I am using @Inject(ENRICHMENT_PROVIDER), I don't technically need the type emitted for DI purposes, but TS might still complain.
    // The safe fix is often to use the interface as a type only, but valid injection relies on the token.
    // Let's try to just fix the import at the top to split it.

    async getCompanyByEmail(email: string): Promise<CompanyData | null> {
        if (!email || !email.includes('@')) return null;
        const domain = email.split('@')[1];
        return this.getCompanyByDomain(domain);
    }

    async getCompanyByDomain(domain: string): Promise<CompanyData | null> {
        return this.provider.getCompanyByDomain(domain);
    }
}
