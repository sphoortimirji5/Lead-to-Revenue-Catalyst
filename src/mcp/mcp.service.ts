import { Injectable, Logger, Optional } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import type { Lead } from '../leads/lead.entity';
import type { AiAnalysisResult } from '../ai/interfaces/ai-provider.interface';
import { GroundingStatus } from '../ai/interfaces/ai-provider.interface';
import type { CompanyData } from '../enrichment/interfaces/enrichment-provider.interface';
import { MCPRegistryService } from './registry/mcp-registry.service';
import { MCPSafetyGuard } from './guards/mcp-safety.guard';
import { MCPRateLimiter } from './guards/mcp-rate-limiter';
import { PIIRedactor } from './utils/pii-redactor';
import type {
  MCPContext,
  MCPProcessResult,
  ToolResult,
} from './interfaces/mcp-tool.interface';

/**
 * Main MCP Orchestration Service
 *
 * Responsible for processing AI-grounded leads through the MCP layer,
 * including safety checks, rate limiting, and CRM tool execution.
 */
@Injectable()
export class MCPService {
  private readonly logger = new Logger(MCPService.name);

  constructor(
    private readonly registry: MCPRegistryService,
    private readonly safetyGuard: MCPSafetyGuard,
    @Optional() private readonly rateLimiter: MCPRateLimiter | null,
    private readonly piiRedactor: PIIRedactor,
  ) {}

  /**
   * Process a lead after AI grounding
   *
   * This is the main entry point for MCP execution.
   * Flow:
   * 1. Validate grounding status (reject if grounding failed)
   * 2. Check rate limits
   * 3. Run safety guard checks
   * 4. Build action plan from AI result
   * 5. Execute actions through the registry
   */
  async processAfterGrounding(
    lead: Lead,
    aiResult: AiAnalysisResult,
    enrichmentData: CompanyData | null,
  ): Promise<MCPProcessResult> {
    const executionId = uuidv4();
    const timestamp = new Date();

    this.logger.log(`Starting MCP processing for lead ${lead.id}`, {
      executionId,
      grounding_status: aiResult.grounding_status,
    });

    // 1. Check grounding status - hard reject if grounding failed
    if (aiResult.grounding_status === GroundingStatus.REJECTED) {
      this.logger.warn(
        `MCP rejected for lead ${lead.id}: Grounding status REJECTED`,
        { executionId },
      );
      return {
        status: 'REJECTED_BY_GROUNDING',
        executionId,
        violations: aiResult.grounding_errors ?? [
          'Grounding validation failed',
        ],
        halt: true,
      };
    }

    // 2. Check rate limits
    if (this.rateLimiter) {
      const rateLimitResult = await this.rateLimiter.checkLimits(
        lead.id,
        lead.email?.split('@')[1],
      );

      if (!rateLimitResult.allowed) {
        this.logger.warn(`MCP rate limited for lead ${lead.id}`, {
          executionId,
          violations: rateLimitResult.violations,
        });
        return {
          status: 'RATE_LIMITED',
          executionId,
          violations: rateLimitResult.violations,
          halt: false,
          retryAfter: 60000, // 1 minute default
        };
      }
    }

    // 3. Build MCP context
    const context: MCPContext = {
      leadId: lead.id,
      leadData: this.buildLeadData(lead),
      aiResult,
      enrichmentData,
      executionId,
      timestamp,
    };

    // 4. Run safety guard checks
    const safetyResult = this.safetyGuard.validateContext(context);
    if (!safetyResult.passed) {
      this.logger.warn(`MCP safety check failed for lead ${lead.id}`, {
        executionId,
        reasons: safetyResult.reasons,
      });
      return {
        status: 'BLOCKED',
        executionId,
        violations: safetyResult.reasons,
        halt: true,
      };
    }

    // 5. Build action plan based on AI result
    const actionPlan = this.buildActionPlan(lead, aiResult, enrichmentData);

    if (actionPlan.length === 0) {
      this.logger.log(`No actions needed for lead ${lead.id}`, { executionId });
      return {
        status: 'COMPLETED',
        executionId,
        results: [],
      };
    }

    // 6. Execute actions
    const results: ToolResult[] = [];
    const errors: string[] = [];

    for (const action of actionPlan) {
      // Check if tool is safe to execute
      if (!this.safetyGuard.isActionAllowed(action.toolName)) {
        this.logger.error(`Blocked tool execution: ${action.toolName}`, {
          executionId,
        });
        errors.push(`Tool ${action.toolName} is blocked by safety guard`);
        continue;
      }

      // Validate action params
      const paramCheck = this.safetyGuard.validateActionParams(
        action.params as Record<string, unknown>,
      );
      if (!paramCheck.passed) {
        this.logger.warn(`Invalid params for ${action.toolName}`, {
          executionId,
          reasons: paramCheck.reasons,
        });
        errors.push(...paramCheck.reasons);
        continue;
      }

      // Execute
      const result = await this.registry.execute(
        action.toolName,
        action.params as Record<string, unknown>,
        context,
      );

      results.push({ tool: action.toolName, result });

      // Log execution (with PII redaction)
      this.logExecution(
        executionId,
        action.toolName,
        action.params,
        result.success,
      );

      // Stop on critical failure
      if (!result.success && action.critical) {
        this.logger.error(
          `Critical action ${action.toolName} failed, halting MCP`,
          { executionId, error: result.error },
        );
        errors.push(result.error ?? `${action.toolName} failed`);
        return {
          status: 'BLOCKED',
          executionId,
          results,
          errors,
          halt: true,
        };
      }

      if (!result.success) {
        errors.push(result.error ?? `${action.toolName} failed`);
      }
    }

    this.logger.log(`MCP processing complete for lead ${lead.id}`, {
      executionId,
      actionCount: results.length,
      successCount: results.filter((r) => r.result.success).length,
    });

    return {
      status: 'COMPLETED',
      executionId,
      results,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Build action plan from AI result
   */
  private buildActionPlan(
    lead: Lead,
    aiResult: AiAnalysisResult,
    enrichmentData: CompanyData | null,
  ): Array<{ toolName: string; params: object; critical: boolean }> {
    const actions: Array<{
      toolName: string;
      params: object;
      critical: boolean;
    }> = [];

    // Always create/upsert lead first (critical)
    if (aiResult.grounding_status !== GroundingStatus.REJECTED) {
      actions.push({
        toolName: 'upsert_lead',
        params: {
          email: lead.email,
          firstName: lead.name?.split(' ')[0],
          lastName: lead.name?.split(' ').slice(1).join(' '),
          company: enrichmentData?.name,
        },
        critical: true,
      });
    }

    // Set lead score if present
    if (aiResult.fitScore !== undefined) {
      actions.push({
        toolName: 'set_lead_score',
        params: {
          leadId: lead.id?.toString(),
          score: aiResult.fitScore,
          scoreType: 'fit',
        },
        critical: false,
      });
    }

    // Sync firmographics if enrichment data available
    if (enrichmentData) {
      actions.push({
        toolName: 'sync_firmographics',
        params: {
          leadId: lead.id?.toString(),
          firmographics: {
            industry: enrichmentData.industry,
            employees: enrichmentData.employees,
            geo: enrichmentData.geo,
            techStack: enrichmentData.techStack,
          },
        },
        critical: false,
      });
    }

    // Log AI activity
    actions.push({
      toolName: 'log_activity',
      params: {
        relatedToId: lead.id?.toString(),
        type: 'ai_analysis',
        description: `AI Analysis: Fit Score ${aiResult.fitScore}, Intent: ${aiResult.intent}`,
      },
      critical: false,
    });

    return actions;
  }

  /**
   * Build sanitized lead data for context
   */
  private buildLeadData(lead: Lead): Partial<Lead> {
    return {
      id: lead.id,
      email: lead.email,
      name: lead.name,
      campaignId: lead.campaignId,
      status: lead.status,
      fitScore: lead.fitScore,
      intent: lead.intent,
    };
  }

  /**
   * Log MCP execution with PII redaction
   */
  private logExecution(
    executionId: string,
    toolName: string,
    params: unknown,
    success: boolean,
  ): void {
    const redactedParams = this.piiRedactor.redact(
      params as Record<string, unknown>,
    );

    this.logger.debug(`MCP Action Executed`, {
      executionId,
      toolName,
      success,
      params: redactedParams,
    });
  }
}
