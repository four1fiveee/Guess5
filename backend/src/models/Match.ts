import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class Match {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  player1!: string;

  @Column({ nullable: true, type: 'varchar' })
  player2!: string;

  @Column({ nullable: true, type: 'text' })
  player1Username!: string | null; // Username at match creation time (for historical accuracy)

  @Column({ nullable: true, type: 'text' })
  player2Username!: string | null; // Username at match creation time (for historical accuracy)

  @Column({ type: 'decimal', precision: 10, scale: 6 })
  entryFee!: number;

  @Column({ default: 'pending' })
  status!: string;

  @Column({ nullable: true })
  word?: string;

  // Legacy escrow fields removed - now using multisig vaults

  // Squads Protocol fields (replaces old custodial vault system)
  @Column({ nullable: true })
  squadsVaultAddress?: string;

  @Column({ nullable: true })
  squadsVaultPda?: string;

  @Column({ nullable: true })
  payoutProposalId?: string;

  @Column({ nullable: true, type: 'varchar' })
  payoutProposalTransactionIndex?: string; // CRITICAL: Transaction index used to derive proposal PDA

  @Column({ nullable: true })
  proposalCreatedAt?: Date;

  @Column({ nullable: true, default: 'PENDING' })
  proposalStatus?: string; // PENDING, APPROVED, EXECUTED, REJECTED

  @Column({ type: 'text', nullable: true })
  proposalSigners?: string; // JSON array of public keys

  @Column({ nullable: true, default: 2 })
  needsSignatures?: number;

  @Column({ nullable: true })
  proposalExecutedAt?: Date;

  @Column({ nullable: true })
  proposalExpiresAt?: Date;

  // Execution attempt tracking (expert recommendation)
  @Column({ nullable: true, default: 0 })
  executionAttempts?: number;

  @Column({ nullable: true })
  executionLastAttemptAt?: Date;

  @Column({ nullable: true })
  proposalTransactionId?: string;

  @Column({ nullable: true })
  tieRefundProposalId?: string;

  @Column({ nullable: true, type: 'varchar' })
  tieRefundProposalTransactionIndex?: string; // CRITICAL: Transaction index used to derive refund proposal PDA

  // Payment signature fields
  @Column({ nullable: true })
  player1PaymentSignature?: string;

  @Column({ nullable: true })
  player2PaymentSignature?: string;

  @Column({ nullable: true })
  winnerPayoutSignature?: string;

  // Payment timestamp fields
  @Column({ nullable: true })
  player1PaymentTime?: Date;

  @Column({ nullable: true })
  player2PaymentTime?: Date;

  // Payment block time fields
  @Column({ nullable: true })
  player1PaymentBlockTime?: Date;

  @Column({ nullable: true })
  player2PaymentBlockTime?: Date;

  @Column({ nullable: true })
  winnerPayoutBlockTime?: Date;

  // Payment block number fields
  @Column({ type: 'bigint', nullable: true })
  player1PaymentBlockNumber?: number;

  @Column({ type: 'bigint', nullable: true })
  player2PaymentBlockNumber?: number;

  @Column({ type: 'bigint', nullable: true })
  winnerPayoutBlockNumber?: number;

  // Financial amount fields
  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  payoutAmount?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  payoutAmountUSD?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  entryFeeUSD?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  solPriceAtTransaction?: number;

  // Multisig deposit tracking fields
  @Column({ nullable: true })
  depositATx?: string;

  @Column({ nullable: true })
  depositBTx?: string;

  @Column({ default: 0 })
  depositAConfirmations?: number;

  @Column({ default: 0 })
  depositBConfirmations?: number;

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

  // Multisig transaction tracking
  @Column({ nullable: true })
  payoutTxHash?: string;

  @Column({ nullable: true })
  refundTxHash?: string;

  // Match status tracking for multisig system
  @Column({ default: 'PENDING' })
  matchStatus?: string; // PENDING, VAULT_CREATED, READY, ACTIVE, SETTLED, REFUNDED

  @Column({ nullable: true })
  attestationHash?: string;

  // Financial tracking fields
  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  totalFeesCollected?: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  platformFee?: number;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  bonusPercent?: number;

  @Column({ type: 'decimal', precision: 12, scale: 6, nullable: true })
  bonusAmount?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  bonusAmountUSD?: number;

  @Column({ nullable: true })
  bonusSignature?: string;

  @Column({ default: false })
  bonusPaid?: boolean;

  @Column({ nullable: true })
  bonusPaidAt?: Date;

  @Column({ nullable: true })
  bonusTier?: string;

  // Referral program fields
  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  squadsCost?: number; // Squads network costs per match

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  squadsCostUSD?: number; // USD equivalent

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  netProfit?: number; // Calculated as platformFee - bonusAmount - squadsCost

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  netProfitUSD?: number; // USD equivalent

  @Column({ default: false })
  referralEarningsComputed?: boolean; // Flag to track if referral earnings were calculated

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
  player1Result?: string;

  @Column({ type: 'text', nullable: true })
  player2Result?: string;

  @Column({ nullable: true, type: 'varchar' })
  winner?: string;

  @Column({ type: 'text', nullable: true })
  payoutResult?: string;

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
    this.player1Result = result ? JSON.stringify(result) : undefined;
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
    this.player2Result = result ? JSON.stringify(result) : undefined;
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
    [key: string]: any; // Allow additional properties
  } | null): void {
    this.payoutResult = result ? JSON.stringify(result) : undefined;
  }

  // Helper methods for proposal signers
  getProposalSigners(): string[] {
    if (!this.proposalSigners) return [];
    try {
      return JSON.parse(this.proposalSigners);
    } catch {
      return [];
    }
  }

  setProposalSigners(signers: string[]): void {
    this.proposalSigners = JSON.stringify(signers);
  }

  addProposalSigner(signer: string): void {
    const signers = this.getProposalSigners();
    if (!signers.includes(signer)) {
      signers.push(signer);
      this.setProposalSigners(signers);
    }
  }

  hasSignedProposal(signer: string): boolean {
    return this.getProposalSigners().includes(signer);
  }
} 