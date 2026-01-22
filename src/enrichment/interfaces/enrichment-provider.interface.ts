export interface CompanyData {
    name: string;
    domain: string;
    employees: string;
    industry: string;
    techStack: string[];
    geo: string;
}

export interface EnrichmentProvider {
    getCompanyByDomain(domain: string): Promise<CompanyData | null>;
}

export const ENRICHMENT_PROVIDER = 'ENRICHMENT_PROVIDER';
