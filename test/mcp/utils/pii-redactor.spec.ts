import { PIIRedactor } from '../../../src/mcp/utils/pii-redactor';

describe('PIIRedactor', () => {
  let redactor: PIIRedactor;

  beforeEach(() => {
    redactor = new PIIRedactor();
  });

  describe('redact with default settings (truncate)', () => {
    it('should redact email fields', () => {
      const input = { email: 'john.doe@example.com', name: 'Public' };
      const output = redactor.redact(input);
      expect(output.email).toBe('***.com');
      expect(output.name).toBe('Public');
    });

    it('should redact firstName and lastName', () => {
      const input = { firstName: 'Jonathan', lastName: 'Smithson' };
      const output = redactor.redact(input);
      expect(output.firstName).toBe('***than');
      expect(output.lastName).toBe('***hson');
    });

    it('should redact phone numbers', () => {
      const input = { phone: '+1-555-123-4567', mobile: '555-987-6543' };
      const output = redactor.redact(input);
      expect(output.phone).toBe('***4567');
      expect(output.mobile).toBe('***6543');
    });

    it('should handle nested objects', () => {
      const input = {
        lead: {
          email: 'nested@test.com',
          details: { firstName: 'Jonathan', phone: '5551234567' },
        },
      };
      const output = redactor.redact(input) as {
        lead: { email: string; details: { firstName: string; phone: string } };
      };
      expect(output.lead.email).toBe('***.com');
      expect(output.lead.details.firstName).toBe('***than');
      expect(output.lead.details.phone).toBe('***4567');
    });

    it('should handle arrays', () => {
      const input = {
        contacts: [{ email: 'first@test.com' }, { email: 'second@test.com' }],
      };
      const output = redactor.redact(input) as {
        contacts: Array<{ email: string }>;
      };
      expect(output.contacts[0].email).toBe('***.com');
      expect(output.contacts[1].email).toBe('***.com');
    });

    it('should detect email patterns in string values', () => {
      const input = { data: 'john.doe@company.com' };
      const output = redactor.redact(input);
      expect(output.data).toBe('j***@company.com');
    });
  });

  describe('redact with mask strategy', () => {
    it('should fully mask values', () => {
      const maskRedactor = new PIIRedactor({
        sensitiveFields: ['email', 'phone'],
        strategy: 'mask',
      });
      const input = { email: 'test@example.com', phone: '1234567890' };
      const output = maskRedactor.redact(input);
      expect(output.email).toMatch(/^\*+$/);
      expect(output.phone).toMatch(/^\*+$/);
    });
  });

  describe('redact with hash strategy', () => {
    it('should hash values consistently', () => {
      const hashRedactor = new PIIRedactor({
        sensitiveFields: ['email'],
        strategy: 'hash',
      });
      const input1 = { email: 'test@example.com' };
      const input2 = { email: 'test@example.com' };
      const output1 = hashRedactor.redact(input1);
      const output2 = hashRedactor.redact(input2);
      expect(output1.email).toBe(output2.email);
      expect(output1.email).toHaveLength(16);
    });
  });

  describe('edge cases', () => {
    it('should handle null and undefined', () => {
      expect(redactor.redact(null as any)).toBe(null);
      expect(redactor.redact(undefined as any)).toBe(undefined);
    });

    it('should handle non-string sensitive fields', () => {
      const input = { phone: 1234567890 }; // number instead of string
      const output = redactor.redact(input);
      expect(output.phone).toBe('[REDACTED]');
    });

    it('should handle short values', () => {
      const input = { email: 'a@b' };
      const output = redactor.redact(input);
      expect(output.email).toBe('***');
    });

    it('should handle field name variations', () => {
      const input = {
        first_name: 'Jonathan',
        lastName: 'Henderson',
        phone_number: '5551234567',
      };
      const output = redactor.redact(input);
      expect(output.first_name).toBe('***than');
      expect(output.lastName).toBe('***rson');
      expect(output.phone_number).toBe('***4567');
    });
  });

  describe('forLogging', () => {
    it('should return JSON string with redacted values', () => {
      const input = { email: 'test@example.com', id: 123 };
      const output = redactor.forLogging(input);
      expect(typeof output).toBe('string');
      const parsed = JSON.parse(output) as { id: number; email: string };
      expect(parsed.id).toBe(123);
      expect(parsed.email).not.toBe('test@example.com');
    });
  });
});
