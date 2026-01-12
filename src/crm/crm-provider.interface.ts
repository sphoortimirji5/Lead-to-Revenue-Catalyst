import { Lead } from '../leads/lead.entity';

export interface CRMProvider {
    pushLead(lead: Lead): Promise<void>;
}
