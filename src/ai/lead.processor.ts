import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inject, Logger } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { Lead } from '../leads/lead.entity';
import { AiService } from './ai.service';
import { LEADS_PROCESSED_TOTAL } from '../common/metrics.providers';
import type { CRMProvider } from '../crm/crm-provider.interface';

@Processor('lead-processing')
export class LeadProcessor extends WorkerHost {
    private readonly logger = new Logger(LeadProcessor.name);

    constructor(
        @InjectRepository(Lead)
        private readonly leadRepository: Repository<Lead>,
        private readonly aiService: AiService,
        @Inject('CRM_PROVIDER')
        private readonly crmProvider: CRMProvider,
        @InjectMetric(LEADS_PROCESSED_TOTAL)
        private readonly leadsCounter: Counter<string>,
    ) {
        super();
    }

    async process(job: Job<any, any, string>): Promise<any> {
        const { leadId } = job.data;
        const lead = await this.leadRepository.findOne({ where: { id: leadId } });

        if (!lead) {
            this.leadsCounter.inc({ status: 'not_found' });
            throw new Error(`Lead with ID ${leadId} not found`);
        }

        this.logger.log(`Processing lead: ${lead.email}`);

        // 1. AI Enrichment
        const enrichment = await this.aiService.analyzeLead({
            email: lead.email,
            name: lead.name,
            campaignId: lead.campaignId,
        });

        lead.fitScore = enrichment.fitScore;
        lead.intent = enrichment.intent;
        lead.reasoning = enrichment.reasoning;
        lead.evidence = enrichment.evidence;
        lead.grounding_status = enrichment.grounding_status || null;
        lead.grounding_errors = enrichment.grounding_errors || null;
        lead.status = 'ENRICHED';

        await this.leadRepository.save(lead);

        // 2. CRM Integration
        await this.crmProvider.pushLead(lead);

        this.logger.log(`Lead ${lead.email} enriched and synced to CRM`);

        this.leadsCounter.inc({ status: 'success' });
        return { success: true };
    }
}
