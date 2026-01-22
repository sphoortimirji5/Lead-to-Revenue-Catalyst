import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Histogram } from 'prom-client';
import { Lead } from '../leads/lead.entity';
import { AI_PROVIDER, LeadIntent, AiAnalysisResult, GroundingStatus, GroundingSource, LeadDecision } from './interfaces/ai-provider.interface';
import { AI_ANALYSIS_DURATION } from '../common/metrics.providers';
import type { AiProvider } from './interfaces/ai-provider.interface';
import { EnrichmentService } from '../enrichment/enrichment.service';

@Injectable()
export class AiService {
    private readonly logger = new Logger(AiService.name);

    constructor(
        @Inject(AI_PROVIDER) private readonly aiProvider: AiProvider,
        @InjectMetric(AI_ANALYSIS_DURATION) private readonly durationHistogram: Histogram<string>,
        private readonly enrichmentService: EnrichmentService,
    ) { }

    async analyzeLead(leadData: Partial<Lead>): Promise<AiAnalysisResult> {
        const stopTimer = this.durationHistogram.startTimer();
        let enrichmentData = null;

        try {
            if (leadData.email) {
                enrichmentData = await this.enrichmentService.getCompanyByEmail(leadData.email);
            }
        } catch (error) {
            this.logger.warn(`Enrichment failed for ${leadData.email}: ${error.message}`);
        }

        try {
            // 1. Call LLM with Enrichment Context
            const result = await this.aiProvider.analyzeLead(leadData, enrichmentData);

            // 2. Validate Grounding (Source of Truth Check)
            const validatedResult = this.validateGrounding(result, enrichmentData);

            stopTimer();
            return validatedResult;
        } catch (error) {
            stopTimer();
            this.logger.error(`AI Analysis failed, using fallback: ${error.message}`, error.stack);
            return {
                fitScore: 0,
                intent: LeadIntent.MANUAL_REVIEW,
                decision: LeadDecision.IGNORE,
                reasoning: `Analysis Failed: ${error.message}`,
                evidence: [],
                grounding_status: GroundingStatus.REJECTED,
                grounding_errors: [error.message]
            };
        }
    }

    private validateGrounding(result: AiAnalysisResult, enrichmentData: any): AiAnalysisResult {
        const errors: string[] = [];
        let status = GroundingStatus.VALID;

        // Rule 1: High Intent Requirements
        if (result.intent === LeadIntent.HIGH_FIT) {
            const hasBehavioralEvidence = result.evidence.some(e =>
                [GroundingSource.PRODUCT, GroundingSource.MARKETO, GroundingSource.COMPUTED, GroundingSource.SALESFORCE].includes(e.source)
            );
            if (!hasBehavioralEvidence) {
                errors.push('High Intent requires at least one behavioral/computed evidence item.');
                // Downgrade Action
                result.intent = LeadIntent.MEDIUM_FIT;
                result.fitScore = Math.min(result.fitScore, 70);
                status = GroundingStatus.DOWNGRADED;
            }
        }

        // Rule 2: Firmographic Claims & Enrichment
        const firmographicClaims = result.evidence.filter(e => e.claim_type === 'FIRMOGRAPHIC');
        if (firmographicClaims.length > 0) {
            if (!enrichmentData) {
                // If enrichment is missing, firmographic claims are forbidden acts of hallucination
                throw new Error('AI made firmographic claims without available enrichment data.');
            }

            // Rule 3: Conflict Checking (Basic Equality Check)
            // In a real system, this would be fuzzy matching.
            for (const claim of firmographicClaims) {
                if (claim.source === GroundingSource.ENRICHMENT) {
                    // Extract field name from namespaced path (e.g., 'enrichment.industry' -> 'industry')
                    const fieldName = claim.field_path.split('.').pop() || claim.field_path;
                    const truthValue = enrichmentData[fieldName];
                    if (!truthValue) continue; // Field not in mock data, skip strict check for now or fail

                    // Simple inclusion check for robustness
                    const claimValStr = String(claim.value).toLowerCase();
                    const truthValStr = String(truthValue).toLowerCase();

                    if (!truthValStr.includes(claimValStr) && !claimValStr.includes(truthValStr)) {
                        throw new Error(`Hallucination detected: AI claimed ${claim.field_path}="${claim.value}" but Enrichment says "${truthValue}"`);
                    }
                }
            }
        }

        // Check for Disallowed Sources
        const disallowed = result.evidence.filter(e => !Object.values(GroundingSource).includes(e.source));
        if (disallowed.length > 0) {
            throw new Error(`AI cited unauthorized source: ${disallowed.map(e => e.source).join(', ')}`);
        }

        return {
            ...result,
            grounding_status: status,
            grounding_errors: errors.length > 0 ? errors : undefined
        };
    }
}
