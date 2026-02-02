import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
import Redis from 'ioredis';

export interface RateLimitConfig {
  perLead: { limit: number; windowSeconds: number };
  perAccount: { limit: number; windowSeconds: number };
  global: { limit: number; windowSeconds: number };
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  window: string;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  violations: string[];
  details: Record<string, RateLimitResult>;
}

@Injectable()
export class MCPRateLimiter {
  private readonly logger = new Logger(MCPRateLimiter.name);

  private readonly DEFAULT_CONFIG: RateLimitConfig = {
    perLead: { limit: 10, windowSeconds: 60 }, // 10 actions/minute per lead
    perAccount: { limit: 100, windowSeconds: 60 }, // 100 actions/minute per account
    global: { limit: 1000, windowSeconds: 60 }, // 1000 actions/minute global
  };

  private config: RateLimitConfig;

  constructor(
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
    @Optional() config?: RateLimitConfig,
  ) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  async checkLimits(
    leadId: number,
    accountId?: string,
  ): Promise<RateLimitCheckResult> {
    if (!this.redis) {
      this.logger.warn('Redis not available, skipping rate limit check');
      return { allowed: true, violations: [], details: {} };
    }

    const violations: string[] = [];
    const details: Record<string, RateLimitResult> = {};

    try {
      // Check all tiers in parallel
      const [perLeadResult, globalResult, perAccountResult] = await Promise.all(
        [
          this.checkLimit(`mcp:lead:${leadId}`, this.config.perLead),
          this.checkLimit('mcp:global', this.config.global),
          accountId
            ? this.checkLimit(
                `mcp:account:${accountId}`,
                this.config.perAccount,
              )
            : Promise.resolve(null),
        ],
      );

      details.perLead = perLeadResult;
      details.global = globalResult;
      if (perAccountResult) details.perAccount = perAccountResult;

      if (!perLeadResult.allowed) {
        violations.push(
          `Per-lead rate limit exceeded (${perLeadResult.limit}/${perLeadResult.window})`,
        );
      }
      if (!globalResult.allowed) {
        violations.push(
          `Global rate limit exceeded (${globalResult.limit}/${globalResult.window})`,
        );
      }
      if (perAccountResult && !perAccountResult.allowed) {
        violations.push(
          `Per-account rate limit exceeded (${perAccountResult.limit}/${perAccountResult.window})`,
        );
      }

      return {
        allowed: violations.length === 0,
        violations,
        details,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Rate limit check failed: ${errorMessage}`);
      // Fail open - allow processing if Redis is down
      return { allowed: true, violations: [], details: {} };
    }
  }

  /**
   * Check CRM-specific rate limits
   * Reads limits from CRM_RATE_LIMIT_REQUESTS and CRM_RATE_LIMIT_WINDOW_SECONDS env vars
   */
  async checkCrmLimits(provider?: string): Promise<RateLimitResult> {
    if (!this.redis) {
      return {
        allowed: true,
        limit: 0,
        remaining: 0,
        resetAt: new Date(),
        window: 'N/A',
      };
    }

    const providerName = provider || process.env.CRM_PROVIDER || 'mock';
    const key = `mcp:crm:${providerName}:api_calls`;

    // Read limits from environment, with sensible defaults
    const limit = parseInt(process.env.CRM_RATE_LIMIT_REQUESTS || '1000', 10);
    const windowSeconds = parseInt(
      process.env.CRM_RATE_LIMIT_WINDOW_SECONDS || '60',
      10,
    );

    return this.checkLimit(key, { limit, windowSeconds });
  }

  private async checkLimit(
    key: string,
    config: { limit: number; windowSeconds: number },
  ): Promise<RateLimitResult> {
    if (!this.redis) {
      return {
        allowed: true,
        limit: config.limit,
        remaining: config.limit,
        resetAt: new Date(),
        window: `${config.windowSeconds}s`,
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const windowKey = `${key}:${Math.floor(now / config.windowSeconds)}`;

    const multi = this.redis.multi();
    multi.incr(windowKey);
    multi.expire(windowKey, config.windowSeconds);

    const results = await multi.exec();
    const current = (results?.[0]?.[1] as number) || 0;
    const resetAt = new Date(
      (Math.floor(now / config.windowSeconds) + 1) *
        config.windowSeconds *
        1000,
    );

    return {
      allowed: current <= config.limit,
      limit: config.limit,
      remaining: Math.max(0, config.limit - current),
      resetAt,
      window: `${config.windowSeconds}s`,
    };
  }

  /**
   * Get rate limit headers for HTTP responses
   */
  getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
    return {
      'X-RateLimit-Limit': result.limit.toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': Math.floor(
        result.resetAt.getTime() / 1000,
      ).toString(),
    };
  }
}
