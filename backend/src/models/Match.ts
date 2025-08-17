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

  // Game state tracking for dispute resolution
  @Column({ nullable: true })
  targetWord?: string; // The actual word both players were trying to guess

  @Column({ type: 'jsonb', nullable: true })
  player1Guesses?: string[]; // Array of all guesses made by player1

  @Column({ type: 'jsonb', nullable: true })
  player2Guesses?: string[]; // Array of all guesses made by player2

  // Payment timing tracking
  @Column({ nullable: true })
  player1PaymentTime?: Date; // When player1 paid

  @Column({ nullable: true })
  player2PaymentTime?: Date; // When player2 paid

  // Guess timing tracking
  @Column({ nullable: true })
  player1LastGuessTime?: Date; // Timestamp of player1's final guess

  @Column({ nullable: true })
  player2LastGuessTime?: Date; // Timestamp of player2's final guess

  // Financial tracking
  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  refundAmount?: number; // Amount refunded (entry fee minus network fee)

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  payoutAmount?: number; // Amount paid to winner (after platform fee)

  // Dispute resolution tracking
  @Column({ default: false })
  disputeFlagged?: boolean; // Boolean if match was flagged for review

  @Column({ type: 'text', nullable: true })
  disputeNotes?: string; // Text field for dispute resolution notes

  @Column({ nullable: true })
  resolvedBy?: string; // Admin wallet that resolved the dispute

  @Column({ nullable: true })
  resolutionTime?: Date; // When dispute was resolved

  // Tax and financial tracking
  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  totalRevenue?: number; // Total SOL collected (entry fees)

  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  totalPayouts?: number; // Total SOL paid to winners

  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  totalRefunds?: number; // Total SOL refunded to players

  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  netRevenue?: number; // Revenue minus payouts minus refunds

  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  platformRevenue?: number; // Total platform fees collected

  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  networkFees?: number; // Total network fees paid

  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  taxableIncome?: number; // Platform revenue minus network fees

  @Column({ nullable: true })
  fiscalYear?: number; // For tax year organization

  @Column({ nullable: true })
  quarter?: number; // For quarterly reporting

  // USD equivalents at transaction time
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  entryFeeUSD?: number; // Entry fee in USD at transaction time

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  refundAmountUSD?: number; // Refund amount in USD

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  payoutAmountUSD?: number; // Payout amount in USD

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  platformFeeUSD?: number; // Platform fee in USD

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  totalFeesCollectedUSD?: number; // Total fees in USD

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  solPriceAtTransaction?: number; // SOL price in USD at transaction time

  @Column({ nullable: true })
  transactionTimestamp?: Date; // When the transaction occurred

  // Actual blockchain network fees
  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  actualNetworkFees?: number; // Actual fees charged by blockchain (Phantom)

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  actualNetworkFeesUSD?: number; // Actual fees in USD at transaction time

  // Detailed blockchain verification fields
  @Column({ nullable: true })
  player1PaymentBlockTime?: Date; // Block time from blockchain

  @Column({ nullable: true })
  player2PaymentBlockTime?: Date; // Block time from blockchain

  @Column({ nullable: true })
  winnerPayoutBlockTime?: Date; // Block time from blockchain

  @Column({ nullable: true })
  player1RefundBlockTime?: Date; // Block time from blockchain

  @Column({ nullable: true })
  player2RefundBlockTime?: Date; // Block time from blockchain

  @Column({ nullable: true })
  player1PaymentBlockNumber?: number; // Block number from blockchain

  @Column({ nullable: true })
  player2PaymentBlockNumber?: number; // Block number from blockchain

  @Column({ nullable: true })
  winnerPayoutBlockNumber?: number; // Block number from blockchain

  @Column({ nullable: true })
  player1RefundBlockNumber?: number; // Block number from blockchain

  @Column({ nullable: true })
  player2RefundBlockNumber?: number; // Block number from blockchain

  @Column({ default: false })
  player1PaymentConfirmed?: boolean; // Transaction confirmed on blockchain

  @Column({ default: false })
  player2PaymentConfirmed?: boolean; // Transaction confirmed on blockchain

  @Column({ default: false })
  winnerPayoutConfirmed?: boolean; // Transaction confirmed on blockchain

  @Column({ default: false })
  player1RefundConfirmed?: boolean; // Transaction confirmed on blockchain

  @Column({ default: false })
  player2RefundConfirmed?: boolean; // Transaction confirmed on blockchain

  // Individual transaction fees from blockchain
  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  player1PaymentFee?: number; // Actual fee from blockchain

  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  player2PaymentFee?: number; // Actual fee from blockchain

  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  winnerPayoutFee?: number; // Actual fee from blockchain

  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  player1RefundFee?: number; // Actual fee from blockchain

  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  player2RefundFee?: number; // Actual fee from blockchain

  @Column({ default: false })
  isCompleted!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
} 