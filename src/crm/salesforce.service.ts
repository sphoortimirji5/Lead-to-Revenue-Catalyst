import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { CRMProvider } from './crm-provider.interface';
import { Lead } from '../leads/lead.entity';

@Injectable()
export class SalesforceService implements CRMProvider {
    private readonly logger = new Logger(SalesforceService.name);

    async pushLead(lead: Lead): Promise<void> {
        this.logger.log(`Pushing lead to Salesforce: ${lead.email}`);
        throw new NotImplementedException('Salesforce integration not yet implemented');
    }
}
