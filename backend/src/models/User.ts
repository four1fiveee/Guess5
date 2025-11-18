import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity()
@Index(['walletAddress'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  walletAddress!: string;

  @Column({ type: 'text', unique: true, nullable: true })
  username!: string | null; // Unique username chosen by player

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalEntryFees!: number; // Cumulative lifetime entry fees in USD

  @Column({ type: 'decimal', precision: 12, scale: 6, default: 0 })
  totalEntryFeesSOL!: number; // Cumulative in SOL

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

