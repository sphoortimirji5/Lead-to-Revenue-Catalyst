import { Test, TestingModule } from '@nestjs/testing';
import { getToken } from '@willsoto/nestjs-prometheus';
import { AiService } from './ai.service';
import { AI_PROVIDER, LeadIntent, LeadDecision, GroundingSource, GroundingStatus } from './interfaces/ai-provider.interface';
import { AI_ANALYSIS_DURATION } from '../common/metrics.providers';
import { EnrichmentService } from '../enrichment/enrichment.service';

describe('AiService', () => {
    let service: AiService;
    let mockAiProvider: any;
    let mockEnrichmentService: any;

    beforeEach(async () => {
        mockAiProvider = {
            analyzeLead: jest.fn(),
        };

        mockEnrichmentService = {
            getCompanyByEmail: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AiService,
                {
                    provide: AI_PROVIDER,
                    useValue: mockAiProvider,
                },
                {
                    provide: getToken(AI_ANALYSIS_DURATION),
                    useValue: {
                        startTimer: jest.fn().mockReturnValue(jest.fn()),
                    },
                },
                {
                    provide: EnrichmentService,
                    useValue: mockEnrichmentService,
                },
            ],
        }).compile();

        service = module.get<AiService>(AiService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('analyzeLead - Grounding Validation', () => {
        it('should pass validation when evidence is correct', async () => {
            mockEnrichmentService.getCompanyByEmail.mockResolvedValue({ industry: 'Fintech' });
            const mockResponse = {
                fitScore: 90,
                intent: LeadIntent.HIGH_FIT,
                decision: LeadDecision.ROUTE_TO_SDR,
                reasoning: 'High fit due to industry',
                evidence: [
                    { source: GroundingSource.ENRICHMENT, field_path: 'enrichment.industry', value: 'Fintech', claim_type: 'FIRMOGRAPHIC' },
                    { source: GroundingSource.MARKETO, field_path: 'marketo.campaign_id', value: 'launch', claim_type: 'BEHAVIOR' }
                ]
            };
            mockAiProvider.analyzeLead.mockResolvedValue(mockResponse);

            const result = await service.analyzeLead({ email: 'test@stripe.com' });

            expect(result.grounding_status).toBe(GroundingStatus.VALID);
            expect(result.intent).toBe(LeadIntent.HIGH_FIT);
        });

        it('should FAIL (Hard Fail) if AI hallucinates firmographic data', async () => {
            mockEnrichmentService.getCompanyByEmail.mockResolvedValue({ industry: 'Fintech' });
            const mockResponse = {
                fitScore: 80,
                intent: LeadIntent.MEDIUM_FIT,
                decision: LeadDecision.NURTURE,
                reasoning: 'Healthcare company',
                evidence: [
                    { source: GroundingSource.ENRICHMENT, field_path: 'enrichment.industry', value: 'Healthcare', claim_type: 'FIRMOGRAPHIC' }
                ]
            };
            mockAiProvider.analyzeLead.mockResolvedValue(mockResponse);

            const result = await service.analyzeLead({ email: 'test@stripe.com' });

            expect(result.grounding_status).toBe(GroundingStatus.REJECTED);
            expect(result.reasoning).toContain('Analysis Failed: Hallucination detected');
        });

        it('should FAIL (Hard Fail) if AI makes firmographic claims without enrichment', async () => {
            mockEnrichmentService.getCompanyByEmail.mockResolvedValue(null);
            const mockResponse = {
                fitScore: 80,
                intent: LeadIntent.MEDIUM_FIT,
                decision: LeadDecision.NURTURE,
                reasoning: 'Software company',
                evidence: [
                    { source: GroundingSource.ENRICHMENT, field_path: 'enrichment.industry', value: 'Software', claim_type: 'FIRMOGRAPHIC' }
                ]
            };
            mockAiProvider.analyzeLead.mockResolvedValue(mockResponse);

            const result = await service.analyzeLead({ email: 'test@unknown.com' });

            expect(result.grounding_status).toBe(GroundingStatus.REJECTED);
            expect(result.reasoning).toContain('firmographic claims without available enrichment');
        });

        it('should DOWNGRADE intent if High Intent lacks behavioral evidence', async () => {
            mockEnrichmentService.getCompanyByEmail.mockResolvedValue({ industry: 'Fintech' });
            const mockResponse = {
                fitScore: 95,
                intent: LeadIntent.HIGH_FIT, // Requres behavioral evidence
                decision: LeadDecision.ROUTE_TO_SDR,
                reasoning: 'Good industry',
                evidence: [
                    { source: GroundingSource.ENRICHMENT, field_path: 'enrichment.industry', value: 'Fintech', claim_type: 'FIRMOGRAPHIC' }
                ]
            };
            mockAiProvider.analyzeLead.mockResolvedValue(mockResponse);

            const result = await service.analyzeLead({ email: 'test@stripe.com' });

            expect(result.grounding_status).toBe(GroundingStatus.DOWNGRADED);
            expect(result.intent).toBe(LeadIntent.MEDIUM_FIT);
            expect(result.fitScore).toBeLessThan(80);
        });

        it('should FAIL if Disallowed Source is cited', async () => {
            mockEnrichmentService.getCompanyByEmail.mockResolvedValue(null);
            const mockResponse = {
                fitScore: 50,
                intent: LeadIntent.LOW_FIT,
                decision: LeadDecision.IGNORE,
                reasoning: 'Search result',
                evidence: [
                    { source: 'WEB_SEARCH', field_path: 'web.title', value: 'CXO', claim_type: 'BEHAVIOR' }
                ]
            };
            mockAiProvider.analyzeLead.mockResolvedValue(mockResponse);

            const result = await service.analyzeLead({ email: 'test@test.com' });

            expect(result.grounding_status).toBe(GroundingStatus.REJECTED);
            expect(result.reasoning).toContain('unauthorized source');
        });
    });
});
