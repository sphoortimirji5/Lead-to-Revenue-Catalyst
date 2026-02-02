import { Lead } from '../leads/lead.entity';

/**
 * Interface for CRM provider implementations.
 * Defines the contract for pushing leads to CRM systems.
 */
export interface CRMProvider {
  /** Push a lead to the CRM system */
  pushLead(lead: Lead): Promise<void>;
}
