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

  @Column({ nullable: true })
  escrowAddress?: string;

  @Column({ nullable: true })
  gameStartTime?: Date;

  @Column({ nullable: true })
  player1EscrowConfirmed?: boolean;

  @Column({ nullable: true })
  player2EscrowConfirmed?: boolean;

  @Column({ nullable: true })
  player1EscrowSignature?: string;

  @Column({ nullable: true })
  player2EscrowSignature?: string;

  @Column({ default: false })
  player1Paid?: boolean;

  @Column({ default: false })
  player2Paid?: boolean;

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
    paymentSuccess?: boolean;
    paymentError?: string;
    transaction?: any;
  } | null;

  @Column({ default: false })
  isCompleted!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
} 