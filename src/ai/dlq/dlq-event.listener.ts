import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import { ConfigService } from '@nestjs/config';

/** Data payload for lead processing */
interface LeadJobData {
  leadId: number;
}

/**
 * Listens for failed jobs and moves them to DLQ after all retries exhausted
 */
@Injectable()
export class DlqEventListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DlqEventListener.name);
  private queueEvents: QueueEvents | null = null;

  constructor(
    @InjectQueue('lead-processing')
    private readonly leadQueue: Queue,
    @InjectQueue('lead-processing-dlq')
    private readonly dlqQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn(
        'REDIS_URL not configured - DLQ event listener disabled',
      );
      return;
    }

    // Create QueueEvents to listen for failed jobs
    this.queueEvents = new QueueEvents('lead-processing', {
      connection: { url: redisUrl },
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      // Handle failed job asynchronously
      void this.handleFailedJob(jobId, failedReason);
    });

    this.logger.log('DLQ event listener initialized');
  }

  private async handleFailedJob(
    jobId: string,
    failedReason: string,
  ): Promise<void> {
    const job = await this.leadQueue.getJob(jobId);
    if (!job) return;

    const maxAttempts = job.opts.attempts ?? 5;
    if (job.attemptsMade >= maxAttempts) {
      this.logger.warn(
        `Job ${jobId} exhausted all ${maxAttempts} attempts. Moving to DLQ.`,
      );

      const jobData = job.data as LeadJobData;
      await this.dlqQueue.add('failed-lead', {
        originalJobId: jobId,
        leadId: jobData.leadId,
        failedAt: new Date().toISOString(),
        error: failedReason,
        attemptsMade: job.attemptsMade,
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queueEvents) {
      await this.queueEvents.close();
    }
  }
}
