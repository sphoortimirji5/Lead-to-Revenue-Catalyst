import { Lead } from '../../leads/lead.entity';

export interface AiAnalysisResult {
    fitScore: number;
    intent: string;
}

export interface AiProvider {
    analyzeLead(leadData: Partial<Lead>): Promise<AiAnalysisResult>;
}

export const AI_PROVIDER = 'AI_PROVIDER';
