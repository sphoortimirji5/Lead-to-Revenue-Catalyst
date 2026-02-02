// MCP Core Interfaces
import { z } from 'zod';
import { Lead } from '../../leads/lead.entity';
import { AiAnalysisResult } from '../../ai/interfaces/ai-provider.interface';

// ==================== TOOL INTERFACE ====================

export enum ToolCategory {
  LEAD_LIFECYCLE = 'lead_lifecycle',
  FIELD_UPDATES = 'field_updates',
  ACCOUNT_CONTACT = 'account_contact',
  SALES_WORKFLOW = 'sales_workflow',
  ACTIVITY = 'activity',
  ENRICHMENT_SYNC = 'enrichment_sync',
}

export interface MCPTool<TParams = any, TResult = any> {
  name: string;
  description: string;
  category: ToolCategory;
  paramsSchema: z.ZodSchema<TParams>;
  dangerous: boolean; // Always false for allowed tools

  execute(context: MCPContext, params: TParams): Promise<MCPResult<TResult>>;
}

// ==================== CONTEXT INTERFACE ====================

export interface MCPContext {
  leadId: number;
  leadData: Partial<Lead>;
  aiResult: AiAnalysisResult;
  enrichmentData: any;
  executionId: string;
  timestamp: Date;
}

// ==================== RESULT INTERFACE ====================

export interface MCPResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  crmRecordId?: string;
  warnings?: string[];
  retryAfter?: number; // ms before retry (for rate limiting)
}

export interface MCPProcessResult {
  status: 'COMPLETED' | 'BLOCKED' | 'RATE_LIMITED' | 'REJECTED_BY_GROUNDING';
  executionId: string;
  results?: ToolResult[];
  violations?: string[];
  errors?: string[];
  halt?: boolean;
  retryAfter?: number;
}

export interface ToolResult {
  tool: string;
  result: MCPResult;
}

export interface ActionPlan {
  toolName: string;
  params: any;
  critical: boolean;
  rollback?: (result: any) => Promise<void>;
}
