import { Lead } from '../../leads/lead.entity';
import { CompanyData } from '../../enrichment/enrichment.service';

export enum LeadIntent {
    LOW_FIT = 'Low Fit',
    MEDIUM_FIT = 'Medium Fit',
    HIGH_FIT = 'High Fit',
    MANUAL_REVIEW = 'Manual Review',
}

export enum LeadDecision {
    ROUTE_TO_SDR = 'Route to SDR',
    NURTURE = 'Nurture',
    IGNORE = 'Ignore',
}

export enum GroundingSource {
    SALESFORCE = 'SALESFORCE',
    MARKETO = 'MARKETO',
    PRODUCT = 'PRODUCT',
    ENRICHMENT = 'ENRICHMENT',
    COMPUTED = 'COMPUTED',
}

export enum GroundingStatus {
    VALID = 'VALID',
    DOWNGRADED = 'DOWNGRADED',
    REJECTED = 'REJECTED',
}

export interface Evidence {
    source: GroundingSource;
    field_path: string; // Namespaced path, e.g., 'enrichment.industry'
    value: any;
    claim_type: 'FIRMOGRAPHIC' | 'BEHAVIOR' | 'PIPELINE' | 'SCORE';
}

export interface AiAnalysisResult {
    fitScore: number;
    intent: LeadIntent;
    decision: LeadDecision;
    reasoning: string;
    evidence: Evidence[];
    grounding_status?: GroundingStatus; // Added by Service, not Provider
    grounding_errors?: string[]; // Added by Service
}

export interface AiProvider {
    analyzeLead(leadData: Partial<Lead>, enrichmentData?: CompanyData | null): Promise<AiAnalysisResult>;
}

export const AI_PROVIDER = 'AI_PROVIDER';
