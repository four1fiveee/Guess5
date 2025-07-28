import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class Match {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  player1!: string;

  @Column({ nullable: true })
  player2!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 6 })
  entryFee!: number;

  @Column({ default: 'pending' })
  status!: string;

  @Column({ nullable: true })
  word?: string;

  @Column({ type: 'simple-json', nullable: true })
  player1Result?: {
    won: boolean;
    numGuesses: number;
    totalTime: number;
    guesses: string[];
  } | null;

  @Column({ type: 'simple-json', nullable: true })
  player2Result?: {
    won: boolean;
    numGuesses: number;
    totalTime: number;
    guesses: string[];
  } | null;

  @Column({ nullable: true })
  winner?: string | null;

  @Column({ type: 'simple-json', nullable: true })
  payoutResult?: {
    winner: string;
    winnerAmount: number;
    feeAmount: number;
    feeWallet: string;
    transactions: Array<{
      from: string;
      to: string;
      amount: number;
      description: string;
    }>;
  } | null;

  @Column({ default: false })
  isCompleted!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
} 