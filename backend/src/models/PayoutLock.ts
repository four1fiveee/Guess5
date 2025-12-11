import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class PayoutLock {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'timestamp', unique: true })
  lockDate!: Date; // Sunday date when lock was created

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  totalAmountUSD!: number;

  @Column({ type: 'decimal', precision: 12, scale: 6 })
  totalAmountSOL!: number;

  @Column({ type: 'int' })
  referrerCount!: number;

  @Column({ type: 'timestamp', nullable: true })
  lockedAt?: Date; // When lock was created

  @Column({ type: 'timestamp', nullable: true })
  executedAt?: Date; // When payout was executed

  @Column({ type: 'text', nullable: true })
  transactionSignature?: string; // Solana transaction signature

  @Column({ type: 'text', nullable: true })
  executedByAdmin?: string; // Admin who executed (or 'auto' for auto-execute)

  @Column({ type: 'boolean', default: false })
  autoExecuted!: boolean; // True if executed automatically after countdown

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

