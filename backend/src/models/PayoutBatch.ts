import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum PayoutBatchStatus {
  PREPARED = 'prepared',
  REVIEWED = 'reviewed',
  SENT = 'sent',
  FAILED = 'failed'
}

@Entity()
export class PayoutBatch {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'timestamp' })
  batchAt!: Date; // When batch was created

  @Column({ type: 'timestamp' })
  scheduledSendAt!: Date; // Sunday 13:00 EST

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 20 })
  minPayoutUSD!: number; // Minimum payout threshold (default $20)

  @Column({
    type: 'enum',
    enum: PayoutBatchStatus,
    default: PayoutBatchStatus.PREPARED
  })
  status!: PayoutBatchStatus;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  totalAmountUSD!: number;

  @Column({ type: 'decimal', precision: 12, scale: 6 })
  totalAmountSOL!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  solPriceAtPayout?: number; // SOL/USD price at payout time

  @Column({ type: 'text', nullable: true })
  createdByAdmin?: string; // Admin user who created the batch

  @Column({ type: 'text', nullable: true })
  reviewedByAdmin?: string; // Admin user who approved the batch

  @Column({ nullable: true })
  reviewedAt?: Date; // When batch was approved

  @Column({ type: 'text', nullable: true })
  transactionSignature?: string; // Solana transaction signature

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

