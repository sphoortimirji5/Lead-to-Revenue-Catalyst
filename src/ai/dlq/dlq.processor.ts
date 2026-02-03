import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger } from '@nestjs/common';
import { Lead } from '../../leads/lead.entity';

/** Data payload for DLQ job */
interface DlqJobData {
  originalJobId: string;
  leadId: number;
  failedAt: string;
  error: string;
  attemptsMade: number;
}

/**
 * Dead Letter Queue Processor
 *
 * Handles permanently failed lead processing jobs after all retries exhausted.
 * Jobs in DLQ are logged and marked for manual review.
 */
@Processor('lead-processing-dlq')
export class DlqProcessor extends WorkerHost {
  private readonly logger = new Logger(DlqProcessor.name);

  constructor(
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
  ) {
    super();
  }

  async process(job: Job<DlqJobData>): Promise<void> {
    const { leadId, originalJobId, error, attemptsMade, failedAt } = job.data;

    this.logger.warn(
      `DLQ: Processing failed job ${originalJobId} for lead ${leadId}. ` +
        `Attempts: ${attemptsMade}, Error: ${error}`,
    );

    // Mark lead as permanently failed
    const lead = await this.leadRepository.findOne({ where: { id: leadId } });
    if (lead) {
      lead.status = 'PERMANENTLY_FAILED';
      await this.leadRepository.save(lead);

      this.logger.error(
        `Lead ${lead.email} marked as PERMANENTLY_FAILED after ${attemptsMade} attempts. ` +
          `Original failure at ${failedAt}: ${error}`,
      );
    }

    // TODO: Add alerting (e.g., PagerDuty, Slack webhook)
    // TODO: Store in separate failed_jobs table for dashboard/retry UI
  }
}
