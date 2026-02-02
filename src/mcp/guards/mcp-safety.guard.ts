import { Injectable, Logger } from '@nestjs/common';
import { MCPContext } from '../interfaces';
import { GroundingStatus } from '../../ai/interfaces/ai-provider.interface';

export interface SafetyCheckResult {
  passed: boolean;
  reasons: string[];
}

interface BlockedPattern {
  pattern: RegExp;
  reason: string;
}

@Injectable()
export class MCPSafetyGuard {
  private readonly logger = new Logger(MCPSafetyGuard.name);

  /**
   * Patterns that are explicitly blocked from MCP execution
   */
  private readonly BLOCKED_PATTERNS: BlockedPattern[] = [
    { pattern: /^delete_/i, reason: 'Delete operations are prohibited' },
    {
      pattern: /^mass_/i,
      reason: 'Bulk operations require manual approval',
    },
    {
      pattern: /schema_change/i,
      reason: 'Schema modifications not allowed',
    },
    {
      pattern: /permission_change/i,
      reason: 'Permission changes not allowed',
    },
    {
      pattern: /execute.*query/i,
      reason: 'Arbitrary SOQL/SQL execution not allowed',
    },
    { pattern: /bulk_export/i, reason: 'Bulk data export requires approval' },
    {
      pattern: /^merge_/i,
      reason: 'Merge operations require manual review',
    },
    { pattern: /hard_delete/i, reason: 'Hard delete is prohibited' },
    // Security patterns
    { pattern: /\$\{.*\}/i, reason: 'Template injection attempt detected' },
    {
      pattern: /__proto__|constructor|prototype/i,
      reason: 'Prototype pollution attempt detected',
    },
  ];

  /**
   * Validate tool registration - ensures dangerous tools cannot be registered
   */
  validateToolRegistration(toolName: string): boolean {
    for (const blocked of this.BLOCKED_PATTERNS) {
      if (blocked.pattern.test(toolName)) {
        this.logger.error(
          `Attempted registration of blocked tool: ${toolName} - ${blocked.reason}`,
        );
        return false;
      }
    }
    return true;
  }

  /**
   * Validate context before MCP execution
   */
  validateContext(context: MCPContext): SafetyCheckResult {
    const reasons: string[] = [];

    // Check 1: Grounding status
    if (context.aiResult.grounding_status === GroundingStatus.REJECTED) {
      reasons.push(
        'AI result was rejected during grounding - no actions permitted',
      );
    }

    // Check 2: Required fields present
    if (!context.leadData.email) {
      reasons.push('Email is required for any CRM operation');
    }

    // Check 3: Execution ID present
    if (!context.executionId) {
      reasons.push('Execution ID is required for audit trail');
    }

    // Check 4: Lead ID present
    if (!context.leadId) {
      reasons.push('Lead ID is required');
    }

    // Check 5: Timestamp is reasonable (not in future, not too old)
    const now = Date.now();
    const contextTime = context.timestamp.getTime();
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneMinuteAhead = now + 60 * 1000;

    if (contextTime > oneMinuteAhead) {
      reasons.push('Context timestamp is in the future');
    }
    if (contextTime < oneHourAgo) {
      reasons.push('Context timestamp is too old (over 1 hour)');
    }

    if (reasons.length > 0) {
      this.logger.warn(
        `Safety check failed for lead ${context.leadId}: ${reasons.join(', ')}`,
      );
    }

    return {
      passed: reasons.length === 0,
      reasons,
    };
  }

  /**
   * Validate action parameters for injection attempts
   */
  validateActionParams(params: Record<string, unknown>): SafetyCheckResult {
    const reasons: string[] = [];

    const checkValue = (key: string, value: unknown, path: string): void => {
      if (typeof value === 'string') {
        for (const blocked of this.BLOCKED_PATTERNS) {
          if (blocked.pattern.test(value)) {
            reasons.push(`${blocked.reason} in ${path}`);
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
          checkValue(k, v, `${path}.${k}`);
        });
      }
    };

    Object.entries(params).forEach(([key, value]) => {
      checkValue(key, value, key);
    });

    return {
      passed: reasons.length === 0,
      reasons,
    };
  }

  /**
   * Check if a specific action is allowed
   */
  isActionAllowed(actionName: string): boolean {
    return this.validateToolRegistration(actionName);
  }
}
