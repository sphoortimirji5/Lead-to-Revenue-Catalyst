import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';

export interface IdempotencyConfig {
  ttlHours: number;
  namespace: string;
}

export interface IdempotencyCheckResult {
  processed: boolean;
  result?: any;
  timestamp?: number;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly DEFAULT_TTL_HOURS = 48;
  private readonly DEFAULT_NAMESPACE = 'mcp:idempotency';

  constructor(
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
    @Optional() private config?: IdempotencyConfig,
  ) {
    this.config = {
      ttlHours: config?.ttlHours || this.DEFAULT_TTL_HOURS,
      namespace: config?.namespace || this.DEFAULT_NAMESPACE,
    };
  }

  /**
   * Generate deterministic idempotency key
   * Includes time bucket to prevent indefinite replays but allow retries
   */
  generateKey(
    email: string,
    campaignId: string | undefined,
    action: string,
    windowMinutes = 60,
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
   * Generate a stable key without time bucketing (for upserts)
   */
  generateStableKey(
    email: string,
    campaignId: string | undefined,
    action: string,
  ): string {
    const data = [
      email.toLowerCase().trim(),
      campaignId?.toLowerCase().trim() || 'none',
      action.toLowerCase(),
    ].join('::');

    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Check if action was already processed
   */
  async isProcessed(key: string): Promise<IdempotencyCheckResult> {
    if (!this.redis) {
      // In-memory fallback for testing/local dev without Redis
      this.logger.warn('Redis not available, skipping idempotency check');
      return { processed: false };
    }

    try {
      const stored = await this.redis.get(`${this.config!.namespace}:${key}`);

      if (stored) {
        const parsed = JSON.parse(stored) as {
          result: unknown;
          timestamp: number;
        };
        this.logger.debug(`Idempotency hit for key ${key.substring(0, 8)}...`);
        return {
          processed: true,
          result: parsed.result,
          timestamp: parsed.timestamp,
        };
      }

      return { processed: false };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Idempotency check failed: ${errorMessage}`);
      // Fail open - allow processing if Redis is down
      return { processed: false };
    }
  }

  /**
   * Store result for idempotency with TTL
   */
  async storeResult(key: string, result: unknown): Promise<void> {
    if (!this.redis) {
      this.logger.warn('Redis not available, skipping idempotency storage');
      return;
    }

    const ttlSeconds = (this.config!.ttlHours || this.DEFAULT_TTL_HOURS) * 3600;

    try {
      await this.redis.setex(
        `${this.config!.namespace}:${key}`,
        ttlSeconds,
        JSON.stringify({
          result,
          timestamp: Date.now(),
        }),
      );
      this.logger.debug(
        `Stored idempotency result for key ${key.substring(0, 8)}...`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Idempotency storage failed: ${errorMessage}`);
      // Non-fatal - continue processing
    }
  }

  /**
   * Clear idempotency record (for testing/rollback)
   */
  async clear(key: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.del(`${this.config!.namespace}:${key}`);
      this.logger.debug(`Cleared idempotency key ${key.substring(0, 8)}...`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to clear idempotency key: ${errorMessage}`);
    }
  }

  /**
   * Clear all idempotency records (for testing)
   */
  async clearAll(): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      const pattern = `${this.config!.namespace}:*`;
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`Cleared ${keys.length} idempotency keys`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to clear all idempotency keys: ${errorMessage}`,
      );
    }
  }
}
