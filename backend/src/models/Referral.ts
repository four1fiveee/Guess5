import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity()
@Index(['referrerWallet'])
@Index(['referredWallet'], { unique: true })
export class Referral {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  referredWallet!: string; // Wallet address of the new user

  @Column({ type: 'text' })
  referrerWallet!: string; // Wallet address of the direct referrer

  @CreateDateColumn()
  referredAt!: Date;

  @Column({ default: false })
  eligible!: boolean; // true once referrer_wallet has played at least one match

  @Column({ default: true })
  active!: boolean;
}

