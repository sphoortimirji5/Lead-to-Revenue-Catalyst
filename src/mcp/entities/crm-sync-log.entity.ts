import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * CRM Sync Log Entity
 * Tracks all MCP actions for audit, replay, and local development
 */
@Entity('crm_sync_logs')
@Index(['action', 'entityType'])
@Index(['mcpExecutionId'])
export class CrmSyncLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50 })
  action: string;

  @Column({ length: 50 })
  entityType: string;

  @Column({ length: 50, nullable: true })
  entityId: string;

  @Column({ type: 'jsonb', nullable: true })
  params: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, any>;

  @Column({ length: 36, nullable: true })
  mcpExecutionId: string;

  @Column({ length: 255, nullable: true })
  idempotencyKey: string;

  @Column({ default: true })
  mock: boolean;

  @Column({ nullable: true })
  leadId: number;

  @Column({ nullable: true })
  durationMs: number;

  @Column({ nullable: true })
  errorMessage: string;

  @CreateDateColumn()
  timestamp: Date;
}
