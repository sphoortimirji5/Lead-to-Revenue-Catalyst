import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Job } from 'bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { AppModule } from './../src/app.module';
import { Lead } from './../src/leads/lead.entity';
import { LeadProcessor } from './../src/ai/lead.processor';
import { CrmSyncLog } from './../src/mcp/entities/crm-sync-log.entity';
import {
  AI_PROVIDER,
  LeadIntent,
  LeadDecision,
  GroundingSource,
  GroundingStatus,
} from './../src/ai/interfaces/ai-provider.interface';
import { ENRICHMENT_PROVIDER } from './../src/enrichment/interfaces/enrichment-provider.interface';
import { MCPService } from './../src/mcp/mcp.service';

describe('MCP Integration Flow (e2e)', () => {
  let app: INestApplication;
  let leadRepository: Repository<Lead>;
  let syncLogRepository: Repository<CrmSyncLog>;
  let leadProcessor: LeadProcessor;
  let mcpService: MCPService;

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
    syncLogRepository = moduleFixture.get(getRepositoryToken(CrmSyncLog));
    leadProcessor = moduleFixture.get<LeadProcessor>(LeadProcessor);
    mcpService = moduleFixture.get<MCPService>(MCPService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Full MCP Flow', () => {
    it('should process lead through MCP and create sync logs', async () => {
      // 1. Setup Mocks - Valid grounding scenario
      mockEnrichmentProvider.getCompanyByDomain.mockResolvedValue({
        name: 'Stripe',
        domain: 'stripe.com',
        employees: 5000,
        industry: 'Fintech',
        techStack: ['Ruby', 'Node.js'],
        geo: 'US',
      });

      mockAiProvider.analyzeLead.mockResolvedValue({
        fitScore: 92,
        intent: LeadIntent.HIGH_FIT,
        decision: LeadDecision.ROUTE_TO_SDR,
        reasoning: 'High fit Fintech company with strong tech stack',
        evidence: [
          {
            source: GroundingSource.ENRICHMENT,
            field_path: 'enrichment.industry',
            value: 'Fintech',
            claim_type: 'FIRMOGRAPHIC',
          },
        ],
        grounding_status: GroundingStatus.VALID,
        grounding_errors: null,
      });

      // 2. Submit Lead
      const payload = {
        email: `mcp-test-${Date.now()}@stripe.com`,
        campaign_id: 'mcp_launch_2024',
        name: 'John Doe',
      };

      const response = await request(app.getHttpServer())
        .post('/leads')
        .send(payload)
        .expect(201);

      const leadId = (response.body as { id: number }).id;

      // 3. Manually Trigger Worker (Simulate Queue Processing)
      const mockJob = {
        data: { leadId },
        updateProgress: jest.fn(),
        log: jest.fn(),
      } as unknown as Job;

      const result = await leadProcessor.process(mockJob);

      // 4. Verify Lead Processing Result
      expect(result.success).toBe(true);
      expect(result.mcpStatus).toBe('COMPLETED');
      expect(result.mcpExecutionId).toBeDefined();

      // 5. Verify Lead Persistence
      const enrichedLead = await leadRepository.findOne({
        where: { id: leadId },
      });

      expect(enrichedLead).toBeDefined();
      expect(enrichedLead?.status).toBe('ENRICHED');
      expect(enrichedLead?.intent).toBe(LeadIntent.HIGH_FIT);
      expect(enrichedLead?.fitScore).toBe(92);
      expect(enrichedLead?.grounding_status).toBe(GroundingStatus.VALID);

      // 6. Verify CRM Sync Logs Created
      const syncLogs = await syncLogRepository.find({
        where: { mcpExecutionId: result.mcpExecutionId },
      });

      expect(syncLogs.length).toBeGreaterThan(0);
      expect(syncLogs.some((log) => log.action === 'upsert_lead')).toBe(true);
    });

    it('should reject lead when grounding fails', async () => {
      // 1. Setup Mocks - Grounding REJECTED scenario
      mockEnrichmentProvider.getCompanyByDomain.mockResolvedValue({
        name: 'Stripe',
        domain: 'stripe.com',
        industry: 'Fintech',
      });

      mockAiProvider.analyzeLead.mockResolvedValue({
        fitScore: 50,
        intent: LeadIntent.MEDIUM_FIT,
        decision: LeadDecision.NURTURE,
        reasoning: 'Healthcare company - proceed with caution',
        evidence: [
          {
            source: GroundingSource.ENRICHMENT,
            field_path: 'enrichment.industry',
            value: 'Healthcare', // CONFLICT: Enrichment says Fintech
            claim_type: 'FIRMOGRAPHIC',
          },
        ],
        grounding_status: GroundingStatus.REJECTED,
        grounding_errors: [
          "Claim industry='Healthcare' not found in enrichmentData (industry=Fintech)",
        ],
      });

      // 2. Submit Lead
      const payload = {
        email: `mcp-rejected-${Date.now()}@stripe.com`,
        campaign_id: 'mcp_launch_2024',
        name: 'Rejected User',
      };

      const response = await request(app.getHttpServer())
        .post('/leads')
        .send(payload)
        .expect(201);

      const leadId = (response.body as { id: number }).id;

      // 3. Manually Trigger Worker
      const mockJob = {
        data: { leadId },
        updateProgress: jest.fn(),
        log: jest.fn(),
      } as unknown as Job;

      const result = await leadProcessor.process(mockJob);

      // 4. Verify MCP Rejection
      expect(result.success).toBe(false);
      expect(result.mcpStatus).toBe('REJECTED_BY_GROUNDING');

      // 5. Verify Lead Status
      const rejectedLead = await leadRepository.findOne({
        where: { id: leadId },
      });

      expect(rejectedLead?.grounding_status).toBe(GroundingStatus.REJECTED);
      expect(rejectedLead?.grounding_errors).toBeDefined();
    });

    it('should handle downgraded grounding with warnings', async () => {
      // 1. Setup Mocks - Grounding DOWNGRADED scenario
      mockEnrichmentProvider.getCompanyByDomain.mockResolvedValue(null);

      mockAiProvider.analyzeLead.mockResolvedValue({
        fitScore: 65,
        intent: LeadIntent.MEDIUM_FIT,
        decision: LeadDecision.NURTURE,
        reasoning: 'Moderate fit - limited data available',
        evidence: [],
        grounding_status: GroundingStatus.DOWNGRADED,
        grounding_errors: ['No enrichment data available for verification'],
      });

      // 2. Submit Lead
      const payload = {
        email: `mcp-downgraded-${Date.now()}@unknown.com`,
        campaign_id: 'mcp_launch_2024',
        name: 'Unknown User',
      };

      const response = await request(app.getHttpServer())
        .post('/leads')
        .send(payload)
        .expect(201);

      const leadId = (response.body as { id: number }).id;

      // 3. Manually Trigger Worker
      const mockJob = {
        data: { leadId },
        updateProgress: jest.fn(),
        log: jest.fn(),
      } as unknown as Job;

      const result = await leadProcessor.process(mockJob);

      // 4. Verify MCP succeeded (DOWNGRADED is allowed to proceed)
      expect(result.success).toBe(true);
      expect(result.mcpStatus).toBe('COMPLETED');

      // 5. Verify Lead Status
      const downgradedLead = await leadRepository.findOne({
        where: { id: leadId },
      });

      expect(downgradedLead?.grounding_status).toBe(GroundingStatus.DOWNGRADED);
    });
  });

  describe('MCPService Unit Integration', () => {
    it('should build correct action plan from AI result', async () => {
      // Create a test lead
      const lead = leadRepository.create({
        email: 'unit-test@example.com',
        campaignId: 'test-campaign',
        name: 'Test User',
        idempotencyKey: `test-${Date.now()}`,
        status: 'ENRICHED',
        fitScore: 85,
        intent: LeadIntent.HIGH_FIT,
      });
      await leadRepository.save(lead);

      const aiResult = {
        fitScore: 85,
        intent: LeadIntent.HIGH_FIT,
        decision: LeadDecision.ROUTE_TO_SDR,
        reasoning: 'Good fit',
        evidence: [],
        grounding_status: GroundingStatus.VALID,
        grounding_errors: null,
      };

      const enrichmentData = {
        name: 'Test Corp',
        domain: 'example.com',
        industry: 'Technology',
        employees: 100,
        geo: 'US',
        techStack: ['Node.js'],
      };

      const result = await mcpService.processAfterGrounding(
        lead,
        aiResult,
        enrichmentData,
      );

      expect(result.status).toBe('COMPLETED');
      expect(result.results).toBeDefined();
      expect(result.results?.length).toBeGreaterThan(0);

      // Verify actions include upsert_lead, set_lead_score, sync_firmographics, log_activity
      const toolNames = result.results?.map((r) => r.tool) ?? [];
      expect(toolNames).toContain('upsert_lead');
      expect(toolNames).toContain('set_lead_score');
      expect(toolNames).toContain('sync_firmographics');
      expect(toolNames).toContain('log_activity');
    });
  });
});
