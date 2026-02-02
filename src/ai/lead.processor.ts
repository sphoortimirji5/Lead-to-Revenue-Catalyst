import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger, Optional } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { Lead } from '../leads/lead.entity';
import { AiService } from './ai.service';
import { LEADS_PROCESSED_TOTAL } from '../common/metrics.providers';
import { MCPService } from '../mcp/mcp.service';
import type { CompanyData } from '../enrichment/interfaces/enrichment-provider.interface';

/** Data payload for lead processing job */
interface LeadProcessingJobData {
  leadId: number;
}

/** Result of lead processing job */
interface LeadProcessingResult {
  success: boolean;
  mcpExecutionId?: string;
  mcpStatus?: string;
}

@Processor('lead-processing')
export class LeadProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadProcessor.name);

  constructor(
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
    private readonly aiService: AiService,
    @Optional() private readonly mcpService?: MCPService,
    @InjectMetric(LEADS_PROCESSED_TOTAL)
    private readonly leadsCounter?: Counter<string>,
  ) {
    super();
  }

  async process(
    job: Job<LeadProcessingJobData, LeadProcessingResult, string>,
  ): Promise<LeadProcessingResult> {
    const { leadId } = job.data;
    const lead = await this.leadRepository.findOne({ where: { id: leadId } });

    if (!lead) {
      this.leadsCounter?.inc({ status: 'not_found' });
      throw new Error(`Lead with ID ${leadId} not found`);
    }

    this.logger.log(`Processing lead: ${lead.email}`);

    // 1. AI Analysis + Grounding
    const enrichment = await this.aiService.analyzeLead({
      email: lead.email,
      name: lead.name,
      campaignId: lead.campaignId,
    });

    lead.fitScore = enrichment.fitScore;
    lead.intent = enrichment.intent;
    lead.reasoning = enrichment.reasoning;
    lead.evidence = enrichment.evidence;
    lead.grounding_status = enrichment.grounding_status ?? null;
    lead.grounding_errors = enrichment.grounding_errors ?? null;
    lead.status = 'ENRICHED';

    await this.leadRepository.save(lead);

    // 2. MCP Integration (handles CRM sync, safety checks, rate limiting)
    if (this.mcpService) {
      // Extract enrichment data if available
      const enrichmentData = this.extractEnrichmentData(lead);

      const mcpResult = await this.mcpService.processAfterGrounding(
        lead,
        enrichment,
        enrichmentData,
      );

      if (mcpResult.status === 'REJECTED_BY_GROUNDING') {
        this.logger.warn(
          `Lead ${lead.email} rejected by grounding: ${mcpResult.violations?.join(', ')}`,
        );
        this.leadsCounter?.inc({ status: 'grounding_rejected' });
        return {
          success: false,
          mcpExecutionId: mcpResult.executionId,
          mcpStatus: 'REJECTED_BY_GROUNDING',
        };
      }

      if (mcpResult.status === 'RATE_LIMITED') {
        this.logger.warn(`Lead ${lead.email} rate limited, will retry`);
        this.leadsCounter?.inc({ status: 'rate_limited' });
        // Could throw to trigger retry in BullMQ
        return {
          success: false,
          mcpExecutionId: mcpResult.executionId,
          mcpStatus: 'RATE_LIMITED',
        };
      }

      if (mcpResult.status === 'BLOCKED') {
        this.logger.error(
          `Lead ${lead.email} blocked by safety guard: ${mcpResult.violations?.join(', ')}`,
        );
        this.leadsCounter?.inc({ status: 'blocked' });
        return {
          success: false,
          mcpExecutionId: mcpResult.executionId,
          mcpStatus: 'BLOCKED',
        };
      }

      this.logger.log(
        `Lead ${lead.email} processed via MCP (${mcpResult.results?.length ?? 0} actions)`,
      );
      this.leadsCounter?.inc({ status: 'success' });

      return {
        success: true,
        mcpExecutionId: mcpResult.executionId,
        mcpStatus: mcpResult.status,
      };
    }

    // Fallback: No MCP configured
    this.logger.log(`Lead ${lead.email} enriched (MCP not configured)`);
    this.leadsCounter?.inc({ status: 'success' });

    return { success: true };
  }

  /**
   * Extract CompanyData from lead enrichmentData if available
   */
  private extractEnrichmentData(lead: Lead): CompanyData | null {
    const data = lead.enrichmentData as Record<string, unknown> | null;
    if (!data) {
      return null;
    }

    return {
      name: (data.name as string) ?? undefined,
      domain: (data.domain as string) ?? undefined,
      industry: (data.industry as string) ?? undefined,
      employees: (data.employees as string) ?? undefined,
      geo: (data.geo as string) ?? undefined,
      techStack: (data.techStack as string[]) ?? undefined,
    };
  }
}
