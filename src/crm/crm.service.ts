import { Injectable, Logger } from '@nestjs/common';
import { CRMProvider } from './crm-provider.interface';
import { Lead } from '../leads/lead.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class MockCrmService implements CRMProvider {
  private readonly logger = new Logger(MockCrmService.name);

  constructor(
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
  ) {}

  async pushLead(lead: Lead): Promise<void> {
    this.logger.log(`Pushing lead to Mock CRM: ${lead.email}`);
    
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500));

    // In a real mock, we might update a separate "CRM" table, 
    // but for this demo, we'll just mark it as synced.
    lead.status = 'SYNCED_TO_CRM';
    await this.leadRepository.save(lead);
    
    this.logger.log(`Lead ${lead.email} successfully synced to Mock CRM`);
  }
}
