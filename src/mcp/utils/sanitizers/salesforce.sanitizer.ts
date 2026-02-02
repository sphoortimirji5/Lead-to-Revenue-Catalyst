import { Injectable } from '@nestjs/common';
import { CrmSanitizer } from './crm-sanitizer.interface';

/**
 * Salesforce Query Sanitizer
 * Handles SOQL/SOSL injection prevention
 */
@Injectable()
export class SalesforceSanitizer implements CrmSanitizer {
  /**
   * Escape SOSL reserved characters
   * Reserved: ? & | ! { } [ ] ( ) ^ ~ * : \ " ' + -
   */
  sanitizeSearchTerm(input: string): string {
    if (!input) return '';
    return input
      .replace(/\\/g, '\\\\')
      .replace(/[?&|!{}[\]()^~*:"'+-]/g, '\\$&');
  }

  /**
   * Validate Salesforce ID format (15 or 18 char alphanumeric)
   */
  validateId(id: string): boolean {
    if (!id) return false;
    return /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(id);
  }

  /**
   * Escape SOQL reserved characters in field values
   */
  sanitizeFieldValue(value: string): string {
    if (!value) return '';
    return value
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  /**
   * Build safe SOSL query
   */
  buildSearchQuery(
    searchTerm: string,
    fields: string[],
    objectType: string,
  ): string {
    const safeTerm = this.sanitizeSearchTerm(searchTerm);
    const safeFields = fields
      .filter((f) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f))
      .join(', ');
    const safeObject = objectType.replace(/[^a-zA-Z0-9_]/g, '');

    return `FIND {${safeTerm}} IN ALL FIELDS RETURNING ${safeObject}(${safeFields})`;
  }

  /**
   * Build safe SOQL WHERE clause
   */
  buildFilterClause(
    field: string,
    operator: string,
    value: string | string[],
  ): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
      throw new Error(`Invalid field name: ${field}`);
    }

    if (operator === 'IN' && Array.isArray(value)) {
      const safeValues = value
        .map((v) => `'${this.sanitizeFieldValue(v)}'`)
        .join(', ');
      return `${field} IN (${safeValues})`;
    }

    const safeValue = this.sanitizeFieldValue(String(value));
    return `${field} ${operator} '${safeValue}'`;
  }
}
