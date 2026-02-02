import { IdempotencyService } from '../../../src/mcp/utils/idempotency.service';

describe('IdempotencyService', () => {
  let service: IdempotencyService;

  beforeEach(() => {
    // Create service without Redis (local dev mode)
    service = new IdempotencyService();
  });

  describe('generateKey', () => {
    it('should generate consistent keys for same inputs', () => {
      const key1 = service.generateKey(
        'test@example.com',
        'campaign-1',
        'create_lead',
        60,
      );
      const key2 = service.generateKey(
        'test@example.com',
        'campaign-1',
        'create_lead',
        60,
      );
      expect(key1).toBe(key2);
    });

    it('should be case-insensitive for email', () => {
      const key1 = service.generateKey(
        'Test@Example.COM',
        'campaign-1',
        'create_lead',
      );
      const key2 = service.generateKey(
        'test@example.com',
        'campaign-1',
        'create_lead',
      );
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different actions', () => {
      const key1 = service.generateKey(
        'test@example.com',
        'campaign-1',
        'create_lead',
      );
      const key2 = service.generateKey(
        'test@example.com',
        'campaign-1',
        'update_lead',
      );
      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different emails', () => {
      const key1 = service.generateKey(
        'user1@example.com',
        'campaign-1',
        'create_lead',
      );
      const key2 = service.generateKey(
        'user2@example.com',
        'campaign-1',
        'create_lead',
      );
      expect(key1).not.toBe(key2);
    });

    it('should handle undefined campaign', () => {
      const key1 = service.generateKey(
        'test@example.com',
        undefined,
        'create_lead',
      );
      const key2 = service.generateKey(
        'test@example.com',
        undefined,
        'create_lead',
      );
      expect(key1).toBe(key2);
    });

    it('should generate SHA-256 hash', () => {
      const key = service.generateKey(
        'test@example.com',
        'campaign-1',
        'create_lead',
      );
      // SHA-256 hex is 64 characters
      expect(key).toHaveLength(64);
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should trim whitespace from inputs', () => {
      const key1 = service.generateKey(
        '  test@example.com  ',
        'campaign-1',
        'create_lead',
      );
      const key2 = service.generateKey(
        'test@example.com',
        'campaign-1',
        'create_lead',
      );
      expect(key1).toBe(key2);
    });
  });

  describe('generateStableKey', () => {
    it('should generate key without time component', () => {
      const key1 = service.generateStableKey(
        'test@example.com',
        'campaign-1',
        'upsert_lead',
      );
      // Wait briefly and generate again
      const key2 = service.generateStableKey(
        'test@example.com',
        'campaign-1',
        'upsert_lead',
      );
      expect(key1).toBe(key2);
    });
  });

  describe('isProcessed (without Redis)', () => {
    it('should return not processed when Redis is unavailable', async () => {
      const result = await service.isProcessed('any-key');
      expect(result.processed).toBe(false);
    });
  });

  describe('storeResult (without Redis)', () => {
    it('should not throw when Redis is unavailable', async () => {
      await expect(
        service.storeResult('any-key', { success: true }),
      ).resolves.not.toThrow();
    });
  });

  describe('clear (without Redis)', () => {
    it('should not throw when Redis is unavailable', async () => {
      await expect(service.clear('any-key')).resolves.not.toThrow();
    });
  });
});
