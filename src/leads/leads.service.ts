import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Lead } from './lead.entity';
import { CreateLeadDto } from './dto/create-lead.dto';
import * as crypto from 'crypto';

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
    @InjectQueue('lead-processing')
    private readonly leadQueue: Queue,
  ) {}

  async create(createLeadDto: CreateLeadDto): Promise<Lead> {
    const idempotencyKey = crypto
      .createHash('sha256')
      .update(`${createLeadDto.email}:${createLeadDto.campaign_id}`)
      .digest('hex');

    const existingLead = await this.leadRepository.findOne({
      where: { idempotencyKey },
    });

    if (existingLead) {
      return existingLead;
    }

    const lead = this.leadRepository.create({
      ...createLeadDto,
      campaignId: createLeadDto.campaign_id,
      idempotencyKey,
    });

    const savedLead = await this.leadRepository.save(lead);

    await this.leadQueue.add(
      'process-lead',
      { leadId: savedLead.id },
      {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    );

    return savedLead;
  }
}
