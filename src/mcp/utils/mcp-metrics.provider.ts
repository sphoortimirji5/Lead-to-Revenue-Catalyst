import { Injectable, Logger, Inject } from '@nestjs/common';
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import type { Counter, Gauge, Histogram } from 'prom-client';

/**
 * MCP Metrics - Prometheus metrics for monitoring MCP layer health
 */

// ============================================================================
// Counter Metrics
// ============================================================================

/** Total MCP actions executed by tool and status */
export const MCP_ACTIONS_TOTAL = 'mcp_actions_total';
export const mcpActionsTotal = makeCounterProvider({
  name: MCP_ACTIONS_TOTAL,
  help: 'Total number of MCP actions executed',
  labelNames: ['tool', 'status', 'crm_provider'],
});

/** Total grounding decisions by status */
export const MCP_GROUNDING_DECISIONS_TOTAL = 'mcp_grounding_decisions_total';
export const mcpGroundingDecisionsTotal = makeCounterProvider({
  name: MCP_GROUNDING_DECISIONS_TOTAL,
  help: 'Total grounding decisions by status',
  labelNames: ['status'], // VALID, DOWNGRADED, REJECTED
});

/** Rate limit violations counter */
export const MCP_RATE_LIMIT_VIOLATIONS_TOTAL =
  'mcp_rate_limit_violations_total';
export const mcpRateLimitViolationsTotal = makeCounterProvider({
  name: MCP_RATE_LIMIT_VIOLATIONS_TOTAL,
  help: 'Total rate limit violations',
  labelNames: ['limit_type'], // per_lead, per_account, global
});

/** Safety guard blocks counter */
export const MCP_SAFETY_BLOCKS_TOTAL = 'mcp_safety_blocks_total';
export const mcpSafetyBlocksTotal = makeCounterProvider({
  name: MCP_SAFETY_BLOCKS_TOTAL,
  help: 'Total actions blocked by safety guard',
  labelNames: ['tool', 'reason'],
});

// ============================================================================
// Gauge Metrics
// ============================================================================

/** Current circuit breaker state */
export const MCP_CIRCUIT_BREAKER_STATE = 'mcp_circuit_breaker_state';
export const mcpCircuitBreakerState = makeGaugeProvider({
  name: MCP_CIRCUIT_BREAKER_STATE,
  help: 'Current circuit breaker state (0=closed, 1=half-open, 2=open)',
  labelNames: ['crm_provider', 'operation'],
});

/** Circuit breaker failure count in current window */
export const MCP_CIRCUIT_BREAKER_FAILURES = 'mcp_circuit_breaker_failures';
export const mcpCircuitBreakerFailures = makeGaugeProvider({
  name: MCP_CIRCUIT_BREAKER_FAILURES,
  help: 'Current failure count in circuit breaker window',
  labelNames: ['crm_provider'],
});

// ============================================================================
// Histogram Metrics
// ============================================================================

/** MCP action execution duration */
export const MCP_ACTION_DURATION_SECONDS = 'mcp_action_duration_seconds';
export const mcpActionDurationSeconds = makeHistogramProvider({
  name: MCP_ACTION_DURATION_SECONDS,
  help: 'MCP action execution duration in seconds',
  labelNames: ['tool', 'crm_provider'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/** CRM API call duration */
export const MCP_CRM_API_DURATION_SECONDS = 'mcp_crm_api_duration_seconds';
export const mcpCrmApiDurationSeconds = makeHistogramProvider({
  name: MCP_CRM_API_DURATION_SECONDS,
  help: 'CRM API call duration in seconds',
  labelNames: ['crm_provider', 'operation', 'status'],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

// ============================================================================
// Metrics Service
// ============================================================================

@Injectable()
export class MCPMetricsService {
  private readonly logger = new Logger(MCPMetricsService.name);

  constructor(
    @Inject(MCP_ACTIONS_TOTAL)
    private readonly actionsCounter: Counter<string>,
    @Inject(MCP_GROUNDING_DECISIONS_TOTAL)
    private readonly groundingDecisionsCounter: Counter<string>,
    @Inject(MCP_RATE_LIMIT_VIOLATIONS_TOTAL)
    private readonly rateLimitViolationsCounter: Counter<string>,
    @Inject(MCP_SAFETY_BLOCKS_TOTAL)
    private readonly safetyBlocksCounter: Counter<string>,
    @Inject(MCP_CIRCUIT_BREAKER_STATE)
    private readonly circuitBreakerStateGauge: Gauge<string>,
    @Inject(MCP_CIRCUIT_BREAKER_FAILURES)
    private readonly circuitBreakerFailuresGauge: Gauge<string>,
    @Inject(MCP_ACTION_DURATION_SECONDS)
    private readonly actionDurationHistogram: Histogram<string>,
    @Inject(MCP_CRM_API_DURATION_SECONDS)
    private readonly crmApiDurationHistogram: Histogram<string>,
  ) {}

  /**
   * Record an MCP action execution
   */
  recordAction(
    tool: string,
    status: 'success' | 'failure' | 'blocked',
    crmProvider: string,
    durationMs: number,
  ): void {
    this.actionsCounter.inc({ tool, status, crm_provider: crmProvider });
    this.actionDurationHistogram.observe(
      { tool, crm_provider: crmProvider },
      durationMs / 1000,
    );
    this.logger.debug(`MCP Action: ${tool} (${status}) in ${durationMs}ms`);
  }

  /**
   * Record a grounding decision
   */
  recordGroundingDecision(status: 'VALID' | 'DOWNGRADED' | 'REJECTED'): void {
    this.groundingDecisionsCounter.inc({ status });
    this.logger.debug(`Grounding decision: ${status}`);
  }

  /**
   * Record a rate limit violation
   */
  recordRateLimitViolation(
    limitType: 'per_lead' | 'per_account' | 'global',
  ): void {
    this.rateLimitViolationsCounter.inc({ limit_type: limitType });
    this.logger.debug(`Rate limit violation: ${limitType}`);
  }

  /**
   * Record a safety guard block
   */
  recordSafetyBlock(tool: string, reason: string): void {
    this.safetyBlocksCounter.inc({ tool, reason });
    this.logger.debug(`Safety block: ${tool} - ${reason}`);
  }

  /**
   * Record a circuit breaker state change
   */
  recordCircuitBreakerStateChange(
    crmProvider: string,
    operation: string,
    state: 'closed' | 'half-open' | 'open',
  ): void {
    const stateValue = state === 'closed' ? 0 : state === 'half-open' ? 1 : 2;
    this.circuitBreakerStateGauge.set(
      { crm_provider: crmProvider, operation },
      stateValue,
    );
    this.logger.log(`Circuit breaker ${crmProvider}/${operation}: ${state}`);
  }

  /**
   * Record CRM API call duration
   */
  recordCrmApiCall(
    crmProvider: string,
    operation: string,
    status: 'success' | 'failure',
    durationMs: number,
  ): void {
    this.crmApiDurationHistogram.observe(
      { crm_provider: crmProvider, operation, status },
      durationMs / 1000,
    );
  }
}

// ============================================================================
// Provider Array for Module Import
// ============================================================================

export const mcpMetricsProviders = [
  mcpActionsTotal,
  mcpGroundingDecisionsTotal,
  mcpRateLimitViolationsTotal,
  mcpSafetyBlocksTotal,
  mcpCircuitBreakerState,
  mcpCircuitBreakerFailures,
  mcpActionDurationSeconds,
  mcpCrmApiDurationSeconds,
  MCPMetricsService,
];
