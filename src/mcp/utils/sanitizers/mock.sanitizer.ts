import { Injectable } from '@nestjs/common';
import { CrmSanitizer } from './crm-sanitizer.interface';

/**
 * Mock Sanitizer for local development/testing
 * Minimal validation, logs what would be sanitized
 */
@Injectable()
export class MockSanitizer implements CrmSanitizer {
  sanitizeSearchTerm(input: string): string {
    return input || '';
  }

  validateId(id: string): boolean {
    return !!id && id.length > 0;
  }

  sanitizeFieldValue(value: string): string {
    return value || '';
  }

  buildSearchQuery(
    searchTerm: string,
    fields: string[],
    objectType: string,
  ): string {
    return JSON.stringify({ searchTerm, fields, objectType, mock: true });
  }

  buildFilterClause(
    field: string,
    operator: string,
    value: string | string[],
  ): string {
    return JSON.stringify({ field, operator, value, mock: true });
  }
}
