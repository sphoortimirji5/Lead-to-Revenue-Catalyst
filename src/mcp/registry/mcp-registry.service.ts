import { Injectable, Logger, Inject } from '@nestjs/common';
import { z } from 'zod';
import type {
  MCPExecutor,
  CRMResult,
} from '../interfaces/mcp-executor.interface';
import { MCP_EXECUTOR } from '../interfaces/mcp-executor.interface';
import type {
  MCPContext,
  MCPTool,
  MCPResult,
} from '../interfaces/mcp-tool.interface';
import { ToolCategory } from '../interfaces/mcp-tool.interface';

// ==================== PARAM SCHEMAS ====================

const CreateLeadSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  source: z.string().optional(),
  campaignId: z.string().optional(),
  aiFitScore: z.number().min(0).max(100).optional(),
  aiIntent: z.string().optional(),
});
type CreateLeadParams = z.infer<typeof CreateLeadSchema>;

const UpsertLeadSchema = z.object({
  email: z.string().email(),
  externalId: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
});
type UpsertLeadParams = z.infer<typeof UpsertLeadSchema>;

const ConvertLeadSchema = z.object({
  leadId: z.string(),
  createOpportunity: z.boolean().optional(),
  opportunityName: z.string().optional(),
  accountId: z.string().optional(),
});
type ConvertLeadParams = z.infer<typeof ConvertLeadSchema>;

const UpdateLeadStatusSchema = z.object({
  recordId: z.string(),
  status: z.string(),
  recordType: z.enum(['Lead', 'Opportunity']),
});
type UpdateLeadStatusParams = z.infer<typeof UpdateLeadStatusSchema>;

const SetLeadScoreSchema = z.object({
  leadId: z.string(),
  score: z.number().min(0).max(100),
  scoreType: z.enum(['fit', 'engagement', 'intent']).optional(),
});
type SetLeadScoreParams = z.infer<typeof SetLeadScoreSchema>;

const MatchAccountSchema = z.object({
  domain: z.string().optional(),
  companyName: z.string().optional(),
  createIfNotFound: z.boolean().optional(),
});
type MatchAccountParams = z.infer<typeof MatchAccountSchema>;

const CreateContactSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  accountId: z.string().optional(),
  title: z.string().optional(),
});
type CreateContactParams = z.infer<typeof CreateContactSchema>;

const CreateOpportunitySchema = z.object({
  name: z.string(),
  accountId: z.string().optional(),
  contactId: z.string().optional(),
  stage: z.string().optional(),
  amount: z.number().optional(),
  closeDate: z.string().optional(),
});
type CreateOpportunityParams = z.infer<typeof CreateOpportunitySchema>;

const UpdateOpportunityStageSchema = z.object({
  oppId: z.string(),
  stage: z.string(),
});
type UpdateOpportunityStageParams = z.infer<
  typeof UpdateOpportunityStageSchema
>;

const CreateTaskSchema = z.object({
  subject: z.string(),
  relatedToId: z.string().optional(),
  relatedToType: z
    .enum(['Lead', 'Contact', 'Account', 'Opportunity'])
    .optional(),
  priority: z.enum(['High', 'Normal', 'Low']).optional(),
  dueDate: z.string().optional(),
  description: z.string().optional(),
});
type CreateTaskParams = z.infer<typeof CreateTaskSchema>;

const LogActivitySchema = z.object({
  type: z.string(),
  relatedToId: z.string().optional(),
  relatedToType: z
    .enum(['Lead', 'Contact', 'Account', 'Opportunity'])
    .optional(),
  description: z.string().optional(),
});
type LogActivityParams = z.infer<typeof LogActivitySchema>;

const SyncFirmographicsSchema = z.object({
  leadId: z.string().optional(),
  contactId: z.string().optional(),
  accountId: z.string().optional(),
  firmographics: z.record(z.string(), z.unknown()),
});
type SyncFirmographicsParams = z.infer<typeof SyncFirmographicsSchema>;

/**
 * MCP Tool Registry Service
 * Manages tool registration, discovery, and execution
 */
@Injectable()
export class MCPRegistryService {
  private readonly logger = new Logger(MCPRegistryService.name);
  private readonly tools = new Map<string, MCPTool>();

  constructor(
    @Inject(MCP_EXECUTOR)
    private readonly executor: MCPExecutor,
  ) {
    this.registerDefaultTools();
  }

  /**
   * Register a tool
   */
  register(tool: MCPTool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool ${tool.name} already registered, overwriting`);
    }
    this.tools.set(tool.name, tool);
    this.logger.log(`Registered tool: ${tool.name}`);
  }

  /**
   * Get a tool by name
   */
  getTool(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAllTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool names by category
   */
  getToolsByCategory(category: ToolCategory): MCPTool[] {
    return this.getAllTools().filter((t) => t.category === category);
  }

  /**
   * Execute a tool by name
   */
  async execute(
    toolName: string,
    params: Record<string, unknown>,
    context: MCPContext,
  ): Promise<MCPResult> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${toolName}`,
      };
    }

    // Validate params against schema
    try {
      tool.paramsSchema.parse(params);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Invalid params for ${toolName}: ${errorMessage}`,
      };
    }

    this.logger.debug(`Executing tool: ${toolName}`, { params });
    return tool.execute(context, params);
  }

  /**
   * Register default tools
   */
  private registerDefaultTools(): void {
    // Lead Lifecycle Tools
    this.register({
      name: 'create_lead',
      description: 'Create a new lead in the CRM',
      category: ToolCategory.LEAD_LIFECYCLE,
      dangerous: false,
      paramsSchema: CreateLeadSchema,
      execute: async (ctx, params) => {
        const p = params as CreateLeadParams;
        const result = await this.executor.createLead({
          email: p.email,
          firstName: p.firstName,
          lastName: p.lastName,
          company: p.company,
          title: p.title,
          source: p.source,
          campaignId: p.campaignId,
          aiFitScore: p.aiFitScore,
          aiIntent: p.aiIntent,
          aiAnalysisId: ctx.executionId,
          idempotencyKey: ctx.executionId,
        });
        return this.mapCrmResult(result);
      },
    });

    this.register({
      name: 'upsert_lead',
      description: 'Create or update a lead based on email/external ID',
      category: ToolCategory.LEAD_LIFECYCLE,
      dangerous: false,
      paramsSchema: UpsertLeadSchema,
      execute: async (ctx, params) => {
        const p = params as UpsertLeadParams;
        const result = await this.executor.upsertLead({
          email: p.email,
          externalId: p.externalId,
          firstName: p.firstName,
          lastName: p.lastName,
          company: p.company,
          idempotencyKey: ctx.executionId,
        });
        return this.mapCrmResult(result);
      },
    });

    this.register({
      name: 'convert_lead',
      description: 'Convert a lead to contact/account/opportunity',
      category: ToolCategory.LEAD_LIFECYCLE,
      dangerous: false,
      paramsSchema: ConvertLeadSchema,
      execute: async (_ctx, params) => {
        const p = params as ConvertLeadParams;
        const result = await this.executor.convertLead({
          leadId: p.leadId,
          createOpportunity: p.createOpportunity,
          opportunityName: p.opportunityName,
          accountId: p.accountId,
        });
        return this.mapCrmResult(result);
      },
    });

    this.register({
      name: 'update_lead_status',
      description: 'Update the status of a lead or opportunity',
      category: ToolCategory.LEAD_LIFECYCLE,
      dangerous: false,
      paramsSchema: UpdateLeadStatusSchema,
      execute: async (_ctx, params) => {
        const p = params as UpdateLeadStatusParams;
        const result = await this.executor.updateLeadStatus({
          recordId: p.recordId,
          status: p.status,
          recordType: p.recordType,
        });
        return this.mapCrmResult(result);
      },
    });

    // Score Tool
    this.register({
      name: 'set_lead_score',
      description: 'Set the AI-generated score for a lead',
      category: ToolCategory.FIELD_UPDATES,
      dangerous: false,
      paramsSchema: SetLeadScoreSchema,
      execute: async (_ctx, params) => {
        const p = params as SetLeadScoreParams;
        const result = await this.executor.setLeadScore({
          leadId: p.leadId,
          score: p.score,
          scoreType: p.scoreType,
        });
        return this.mapCrmResult(result);
      },
    });

    // Account/Contact Tools
    this.register({
      name: 'match_account',
      description: 'Find or create an account by domain or company name',
      category: ToolCategory.ACCOUNT_CONTACT,
      dangerous: false,
      paramsSchema: MatchAccountSchema,
      execute: async (_ctx, params) => {
        const p = params as MatchAccountParams;
        const result = await this.executor.matchAccount({
          domain: p.domain,
          companyName: p.companyName,
          createIfNotFound: p.createIfNotFound,
        });
        return this.mapCrmResult(result);
      },
    });

    this.register({
      name: 'create_contact',
      description: 'Create a new contact in the CRM',
      category: ToolCategory.ACCOUNT_CONTACT,
      dangerous: false,
      paramsSchema: CreateContactSchema,
      execute: async (_ctx, params) => {
        const p = params as CreateContactParams;
        const result = await this.executor.createContact({
          email: p.email,
          firstName: p.firstName,
          lastName: p.lastName,
          accountId: p.accountId,
          title: p.title,
        });
        return this.mapCrmResult(result);
      },
    });

    // Sales Workflow Tools
    this.register({
      name: 'create_opportunity',
      description: 'Create a new sales opportunity',
      category: ToolCategory.SALES_WORKFLOW,
      dangerous: false,
      paramsSchema: CreateOpportunitySchema,
      execute: async (_ctx, params) => {
        const p = params as CreateOpportunityParams;
        const result = await this.executor.createOpportunity({
          name: p.name,
          accountId: p.accountId,
          contactId: p.contactId,
          stage: p.stage,
          amount: p.amount,
          closeDate: p.closeDate,
        });
        return this.mapCrmResult(result);
      },
    });

    this.register({
      name: 'update_opportunity_stage',
      description: 'Update the stage of an opportunity',
      category: ToolCategory.SALES_WORKFLOW,
      dangerous: false,
      paramsSchema: UpdateOpportunityStageSchema,
      execute: async (_ctx, params) => {
        const p = params as UpdateOpportunityStageParams;
        const result = await this.executor.updateOpportunityStage({
          oppId: p.oppId,
          stage: p.stage,
        });
        return this.mapCrmResult(result);
      },
    });

    // Activity Tools
    this.register({
      name: 'create_task',
      description: 'Create a follow-up task',
      category: ToolCategory.ACTIVITY,
      dangerous: false,
      paramsSchema: CreateTaskSchema,
      execute: async (_ctx, params) => {
        const p = params as CreateTaskParams;
        const result = await this.executor.createTask({
          subject: p.subject,
          relatedToId: p.relatedToId,
          relatedToType: p.relatedToType,
          priority: p.priority,
          dueDate: p.dueDate,
          description: p.description,
        });
        return this.mapCrmResult(result);
      },
    });

    this.register({
      name: 'log_activity',
      description: 'Log an activity (call, email, meeting)',
      category: ToolCategory.ACTIVITY,
      dangerous: false,
      paramsSchema: LogActivitySchema,
      execute: async (_ctx, params) => {
        const p = params as LogActivityParams;
        const result = await this.executor.logActivity({
          type: p.type,
          relatedToId: p.relatedToId,
          relatedToType: p.relatedToType,
          description: p.description,
        });
        return this.mapCrmResult(result);
      },
    });

    // Enrichment Tools
    this.register({
      name: 'sync_firmographics',
      description: 'Sync firmographic data to CRM records',
      category: ToolCategory.ENRICHMENT_SYNC,
      dangerous: false,
      paramsSchema: SyncFirmographicsSchema,
      execute: async (_ctx, params) => {
        const p = params as SyncFirmographicsParams;
        const result = await this.executor.syncFirmographics({
          leadId: p.leadId,
          contactId: p.contactId,
          accountId: p.accountId,
          firmographics: p.firmographics,
        });
        return this.mapCrmResult(result);
      },
    });

    this.logger.log(`Registered ${this.tools.size} default tools`);
  }

  /**
   * Map CRMResult to MCPResult
   */
  private mapCrmResult(result: CRMResult): MCPResult {
    return {
      success: result.success,
      data: result.data as unknown,
      error: result.error,
      crmRecordId: result.crmRecordId,
      warnings: result.warnings,
      retryAfter: result.retryAfter,
    };
  }
}
