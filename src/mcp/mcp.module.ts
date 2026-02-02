import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

// Config
import { SecretsProvider } from './config/secrets.provider';

// Utils
import { IdempotencyService } from './utils/idempotency.service';
import { PIIRedactor } from './utils/pii-redactor';
import { CircuitBreakerFactory } from './utils/circuit-breaker.factory';

// Sanitizers
import {
  CRM_SANITIZER,
  SalesforceSanitizer,
  MockSanitizer,
} from './utils/sanitizers';

// Guards
import { MCPSafetyGuard } from './guards/mcp-safety.guard';
import { MCPRateLimiter } from './guards/mcp-rate-limiter';

// Entities
import { CrmSyncLog } from './entities/crm-sync-log.entity';

// Executors
import { MockMCPExecutor } from './executors/mock.executor';
import { SalesforceMCPExecutor } from './executors/salesforce.executor';
import { MCP_EXECUTOR } from './interfaces/mcp-executor.interface';

// Registry
import { MCPRegistryService } from './registry/mcp-registry.service';

// Service
import { MCPService } from './mcp.service';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([CrmSyncLog])],
  providers: [
    // Config providers
    SecretsProvider,

    // Utility services
    IdempotencyService,
    PIIRedactor,
    CircuitBreakerFactory,

    // Guards
    MCPSafetyGuard,
    MCPRateLimiter,

    // CRM Sanitizer - selected based on CRM_PROVIDER env var
    {
      provide: CRM_SANITIZER,
      useFactory: (configService: ConfigService) => {
        const provider = configService.get<string>('CRM_PROVIDER', 'mock');
        switch ((provider ?? 'mock').toLowerCase()) {
          case 'salesforce':
            return new SalesforceSanitizer();
          default:
            return new MockSanitizer();
        }
      },
      inject: [ConfigService],
    },

    // Executors
    MockMCPExecutor,
    SalesforceMCPExecutor,

    // MCP Executor - selected based on CRM_PROVIDER env var
    {
      provide: MCP_EXECUTOR,
      useFactory: (
        configService: ConfigService,
        mockExecutor: MockMCPExecutor,
        salesforceExecutor: SalesforceMCPExecutor,
      ) => {
        const provider = configService.get<string>('CRM_PROVIDER', 'mock');
        switch ((provider ?? 'mock').toLowerCase()) {
          case 'salesforce':
            return salesforceExecutor;
          default:
            return mockExecutor;
        }
      },
      inject: [ConfigService, MockMCPExecutor, SalesforceMCPExecutor],
    },

    // Registry
    MCPRegistryService,

    // MCP Orchestration Service
    MCPService,

    // Redis client provider (optional - will be null if not configured)
    {
      provide: 'REDIS_CLIENT',
      useFactory: async () => {
        const redisUrl = process.env.REDIS_URL;
        if (redisUrl) {
          // Dynamic import for optional Redis dependency
          const RedisModule = await import('ioredis');
          const RedisCtor = (RedisModule.default ||
            RedisModule.Redis) as unknown as new (url: string) => unknown;
          return new RedisCtor(redisUrl);
        }
        return null;
      },
    },
  ],
  exports: [
    SecretsProvider,
    IdempotencyService,
    PIIRedactor,
    CircuitBreakerFactory,
    MCPSafetyGuard,
    MCPRateLimiter,
    CRM_SANITIZER,
    MCP_EXECUTOR,
    MCPRegistryService,
    MCPService,
    'REDIS_CLIENT',
  ],
})
export class MCPModule {}
