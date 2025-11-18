import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity()
@Index(['referredWallet', 'level', 'uplineWallet'], { unique: true })
@Index(['uplineWallet'])
@Index(['referredWallet'])
export class ReferralUpline {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  referredWallet!: string;

  @Column({ type: 'int' })
  level!: number; // 1, 2, or 3

  @Column({ type: 'text' })
  uplineWallet!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

