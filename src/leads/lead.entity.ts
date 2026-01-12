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

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
