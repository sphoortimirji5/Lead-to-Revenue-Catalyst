import { Injectable, Optional, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

export interface RedactionConfig {
  sensitiveFields: string[];
  strategy: 'mask' | 'hash' | 'truncate';
  truncateShowLast?: number;
}

@Injectable()
export class PIIRedactor {
  private readonly logger = new Logger(PIIRedactor.name);
  private readonly DEFAULT_CONFIG: RedactionConfig = {
    sensitiveFields: [
      'email',
      'firstname',
      'lastname',
      'phone',
      'mobile',
      'address',
      'city',
      'state',
      'postalcode',
      'zipcode',
      'ssn',
      'taxid',
      'dateofbirth',
      'dob',
    ],
    strategy: 'truncate',
    truncateShowLast: 4,
  };

  private config: RedactionConfig;

  constructor(@Optional() config?: RedactionConfig) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * Deep redact an object
   */
  redact<T extends Record<string, any>>(obj: T): Record<string, any> {
    if (obj === null || obj === undefined) {
      return obj;
    }
    return this.redactValue(obj) as Record<string, any>;
  }

  private redactValue(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      return this.redactStringContent(value);
    }

    if (Array.isArray(value)) {
      return value.map((item: unknown) => this.redactValue(item));
    }

    if (typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).reduce(
        (acc, [key, val]) => {
          if (this.isSensitiveField(key)) {
            acc[key] = this.applyRedaction(val);
          } else {
            acc[key] = this.redactValue(val);
          }
          return acc;
        },
        {} as Record<string, unknown>,
      );
    }

    return value;
  }

  private isSensitiveField(key: string): boolean {
    const normalized = key.toLowerCase().replace(/[_\-\s]/g, '');
    return this.config.sensitiveFields.some((field) =>
      normalized.includes(field.toLowerCase()),
    );
  }

  private applyRedaction(value: unknown): string {
    if (typeof value !== 'string') {
      return '[REDACTED]';
    }

    switch (this.config.strategy) {
      case 'mask':
        return '*'.repeat(Math.min(value.length, 20));

      case 'hash':
        return createHash('sha256')
          .update(value)
          .digest('hex')
          .substring(0, 16);

      case 'truncate': {
        const showLast = this.config.truncateShowLast || 4;
        if (value.length <= showLast) {
          return '*'.repeat(value.length);
        }
        return `***${value.slice(-showLast)}`;
      }

      default:
        return '[REDACTED]';
    }
  }

  /**
   * Check if string contains PII patterns and redact them inline
   */
  private redactStringContent(value: string): string {
    // Check for email pattern
    if (this.containsEmail(value)) {
      return this.redactEmail(value);
    }

    // Check for phone pattern
    if (this.containsPhone(value)) {
      return this.redactPhone(value);
    }

    return value;
  }

  private containsEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  private containsPhone(value: string): boolean {
    // Basic phone pattern (US format)
    return /^[\d\s\-+()]{10,}$/.test(value.replace(/\D/g, ''));
  }

  private redactEmail(email: string): string {
    const atIndex = email.indexOf('@');
    if (atIndex <= 0) return email;

    const [local, domain] = email.split('@');
    return `${local.charAt(0)}***@${domain}`;
  }

  private redactPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 4) return '*'.repeat(digits.length);
    return `***${digits.slice(-4)}`;
  }

  /**
   * Create a redacted copy for logging
   */
  forLogging<T extends Record<string, any>>(obj: T): string {
    return JSON.stringify(this.redact(obj));
  }
}
