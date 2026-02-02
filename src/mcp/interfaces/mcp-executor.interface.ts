// MCP Executor Interface - CRM-specific implementations

export interface CreateLeadParams {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  title?: string;
  source?: string;
  campaignId?: string;
  aiFitScore?: number;
  aiIntent?: string;
  aiAnalysisId?: string;
  idempotencyKey?: string;
  customFields?: Record<string, any>;
}

export interface UpsertLeadParams extends CreateLeadParams {
  externalId?: string;
}

export interface ConvertLeadParams {
  leadId: string;
  createOpportunity?: boolean;
  opportunityName?: string;
  accountId?: string;
}

export interface AssignOwnerParams {
  recordId: string;
  ownerId: string;
  recordType: 'Lead' | 'Contact' | 'Account' | 'Opportunity';
}

export interface UpdateStatusParams {
  recordId: string;
  status: string;
  recordType: 'Lead' | 'Opportunity';
}

export interface UpdateFieldsParams {
  recordId: string;
  recordType: 'Lead' | 'Contact' | 'Account' | 'Opportunity';
  fields: Record<string, any>;
}

export interface SetScoreParams {
  leadId: string;
  score: number;
  scoreType?: 'fit' | 'engagement' | 'intent';
}

export interface MatchAccountParams {
  domain?: string;
  companyName?: string;
  createIfNotFound?: boolean;
}

export interface CreateContactParams {
  email: string;
  firstName?: string;
  lastName?: string;
  accountId?: string;
  title?: string;
  source?: string;
}

export interface LinkContactParams {
  contactId: string;
  accountId: string;
}

export interface CreateOpportunityParams {
  name: string;
  accountId?: string;
  contactId?: string;
  stage?: string;
  amount?: number;
  closeDate?: string;
  source?: string;
  campaignId?: string;
  aiConfidence?: number;
  ownerId?: string;
}

export interface UpdateStageParams {
  oppId: string;
  stage: string;
}

export interface SetValueParams {
  oppId: string;
  amount: number;
  currency?: string;
}

export interface AttachCampaignParams {
  recordId: string;
  campaignId: string;
  recordType: 'Lead' | 'Contact' | 'Opportunity';
}

export interface CreateTaskParams {
  subject: string;
  relatedToId?: string;
  relatedToType?: 'Lead' | 'Contact' | 'Account' | 'Opportunity';
  whoId?: string;
  priority?: 'High' | 'Normal' | 'Low';
  dueDate?: string;
  description?: string;
}

export interface LogActivityParams {
  type: string;
  relatedToId?: string;
  relatedToType?: 'Lead' | 'Contact' | 'Account' | 'Opportunity';
  whoId?: string;
  description?: string;
}

export interface AddNoteParams {
  recordId: string;
  recordType: 'Lead' | 'Contact' | 'Account' | 'Opportunity';
  text: string;
  title?: string;
}

export interface CreateFollowUpParams {
  recordId: string;
  recordType: 'Lead' | 'Contact' | 'Opportunity';
  type: 'call' | 'email' | 'meeting' | 'task';
  delayDays: number;
  description?: string;
}

export interface SyncFirmographicsParams {
  leadId?: string;
  contactId?: string;
  accountId?: string;
  firmographics: Record<string, any>;
}

// ==================== CRM RESULT ====================

export interface CRMResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  crmRecordId?: string;
  warnings?: string[];
  retryAfter?: number;
  mock?: boolean;
}

// ==================== EXECUTOR INTERFACE ====================

export interface MCPExecutor {
  // Lead Lifecycle
  createLead(params: CreateLeadParams): Promise<CRMResult>;
  upsertLead(params: UpsertLeadParams): Promise<CRMResult>;
  convertLead(params: ConvertLeadParams): Promise<CRMResult>;
  assignOwner(params: AssignOwnerParams): Promise<CRMResult>;
  updateLeadStatus(params: UpdateStatusParams): Promise<CRMResult>;

  // Field Updates
  updateLeadFields(params: UpdateFieldsParams): Promise<CRMResult>;
  setLeadScore(params: SetScoreParams): Promise<CRMResult>;

  // Account/Contact
  matchAccount(params: MatchAccountParams): Promise<CRMResult>;
  createContact(params: CreateContactParams): Promise<CRMResult>;
  linkContactToAccount(params: LinkContactParams): Promise<CRMResult>;

  // Sales Workflow
  createOpportunity(params: CreateOpportunityParams): Promise<CRMResult>;
  updateOpportunityStage(params: UpdateStageParams): Promise<CRMResult>;
  setOpportunityValue(params: SetValueParams): Promise<CRMResult>;
  attachCampaign(params: AttachCampaignParams): Promise<CRMResult>;

  // Activity
  createTask(params: CreateTaskParams): Promise<CRMResult>;
  logActivity(params: LogActivityParams): Promise<CRMResult>;
  addNote(params: AddNoteParams): Promise<CRMResult>;
  createFollowUp(params: CreateFollowUpParams): Promise<CRMResult>;

  // Enrichment
  syncFirmographics(params: SyncFirmographicsParams): Promise<CRMResult>;
}

export const MCP_EXECUTOR = 'MCP_EXECUTOR';
