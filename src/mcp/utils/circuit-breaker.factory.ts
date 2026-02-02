import { Injectable, Logger } from '@nestjs/common';
import CircuitBreaker from 'opossum';

export interface CircuitBreakerConfig {
  timeout: number;
  errorThreshold: number;
  resetTimeout: number;
  volumeThreshold: number;
}

export interface CircuitHealth {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  stats: {
    failures: number;
    successes: number;
    rejects: number;
    fires: number;
  };
}

@Injectable()
export class CircuitBreakerFactory {
  private readonly logger = new Logger(CircuitBreakerFactory.name);
  private breakers: Map<string, CircuitBreaker> = new Map();

  private readonly DEFAULT_CONFIG: CircuitBreakerConfig = {
    timeout: 10000, // 10 seconds
    errorThreshold: 50, // 50% failure rate
    resetTimeout: 30000, // 30 seconds before retry
    volumeThreshold: 10, // Min requests before calculating failure %
  };

  createBreaker(
    name: string,
    asyncFunction: (...args: any[]) => Promise<any>,
    config?: Partial<CircuitBreakerConfig>,
  ): CircuitBreaker {
    if (this.breakers.has(name)) {
      return this.breakers.get(name)!;
    }

    const mergedConfig = { ...this.DEFAULT_CONFIG, ...config };

    const options: CircuitBreaker.Options = {
      timeout: mergedConfig.timeout,
      errorThresholdPercentage: mergedConfig.errorThreshold,
      resetTimeout: mergedConfig.resetTimeout,
      volumeThreshold: mergedConfig.volumeThreshold,

      // Custom error filter - don't count 4xx errors as failures
      errorFilter: (error: unknown) => {
        const err = error as {
          statusCode?: number;
          response?: { status?: number };
        };
        const statusCode = err?.statusCode || err?.response?.status;
        // Return true to NOT count as failure (client errors)
        return (
          statusCode !== undefined && statusCode >= 400 && statusCode < 500
        );
      },
    };

    const breaker = new CircuitBreaker(asyncFunction, options);

    // Event logging for monitoring
    breaker.on('open', () => {
      this.logger.error(`[OPEN] Circuit breaker OPEN for ${name}`);
    });

    breaker.on('halfOpen', () => {
      this.logger.warn(`[HALF-OPEN] Circuit breaker HALF-OPEN for ${name}`);
    });

    breaker.on('close', () => {
      this.logger.log(`[CLOSED] Circuit breaker CLOSED for ${name}`);
    });

    breaker.on('fallback', () => {
      this.logger.warn(`Circuit breaker fallback triggered for ${name}`);
    });

    breaker.on('timeout', () => {
      this.logger.warn(`Circuit breaker timeout for ${name}`);
    });

    this.breakers.set(name, breaker);
    return breaker;
  }

  getBreaker(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  /**
   * Get health status of all circuit breakers
   */
  health(): Record<string, CircuitHealth> {
    const health: Record<string, CircuitHealth> = {};

    this.breakers.forEach((breaker, name) => {
      const stats = breaker.stats;
      health[name] = {
        state: breaker.opened
          ? 'OPEN'
          : breaker.halfOpen
            ? 'HALF_OPEN'
            : 'CLOSED',
        stats: {
          failures: stats.failures,
          successes: stats.successes,
          rejects: stats.rejects,
          fires: stats.fires,
        },
      };
    });

    return health;
  }

  /**
   * Check if any circuit breaker is open
   */
  hasOpenCircuits(): boolean {
    for (const [, breaker] of this.breakers) {
      if (breaker.opened) {
        return true;
      }
    }
    return false;
  }

  /**
   * Reset a specific circuit breaker
   */
  reset(name: string): void {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.close();
      this.logger.log(`Circuit breaker ${name} manually reset`);
    }
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    this.breakers.forEach((breaker, name) => {
      breaker.close();
      this.logger.log(`Circuit breaker ${name} manually reset`);
    });
  }
}
