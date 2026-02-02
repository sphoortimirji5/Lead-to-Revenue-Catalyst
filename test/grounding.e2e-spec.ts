import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Job } from 'bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppModule } from './../src/app.module';
import { Lead } from './../src/leads/lead.entity';
import { LeadProcessor } from './../src/ai/lead.processor';
import {
  AI_PROVIDER,
  LeadIntent,
  LeadDecision,
  GroundingSource,
  GroundingStatus,
  Evidence,
} from './../src/ai/interfaces/ai-provider.interface';
import { ENRICHMENT_PROVIDER } from './../src/enrichment/interfaces/enrichment-provider.interface';

interface MockJobData {
  leadId: number;
}

interface LeadWithEvidence extends Lead {
  evidence?: Evidence[];
}

describe('Grounding Flow (e2e)', () => {
  let app: INestApplication;
  let leadRepository: Repository<Lead>;
  let leadProcessor: LeadProcessor;

  const mockAiProvider = {
    analyzeLead: jest.fn(),
  };

  const mockEnrichmentProvider = {
    getCompanyByDomain: jest.fn(),
  };

  // Mock Queue to capture jobs without Redis
  const mockQueue = {
    add: jest.fn().mockImplementation((name: string, data: unknown) => {
      return Promise.resolve({ id: 'job_123', name, data });
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AI_PROVIDER)
      .useValue(mockAiProvider)
      .overrideProvider(ENRICHMENT_PROVIDER)
      .useValue(mockEnrichmentProvider)
      .overrideProvider('BullQueue_leads')
      .useValue(mockQueue)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    leadRepository = moduleFixture.get(getRepositoryToken(Lead));
    leadProcessor = moduleFixture.get<LeadProcessor>(LeadProcessor);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should PROCESS and GROUND a lead correctly', async () => {
    // 1. Setup Mocks
    mockEnrichmentProvider.getCompanyByDomain.mockResolvedValue({
      name: 'Stripe',
      domain: 'stripe.com',
      employees: '5000+',
      industry: 'Fintech',
      techStack: ['Ruby'],
      geo: 'US',
    });

    mockAiProvider.analyzeLead.mockResolvedValue({
      fitScore: 90,
      intent: LeadIntent.HIGH_FIT,
      decision: LeadDecision.ROUTE_TO_SDR,
      reasoning: 'High fit Fintech',
      evidence: [
        {
          source: GroundingSource.ENRICHMENT,
          field_path: 'enrichment.industry',
          value: 'Fintech',
          claim_type: 'FIRMOGRAPHIC',
        },
        {
          source: GroundingSource.MARKETO,
          field_path: 'marketo.campaign_id',
          value: 'launch',
          claim_type: 'BEHAVIOR',
        },
      ],
    });

    // 2. Submit Lead
    const payload = {
      email: `grounding-test-${Date.now()}@stripe.com`,
      campaign_id: 'launch_2024',
      name: 'CTO',
    };

    const response = await request(app.getHttpServer() as unknown as string)
      .post('/leads')
      .send(payload)
      .expect(201);

    const leadId = (response.body as { id: number }).id;

    // 3. Manually Trigger Worker (Simulate Queue Processing)
    const mockJob = {
      data: { leadId: leadId },
      updateProgress: jest.fn(),
      log: jest.fn(),
    } as unknown as Job<MockJobData>;

    await leadProcessor.process(mockJob);

    // 4. Verify Persistence
    const enrichedLead = (await leadRepository.findOne({
      where: { id: leadId },
    })) as LeadWithEvidence;

    expect(enrichedLead.status).toBe('SYNCED_TO_CRM');
    expect(enrichedLead.intent).toBe(LeadIntent.HIGH_FIT);
    expect(enrichedLead.grounding_status).toBe(GroundingStatus.VALID);
    const evidence = enrichedLead.evidence ?? [];
    expect(evidence[0]?.source).toBe('ENRICHMENT');
  });

  it('should REJECT hallucinated claims', async () => {
    // 1. Setup Mocks (Enrichment says Fintech, AI says Healthcare - CONFLICT)
    mockEnrichmentProvider.getCompanyByDomain.mockResolvedValue({
      name: 'Stripe',
      domain: 'stripe.com',
      industry: 'Fintech',
    });

    mockAiProvider.analyzeLead.mockResolvedValue({
      fitScore: 80,
      intent: LeadIntent.MEDIUM_FIT,
      decision: LeadDecision.NURTURE,
      reasoning: 'Healthcare company',
      evidence: [
        {
          source: GroundingSource.ENRICHMENT,
          field_path: 'enrichment.industry',
          value: 'Healthcare',
          claim_type: 'FIRMOGRAPHIC',
        },
      ],
    });

    // 2. Submit Lead
    const payload = {
      email: `hallucination-${Date.now()}@stripe.com`,
      campaign_id: 'launch_2024',
      name: 'Liar',
    };

    const response = await request(app.getHttpServer() as unknown as string)
      .post('/leads')
      .send(payload)
      .expect(201);

    const leadId = (response.body as { id: number }).id;

    // 3. Manually Trigger Worker
    const mockJob = {
      data: { leadId: leadId },
      updateProgress: jest.fn(),
      log: jest.fn(),
    } as unknown as Job<MockJobData>;

    await leadProcessor.process(mockJob);

    // 4. Verify Rejection
    const enrichedLead = await leadRepository.findOne({
      where: { id: leadId },
    });

    expect(enrichedLead?.grounding_status).toBe(GroundingStatus.REJECTED);
    expect(enrichedLead?.grounding_errors).toBeDefined();
  });
});
