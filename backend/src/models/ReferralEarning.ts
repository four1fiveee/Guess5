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
  level!: number; // Always 1 for direct referrals in new tiered system

  @Column({ type: 'varchar', length: 20, nullable: true })
  tierName?: string; // Tier name at time of earning: Base, Silver, Gold, Platinum

  @Column({ type: 'int', nullable: true })
  tier?: number; // Tier number at time of earning: 0 (Base), 1 (Silver), 2 (Gold), 3 (Platinum)

  @Column({ type: 'decimal', precision: 5, scale: 4, nullable: true })
  percentage?: number; // Percentage used at time of earning: 0.10, 0.15, 0.20, 0.25

  @Column({ default: false })
  bothPlayersReferred!: boolean; // Whether both players in the match were referred by this referrer

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

