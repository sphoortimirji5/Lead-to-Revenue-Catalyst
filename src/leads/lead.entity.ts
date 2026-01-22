import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('leads')
export class Lead {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true })
    idempotencyKey: string;

    @Column()
    email: string;

    @Column()
    campaignId: string;

    @Column({ nullable: true })
    name: string;

    @Column({ type: 'jsonb', nullable: true })
    enrichmentData: any;

    @Column({ default: 'PENDING' })
    status: string;

    @Column({ nullable: true })
    fitScore: number;

    @Column({ nullable: true })
    intent: string;

    @Column({ type: 'text', nullable: true })
    reasoning: string;

    @Column({ type: 'jsonb', nullable: true })
    evidence: any;

    @Column({ type: 'varchar', nullable: true })
    grounding_status: string | null;

    @Column({ type: 'jsonb', nullable: true })
    grounding_errors: string[] | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
