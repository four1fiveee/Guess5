import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('user') // Explicitly set table name to 'user'
@Index(['walletAddress'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  walletAddress!: string;

  @Column({ type: 'text', nullable: true })
  username!: string | null; // Username chosen by player (not unique - wallet address is the unique identifier)

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalEntryFees!: number; // Cumulative lifetime entry fees in USD

  @Column({ type: 'decimal', precision: 12, scale: 6, default: 0 })
  totalEntryFeesSOL!: number; // Cumulative in SOL

  @Column({ default: false })
  exemptFromReferralMinimum!: boolean; // Admin exemption from 20-game minimum requirement

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

