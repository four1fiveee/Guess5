import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Match } from './Match';
import { PayoutBatch } from './PayoutBatch';

@Entity()
@Index(['uplineWallet'])
@Index(['matchId'])
@Index(['paid'])
@Index(['payoutBatchId'])
export class ReferralEarning {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  matchId!: string;

  @ManyToOne(() => Match)
  @JoinColumn({ name: 'matchId' })
  match!: Match;

  @Column({ type: 'text' })
  referredWallet!: string; // Wallet whose activity generated the payout

  @Column({ type: 'text' })
  uplineWallet!: string; // Beneficiary wallet

  @Column({ type: 'int' })
  level!: number; // 1, 2, or 3

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amountUSD!: number; // USD value at match time

  @Column({ type: 'decimal', precision: 12, scale: 6, nullable: true })
  amountSOL?: number; // Computed at payout time

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ default: false })
  paid!: boolean;

  @Column({ nullable: true })
  paidAt?: Date;

  @Column({ type: 'uuid', nullable: true })
  payoutBatchId?: string;

  @ManyToOne(() => PayoutBatch, { nullable: true })
  @JoinColumn({ name: 'payoutBatchId' })
  payoutBatch?: PayoutBatch;
}

