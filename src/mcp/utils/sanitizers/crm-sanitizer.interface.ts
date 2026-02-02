/**
 * CRM Query Sanitizer Interface
 * Implementations handle CRM-specific query/input sanitization
 */
export interface CrmSanitizer {
  /**
   * Sanitize a search term for the CRM's query language
   */
  sanitizeSearchTerm(input: string): string;

  /**
   * Validate and sanitize a record ID
   */
  validateId(id: string): boolean;

  /**
   * Sanitize field values before sending to CRM
   */
  sanitizeFieldValue(value: string): string;

  /**
   * Build a safe search query
   */
  buildSearchQuery(
    searchTerm: string,
    fields: string[],
    objectType: string,
  ): string;

  /**
   * Build a safe filter/where clause
   */
  buildFilterClause(
    field: string,
    operator: string,
    value: string | string[],
  ): string;
}

export const CRM_SANITIZER = 'CRM_SANITIZER';
