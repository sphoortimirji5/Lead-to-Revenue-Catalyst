import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inject } from '@nestjs/common';
import { Lead } from '../leads/lead.entity';
import { AiService } from './ai.service';
import type { CRMProvider } from '../crm/crm-provider.interface';

@Processor('lead-processing')
export class LeadProcessor extends WorkerHost {
    constructor(
        @InjectRepository(Lead)
        private readonly leadRepository: Repository<Lead>,
        private readonly aiService: AiService,
        @Inject('CRM_PROVIDER')
        private readonly crmProvider: CRMProvider,
    ) {
        super();
    }

    async process(job: Job<any, any, string>): Promise<any> {
        const { leadId } = job.data;
        const lead = await this.leadRepository.findOne({ where: { id: leadId } });

        if (!lead) {
            throw new Error(`Lead with ID ${leadId} not found`);
        }

        console.log(`Processing lead: ${lead.email}`);

        // 1. AI Enrichment
        const enrichment = await this.aiService.analyzeLead({
            email: lead.email,
            name: lead.name,
            campaignId: lead.campaignId,
        });

        lead.fitScore = enrichment.fitScore;
        lead.intent = enrichment.intent;
        lead.status = 'ENRICHED';

        await this.leadRepository.save(lead);

        // 2. CRM Integration
        await this.crmProvider.pushLead(lead);

        console.log(`Lead ${lead.email} enriched and synced to CRM`);

        return { success: true };
    }
}
