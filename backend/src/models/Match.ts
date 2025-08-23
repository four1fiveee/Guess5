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

  // Legacy escrow fields (for backward compatibility) - REMOVED @Column definitions
  // These fields are kept for TypeScript compatibility but columns were renamed
  escrowAddress?: string;
  player1EscrowConfirmed?: boolean;
  player2EscrowConfirmed?: boolean;
  player1EscrowSignature?: string;
  player2EscrowSignature?: string;

  // New fee wallet fields (renamed from escrow)
  @Column({ nullable: true })
  feeWalletAddress?: string;

  @Column({ nullable: true })
  player1EntryConfirmed?: boolean;

  @Column({ nullable: true })
  player2EntryConfirmed?: boolean;

  @Column({ nullable: true })
  player1EntrySignature?: string;

  @Column({ nullable: true })
  player2EntrySignature?: string;

  // Blockchain verification fields for entry payments
  @Column({ nullable: true })
  player1EntrySlot?: number;

  @Column({ nullable: true })
  player1EntryBlockTime?: Date;

  @Column({ default: false })
  player1EntryFinalized?: boolean;

  @Column({ nullable: true })
  player2EntrySlot?: number;

  @Column({ nullable: true })
  player2EntryBlockTime?: Date;

  @Column({ default: false })
  player2EntryFinalized?: boolean;

  // UTC timestamp fields for dual timezone support
  @Column({ nullable: true })
  gameStartTime?: Date;

  @Column({ nullable: true })
  gameStartTimeUtc?: Date;

  @Column({ nullable: true })
  gameEndTime?: Date;

  @Column({ nullable: true })
  gameEndTimeUtc?: Date;

  @Column({ nullable: true })
  refundedAt?: Date;

  @Column({ nullable: true })
  refundedAtUtc?: Date;

  // Payment status
  @Column({ default: false })
  player1Paid?: boolean;

  @Column({ default: false })
  player2Paid?: boolean;

  // Legacy payment signatures (for backward compatibility)
  @Column({ nullable: true })
  player1PaymentSignature?: string;

  @Column({ nullable: true })
  player2PaymentSignature?: string;

  // New payout signature fields with blockchain verification
  @Column({ nullable: true })
  winnerPayoutSignature?: string;

  @Column({ nullable: true })
  winnerPayoutSlot?: number;

  @Column({ nullable: true })
  winnerPayoutBlockTime?: Date;

  @Column({ default: false })
  winnerPayoutFinalized?: boolean;

  // Refund signature fields with blockchain verification
  @Column({ nullable: true })
  player1RefundSignature?: string;

  @Column({ nullable: true })
  player1RefundSlot?: number;

  @Column({ nullable: true })
  player1RefundBlockTime?: Date;

  @Column({ default: false })
  player1RefundFinalized?: boolean;

  @Column({ nullable: true })
  player2RefundSignature?: string;

  @Column({ nullable: true })
  player2RefundSlot?: number;

  @Column({ nullable: true })
  player2RefundBlockTime?: Date;

  @Column({ default: false })
  player2RefundFinalized?: boolean;

  // Financial tracking fields
  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  totalFeesCollected?: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  platformFee?: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  matchDuration?: number;

  // Completion tracking
  @Column({ default: false })
  isCompleted?: boolean;

  // Integrity hash field
  @Column({ nullable: true })
  rowHash?: string;

  // Match outcome
  @Column({ nullable: true })
  matchOutcome?: string;

  // Refund reason
  @Column({ nullable: true })
  refundReason?: string;

  // Game results
  @Column({ type: 'text', nullable: true })
  player1Result?: string | null;

  @Column({ type: 'text', nullable: true })
  player2Result?: string | null;

  @Column({ nullable: true })
  winner?: string | null;

  @Column({ type: 'text', nullable: true })
  payoutResult?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Helper methods for JSON serialization/deserialization
  getPlayer1Result(): {
    won: boolean;
    numGuesses: number;
    totalTime: number;
    guesses: string[];
  } | null {
    if (!this.player1Result) return null;
    try {
      return JSON.parse(this.player1Result);
    } catch {
      return null;
    }
  }

  setPlayer1Result(result: {
    won: boolean;
    numGuesses: number;
    totalTime: number;
    guesses: string[];
  } | null): void {
    this.player1Result = result ? JSON.stringify(result) : null;
  }

  getPlayer2Result(): {
    won: boolean;
    numGuesses: number;
    totalTime: number;
    guesses: string[];
  } | null {
    if (!this.player2Result) return null;
    try {
      return JSON.parse(this.player2Result);
    } catch {
      return null;
    }
  }

  setPlayer2Result(result: {
    won: boolean;
    numGuesses: number;
    totalTime: number;
    guesses: string[];
  } | null): void {
    this.player2Result = result ? JSON.stringify(result) : null;
  }

  getPayoutResult(): {
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
  } | null {
    if (!this.payoutResult) return null;
    try {
      return JSON.parse(this.payoutResult);
    } catch {
      return null;
    }
  }

  setPayoutResult(result: {
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
  } | null): void {
    this.payoutResult = result ? JSON.stringify(result) : null;
  }
} 