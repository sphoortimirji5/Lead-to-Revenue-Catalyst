import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

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
  private readonly logger = new Logger(SecretsProvider.name);
  private cachedSecrets: Map<string, CrmCredentials> = new Map();
  private cacheExpiry: Map<string, number> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private configService: ConfigService,
    @Optional() private secretsManager?: SecretsManagerClient,
  ) {
    // Initialize AWS Secrets Manager client if in production
    if (
      this.configService.get('NODE_ENV') === 'production' &&
      !this.secretsManager
    ) {
      this.secretsManager = new SecretsManagerClient({
        region: this.configService.get('AWS_REGION', 'us-east-1'),
      });
    }
  }

  /**
   * Get the configured CRM provider from environment
   */
  getConfiguredProvider(): string {
    return this.configService.get('CRM_PROVIDER', 'mock');
  }

  /**
   * Get credentials for configured CRM provider
   * @param provider Optional override, otherwise uses CRM_PROVIDER env var
   */
  async getCredentials(provider?: string): Promise<CrmCredentials> {
    const providerName = provider || this.getConfiguredProvider();
    const cacheKey = `crm_${providerName}`;
    const expiry = this.cacheExpiry.get(cacheKey);

    // Check cache first
    if (expiry && Date.now() < expiry && this.cachedSecrets.has(cacheKey)) {
      this.logger.debug(`Using cached credentials for ${provider}`);
      return this.cachedSecrets.get(cacheKey)!;
    }

    // Production: Use AWS Secrets Manager
    if (this.configService.get('NODE_ENV') === 'production') {
      return this.getFromSecretsManager(providerName, cacheKey);
    }

    // Development: Fall back to environment variables
    return this.getFromEnvironment(providerName);
  }

  private async getFromSecretsManager(
    provider: string,
    cacheKey: string,
  ): Promise<CrmCredentials> {
    const secretName = this.configService.get<string>(
      `AWS_SECRET_NAME_${provider.toUpperCase()}`,
    );

    if (!secretName) {
      throw new Error(`Secret name not configured for ${provider}`);
    }

    if (!this.secretsManager) {
      throw new Error('Secrets Manager client not initialized');
    }

    try {
      const command = new GetSecretValueCommand({ SecretId: secretName });
      const response = await this.secretsManager.send(command);

      if (!response.SecretString) {
        throw new Error('Empty secret response');
      }

      const credentials = JSON.parse(response.SecretString) as CrmCredentials;

      // Cache with TTL
      this.cachedSecrets.set(cacheKey, credentials);
      this.cacheExpiry.set(cacheKey, Date.now() + this.CACHE_TTL_MS);

      this.logger.log(
        `Retrieved credentials from Secrets Manager for ${provider}`,
      );
      return credentials;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to retrieve credentials from Secrets Manager: ${errorMessage}`,
      );
      throw new Error(`Credential retrieval failed for ${provider}`);
    }
  }

  private getFromEnvironment(provider: string): CrmCredentials {
    this.logger.warn(
      `Using environment variables for ${provider} credentials (development only)`,
    );

    const prefix = provider.toUpperCase();
    return {
      username: this.configService.get(`${prefix}_USERNAME`),
      password: this.configService.get(`${prefix}_PASSWORD`),
      securityToken: this.configService.get(`${prefix}_SECURITY_TOKEN`),
      accessToken: this.configService.get(`${prefix}_ACCESS_TOKEN`),
      clientId: this.configService.get(`${prefix}_CLIENT_ID`),
      clientSecret: this.configService.get(`${prefix}_CLIENT_SECRET`),
    };
  }

  /**
   * Clear cache (useful for credential rotation)
   */
  clearCache(): void {
    this.cachedSecrets.clear();
    this.cacheExpiry.clear();
    this.logger.log('Credentials cache cleared');
  }

  /**
   * Clear cache for specific provider
   */
  clearProviderCache(provider: string): void {
    const cacheKey = `crm_${provider}`;
    this.cachedSecrets.delete(cacheKey);
    this.cacheExpiry.delete(cacheKey);
    this.logger.log(`Credentials cache cleared for ${provider}`);
  }
}
