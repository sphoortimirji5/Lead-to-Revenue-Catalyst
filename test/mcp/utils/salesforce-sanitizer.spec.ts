import { SalesforceSanitizer } from '../../../src/mcp/utils/sanitizers/salesforce.sanitizer';

describe('SalesforceSanitizer', () => {
  let sanitizer: SalesforceSanitizer;

  beforeEach(() => {
    sanitizer = new SalesforceSanitizer();
  });

  describe('sanitizeSearchTerm (SOSL)', () => {
    it('should return empty string for null/undefined', () => {
      expect(sanitizer.sanitizeSearchTerm('')).toBe('');
    });

    it('should escape SOSL special characters', () => {
      expect(sanitizer.sanitizeSearchTerm('test?')).toContain('\\');
      expect(sanitizer.sanitizeSearchTerm('test&query')).toContain('\\');
      expect(sanitizer.sanitizeSearchTerm('test|or')).toContain('\\');
      expect(sanitizer.sanitizeSearchTerm('test!')).toContain('\\');
      expect(sanitizer.sanitizeSearchTerm('test*')).toContain('\\');
    });

    it('should escape quotes', () => {
      expect(sanitizer.sanitizeSearchTerm("test'value")).toContain('\\');
      expect(sanitizer.sanitizeSearchTerm('test"value')).toContain('\\');
    });

    it('should escape brackets', () => {
      expect(sanitizer.sanitizeSearchTerm('test{value}')).toContain('\\');
      expect(sanitizer.sanitizeSearchTerm('test[value]')).toContain('\\');
      expect(sanitizer.sanitizeSearchTerm('test(value)')).toContain('\\');
    });
  });

  describe('sanitizeFieldValue (SOQL)', () => {
    it('should escape single quotes', () => {
      expect(sanitizer.sanitizeFieldValue("O'Brien")).toContain("\\'");
    });

    it('should escape newlines', () => {
      expect(sanitizer.sanitizeFieldValue('line1\nline2')).toContain('\\n');
      expect(sanitizer.sanitizeFieldValue('line1\rline2')).toContain('\\r');
    });

    it('should escape backslashes', () => {
      expect(sanitizer.sanitizeFieldValue('path\\to\\file')).toContain('\\\\');
    });
  });

  describe('validateId', () => {
    it('should validate 15-character IDs', () => {
      expect(sanitizer.validateId('001000000000001')).toBe(true);
      expect(sanitizer.validateId('00Q000000000ABC')).toBe(true);
    });

    it('should validate 18-character IDs', () => {
      expect(sanitizer.validateId('001000000000001AAA')).toBe(true);
      expect(sanitizer.validateId('00Q000000000ABCDEF')).toBe(true);
    });

    it('should reject invalid IDs', () => {
      expect(sanitizer.validateId('')).toBe(false);
      expect(sanitizer.validateId('short')).toBe(false);
      expect(sanitizer.validateId('00100000000000!')).toBe(false);
      expect(sanitizer.validateId('001-0000-0000-001')).toBe(false);
    });
  });

  describe('buildSearchQuery', () => {
    it('should build safe SOSL query', () => {
      const query = sanitizer.buildSearchQuery(
        'test@acme.com',
        ['Id', 'Name', 'Email'],
        'Contact',
      );
      expect(query).toContain('FIND {');
      expect(query).toContain('test@acme.com');
      expect(query).toContain('RETURNING Contact');
      expect(query).toContain('Id, Name, Email');
    });

    it('should sanitize search term in SOSL', () => {
      const query = sanitizer.buildSearchQuery(
        'test*?wildcard',
        ['Id', 'Name'],
        'Account',
      );
      expect(query).toContain('\\*');
      expect(query).toContain('\\?');
    });

    it('should filter invalid field names', () => {
      const query = sanitizer.buildSearchQuery(
        'test',
        ['Id', 'Name', 'Invalid Field!'],
        'Account',
      );
      expect(query).not.toContain('Invalid Field!');
      expect(query).toContain('Id, Name');
    });
  });

  describe('buildFilterClause', () => {
    it('should build safe WHERE clause with equals', () => {
      const clause = sanitizer.buildFilterClause(
        'Email',
        '=',
        'test@example.com',
      );
      expect(clause).toBe("Email = 'test@example.com'");
    });

    it('should build safe WHERE clause with IN', () => {
      const clause = sanitizer.buildFilterClause('Status', 'IN', [
        'Open',
        'Closed',
      ]);
      expect(clause).toBe("Status IN ('Open', 'Closed')");
    });

    it('should sanitize values in WHERE clause', () => {
      const clause = sanitizer.buildFilterClause('Name', '=', "O'Brien");
      expect(clause).toContain("\\'");
    });

    it('should reject invalid field names', () => {
      expect(() => {
        sanitizer.buildFilterClause('Invalid Field!', '=', 'value');
      }).toThrow('Invalid field name');
    });
  });
});
