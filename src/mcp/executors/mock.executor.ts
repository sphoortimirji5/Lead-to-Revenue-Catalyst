import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  MCPExecutor,
  CRMResult,
  CreateLeadParams,
  UpsertLeadParams,
  ConvertLeadParams,
  AssignOwnerParams,
  UpdateStatusParams,
  UpdateFieldsParams,
  SetScoreParams,
  MatchAccountParams,
  CreateContactParams,
  LinkContactParams,
  CreateOpportunityParams,
  UpdateStageParams,
  SetValueParams,
  AttachCampaignParams,
  CreateTaskParams,
  LogActivityParams,
  AddNoteParams,
  CreateFollowUpParams,
  SyncFirmographicsParams,
} from '../interfaces/mcp-executor.interface';
import { CrmSyncLog } from '../entities/crm-sync-log.entity';

/**
 * Mock MCP Executor
 * Simulates CRM operations by storing results in Postgres
 * Used for local development and testing
 */
@Injectable()
export class MockMCPExecutor implements MCPExecutor {
  private readonly logger = new Logger(MockMCPExecutor.name);

  constructor(
    @InjectRepository(CrmSyncLog)
    private readonly syncLogRepo: Repository<CrmSyncLog>,
  ) {}

  // ==================== LEAD LIFECYCLE ====================

  async createLead(params: CreateLeadParams): Promise<CRMResult> {
    return this.executeAction('create_lead', 'Lead', params, () => {
      const leadId = this.generateMockId('00Q');
      return {
        id: leadId,
        email: params.email,
        firstName: params.firstName,
        lastName: params.lastName,
        company: params.company,
        status: 'New',
        source: params.source,
        aiFitScore: params.aiFitScore,
        aiIntent: params.aiIntent,
        createdAt: new Date().toISOString(),
      };
    });
  }

  async upsertLead(params: UpsertLeadParams): Promise<CRMResult> {
    return this.executeAction('upsert_lead', 'Lead', params, () => {
      const leadId = params.externalId || this.generateMockId('00Q');
      const isUpdate = !!params.externalId;
      return {
        id: leadId,
        email: params.email,
        isUpdate,
        updatedAt: new Date().toISOString(),
      };
    });
  }

  async convertLead(params: ConvertLeadParams): Promise<CRMResult> {
    return this.executeAction('convert_lead', 'Lead', params, () => ({
      leadId: params.leadId,
      contactId: this.generateMockId('003'),
      accountId: params.accountId || this.generateMockId('001'),
      opportunityId: params.createOpportunity
        ? this.generateMockId('006')
        : null,
      convertedAt: new Date().toISOString(),
    }));
  }

  async assignOwner(params: AssignOwnerParams): Promise<CRMResult> {
    return this.executeAction(
      'assign_owner',
      params.recordType,
      params,
      () => ({
        recordId: params.recordId,
        ownerId: params.ownerId,
        assignedAt: new Date().toISOString(),
      }),
    );
  }

  async updateLeadStatus(params: UpdateStatusParams): Promise<CRMResult> {
    return this.executeAction(
      'update_status',
      params.recordType,
      params,
      () => ({
        recordId: params.recordId,
        status: params.status,
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  // ==================== FIELD UPDATES ====================

  async updateLeadFields(params: UpdateFieldsParams): Promise<CRMResult> {
    return this.executeAction(
      'update_fields',
      params.recordType,
      params,
      () => ({
        recordId: params.recordId,
        updatedFields: Object.keys(params.fields),
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  async setLeadScore(params: SetScoreParams): Promise<CRMResult> {
    return this.executeAction('set_lead_score', 'Lead', params, () => ({
      leadId: params.leadId,
      score: params.score,
      scoreType: params.scoreType || 'fit',
      updatedAt: new Date().toISOString(),
    }));
  }

  // ==================== ACCOUNT/CONTACT ====================

  async matchAccount(params: MatchAccountParams): Promise<CRMResult> {
    return this.executeAction('match_account', 'Account', params, () => {
      // Simulate account matching - always returns a mock account
      const found = !params.createIfNotFound || Math.random() > 0.3;
      return {
        accountId: this.generateMockId('001'),
        matched: found,
        matchedOn: params.domain ? 'domain' : 'companyName',
        created: !found && params.createIfNotFound,
      };
    });
  }

  async createContact(params: CreateContactParams): Promise<CRMResult> {
    return this.executeAction('create_contact', 'Contact', params, () => ({
      id: this.generateMockId('003'),
      email: params.email,
      firstName: params.firstName,
      lastName: params.lastName,
      accountId: params.accountId,
      createdAt: new Date().toISOString(),
    }));
  }

  async linkContactToAccount(params: LinkContactParams): Promise<CRMResult> {
    return this.executeAction('link_contact', 'Contact', params, () => ({
      contactId: params.contactId,
      accountId: params.accountId,
      linkedAt: new Date().toISOString(),
    }));
  }

  // ==================== SALES WORKFLOW ====================

  async createOpportunity(params: CreateOpportunityParams): Promise<CRMResult> {
    return this.executeAction(
      'create_opportunity',
      'Opportunity',
      params,
      () => ({
        id: this.generateMockId('006'),
        name: params.name,
        stage: params.stage || 'Prospecting',
        amount: params.amount,
        closeDate: params.closeDate,
        accountId: params.accountId,
        contactId: params.contactId,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  async updateOpportunityStage(params: UpdateStageParams): Promise<CRMResult> {
    return this.executeAction(
      'update_opp_stage',
      'Opportunity',
      params,
      () => ({
        opportunityId: params.oppId,
        stage: params.stage,
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  async setOpportunityValue(params: SetValueParams): Promise<CRMResult> {
    return this.executeAction('set_opp_value', 'Opportunity', params, () => ({
      opportunityId: params.oppId,
      amount: params.amount,
      currency: params.currency || 'USD',
      updatedAt: new Date().toISOString(),
    }));
  }

  async attachCampaign(params: AttachCampaignParams): Promise<CRMResult> {
    return this.executeAction(
      'attach_campaign',
      params.recordType,
      params,
      () => ({
        recordId: params.recordId,
        campaignId: params.campaignId,
        attachedAt: new Date().toISOString(),
      }),
    );
  }

  // ==================== ACTIVITY ====================

  async createTask(params: CreateTaskParams): Promise<CRMResult> {
    return this.executeAction('create_task', 'Task', params, () => ({
      id: this.generateMockId('00T'),
      subject: params.subject,
      priority: params.priority || 'Normal',
      dueDate: params.dueDate,
      relatedToId: params.relatedToId,
      createdAt: new Date().toISOString(),
    }));
  }

  async logActivity(params: LogActivityParams): Promise<CRMResult> {
    return this.executeAction('log_activity', 'Activity', params, () => ({
      id: this.generateMockId('00A'),
      type: params.type,
      relatedToId: params.relatedToId,
      description: params.description,
      loggedAt: new Date().toISOString(),
    }));
  }

  async addNote(params: AddNoteParams): Promise<CRMResult> {
    return this.executeAction('add_note', 'Note', params, () => ({
      id: this.generateMockId('00N'),
      recordId: params.recordId,
      title: params.title,
      createdAt: new Date().toISOString(),
    }));
  }

  async createFollowUp(params: CreateFollowUpParams): Promise<CRMResult> {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + params.delayDays);

    return this.executeAction('create_follow_up', 'Task', params, () => ({
      id: this.generateMockId('00T'),
      type: params.type,
      recordId: params.recordId,
      dueDate: dueDate.toISOString(),
      createdAt: new Date().toISOString(),
    }));
  }

  // ==================== ENRICHMENT ====================

  async syncFirmographics(params: SyncFirmographicsParams): Promise<CRMResult> {
    return this.executeAction('sync_firmographics', 'Account', params, () => ({
      leadId: params.leadId,
      contactId: params.contactId,
      accountId: params.accountId,
      firmographicsApplied: Object.keys(params.firmographics),
      syncedAt: new Date().toISOString(),
    }));
  }

  // ==================== HELPERS ====================

  private async executeAction<T>(
    action: string,
    entityType: string,
    params: object,
    operation: () => T,
  ): Promise<CRMResult<T>> {
    const startTime = Date.now();
    const executionId = uuidv4();

    try {
      // Simulate API latency
      await this.delay(100 + Math.random() * 200);

      const data = operation();

      // Log to database
      const paramsWithKey = params as { idempotencyKey?: string };
      await this.logSync({
        action,
        entityType,
        params: params,
        result: data as object,
        mcpExecutionId: executionId,
        idempotencyKey: paramsWithKey.idempotencyKey,
        durationMs: Date.now() - startTime,
      });

      this.logger.debug(`[MOCK] ${action} executed`, {
        entityType,
        executionId,
      });

      // Extract ID safely from data
      const dataWithId = data as { id?: string };
      return {
        success: true,
        data,
        crmRecordId: dataWithId.id,
        mock: true,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[MOCK] ${action} failed: ${errorMessage}`);

      await this.logSync({
        action,
        entityType,
        params: params as unknown as object,
        result: undefined,
        mcpExecutionId: executionId,
        errorMessage,
        durationMs: Date.now() - startTime,
      });

      return {
        success: false,
        error: errorMessage,
        mock: true,
      };
    }
  }

  private async logSync(data: Partial<CrmSyncLog>): Promise<void> {
    try {
      const log = this.syncLogRepo.create({
        ...data,
        mock: true,
      });
      await this.syncLogRepo.save(log);
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(`Failed to log sync: ${errMessage}`);
    }
  }

  private generateMockId(prefix: string): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = prefix;
    for (let i = 0; i < 12; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
