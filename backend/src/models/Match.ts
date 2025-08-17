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
      signature?: string;
    }>;
    paymentSuccess?: boolean;
    paymentError?: string;
    transaction?: any;
  } | null;

  // Blockchain transaction tracking
  @Column({ nullable: true })
  player1PaymentSignature?: string;

  @Column({ nullable: true })
  player2PaymentSignature?: string;

  @Column({ nullable: true })
  winnerPayoutSignature?: string;

  @Column({ nullable: true })
  player1RefundSignature?: string;

  @Column({ nullable: true })
  player2RefundSignature?: string;

  // Match outcome tracking
  @Column({ nullable: true })
  matchOutcome?: string; // 'player1_win', 'player2_win', 'tie', 'both_lose', 'cancelled'

  @Column({ nullable: true })
  gameEndTime?: Date;

  @Column({ nullable: true })
  matchDuration?: number; // in seconds

  // Fee tracking
  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  totalFeesCollected?: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  platformFee?: number;

  // Refund tracking
  @Column({ nullable: true })
  refundReason?: string; // 'payment_timeout', 'both_players_lost', 'cleanup', etc.

  @Column({ nullable: true })
  refundedAt?: Date;

  // Player performance tracking
  @Column({ nullable: true })
  player1Moves?: number; // Number of guesses made by player1

  @Column({ nullable: true })
  player2Moves?: number; // Number of guesses made by player2

  @Column({ nullable: true })
  player1CompletionTime?: number; // Time in seconds to complete the word

  @Column({ nullable: true })
  player2CompletionTime?: number; // Time in seconds to complete the word

  @Column({ default: false })
  isCompleted!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
} 