import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import { FEE_WALLET_ADDRESS } from '../config/wallet';
import { AppDataSource } from '../db';
import { ReferralEarning } from '../models/ReferralEarning';
import { PayoutBatch, PayoutBatchStatus } from '../models/PayoutBatch';
import { PriceService } from './priceService';

// Smart contract configuration - using environment variables
// Note: These are used in the smart contract service integration

// Configuration
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || "https://api.devnet.solana.com";
const connection = new Connection(SOLANA_NETWORK);

// Escrow account for holding entry fees
const ESCROW_WALLET_ADDRESS = "3Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt"; // This should be a program-controlled escrow

// Validate payout configuration
const validatePayoutConfig = () => {
  if (!process.env.SOLANA_NETWORK) {
    console.warn('⚠️ SOLANA_NETWORK not set, using default devnet');
  }
  
  console.log('✅ Payout service configuration validated');
  console.log(`🔗 Network: ${SOLANA_NETWORK}`);
  console.log(`💰 Fee Wallet: ${FEE_WALLET_ADDRESS}`);
  console.log(`🔒 Escrow Wallet: ${ESCROW_WALLET_ADDRESS}`);
};

// Validate on module load
validatePayoutConfig();


export const createEscrowAccount = async (matchId: string, player1: string, player2: string, entryFee: number) => {
  try {
    console.log('🔒 Creating escrow account for match:', matchId);
    console.log('Players:', { player1, player2 });
    console.log('Entry fee:', entryFee, 'SOL');

    // Create escrow account for this match
    const escrowKeypair = Keypair.generate();
    const escrowPublicKey = escrowKeypair.publicKey;

    // Calculate required SOL for escrow (entry fees from both players)
    const totalEscrowAmount = entryFee * 2 * LAMPORTS_PER_SOL;

    console.log('💰 Total escrow amount:', totalEscrowAmount / LAMPORTS_PER_SOL, 'SOL');
    console.log('🔒 Escrow address generated:', escrowPublicKey.toString());

    // For now, we'll just return the escrow address
    // The actual transaction will be created when players lock their entry fees
    return {
      success: true,
      escrowAddress: escrowPublicKey.toString(),
      escrowKeypair: escrowKeypair,
      totalAmount: totalEscrowAmount,
      entryFee: entryFee * LAMPORTS_PER_SOL
    };
  } catch (error: unknown) {
    console.error('❌ Error creating escrow account:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
};

export const transferToEscrow = async (fromWallet: string, escrowAddress: string, amount: number) => {
  try {
    console.log('💸 Transferring to escrow:', {
      from: fromWallet,
      to: escrowAddress,
      amount: amount / LAMPORTS_PER_SOL,
      unit: 'SOL'
    });

    // Create transaction to transfer entry fee to escrow
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(fromWallet),
        toPubkey: new PublicKey(escrowAddress),
        lamports: amount
      })
    );

    // Get the latest blockhash for the transaction
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = new PublicKey(fromWallet);

    console.log('✅ Escrow transaction created successfully');
    console.log('📝 Transaction details:', {
      from: fromWallet,
      to: escrowAddress,
      amount: amount / LAMPORTS_PER_SOL,
      blockhash: blockhash
    });

    return {
      success: true,
      transaction: transaction,
      message: 'Transaction created - requires player signature'
    };
  } catch (error: unknown) {
    console.error('❌ Error creating escrow transaction:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
};

export const payout = async (matchData: {
  matchId: string;
  winner: string;
  loser: string;
  entryFee: number;
  escrowAddress: string;
}) => {
  try {
    console.log('💰 Executing automated payout for match:', matchData.matchId);
    console.log('Winner:', matchData.winner);
    console.log('Loser:', matchData.loser);
    console.log('Entry fee:', matchData.entryFee, 'SOL');

    const totalPotLamports = matchData.entryFee * 2 * LAMPORTS_PER_SOL; // Total pot is both players' entry fees
    const winnerAmount = totalPotLamports * 0.95; // 95% of total pot to winner
    const feeAmount = totalPotLamports * 0.05; // 5% fee from total pot

    console.log('💰 Payout breakdown:');
    console.log('  - Winner gets:', winnerAmount / LAMPORTS_PER_SOL, 'SOL');
    console.log('  - Fee wallet gets:', feeAmount / LAMPORTS_PER_SOL, 'SOL');

    // Create payout transaction from escrow
    const payoutTransaction = new Transaction().add(
      // Transfer 95% to winner
      SystemProgram.transfer({
        fromPubkey: new PublicKey(matchData.escrowAddress),
        toPubkey: new PublicKey(matchData.winner),
        lamports: winnerAmount
      }),
      // Transfer 5% to fee wallet
      SystemProgram.transfer({
        fromPubkey: new PublicKey(matchData.escrowAddress),
        toPubkey: new PublicKey(FEE_WALLET_ADDRESS),
        lamports: feeAmount
      })
    );

    console.log('✅ Payout transaction created');
    console.log('📤 Transaction details:', {
      from: matchData.escrowAddress,
      winnerPayment: winnerAmount / LAMPORTS_PER_SOL,
      feePayment: feeAmount / LAMPORTS_PER_SOL,
      winnerAddress: matchData.winner,
      feeAddress: FEE_WALLET_ADDRESS
    });

    return {
      success: true,
      transaction: payoutTransaction,
      winnerAmount: winnerAmount / LAMPORTS_PER_SOL,
      feeAmount: feeAmount / LAMPORTS_PER_SOL,
      message: 'Automated payout transaction created'
    };

  } catch (error: unknown) {
    console.error('❌ Error creating payout transaction:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
};

export const refundEscrow = async (matchData: {
  matchId: string;
  player1: string;
  player2: string;
  entryFee: number;
  escrowAddress: string;
}) => {
  try {
    console.log('🔄 Refunding escrow for tie game:', matchData.matchId);

    const entryFeeLamports = matchData.entryFee * LAMPORTS_PER_SOL;

    // Create refund transaction
    const refundTransaction = new Transaction().add(
      // Refund player 1
      SystemProgram.transfer({
        fromPubkey: new PublicKey(matchData.escrowAddress),
        toPubkey: new PublicKey(matchData.player1),
        lamports: entryFeeLamports
      }),
      // Refund player 2
      SystemProgram.transfer({
        fromPubkey: new PublicKey(matchData.escrowAddress),
        toPubkey: new PublicKey(matchData.player2),
        lamports: entryFeeLamports
      })
    );

    console.log('✅ Refund transaction created');
    console.log('📤 Refund details:', {
      from: matchData.escrowAddress,
      player1Refund: entryFeeLamports / LAMPORTS_PER_SOL,
      player2Refund: entryFeeLamports / LAMPORTS_PER_SOL
    });

    return {
      success: true,
      transaction: refundTransaction,
      message: 'Escrow refund transaction created'
    };

  } catch (error: unknown) {
    console.error('❌ Error creating refund transaction:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
};

// Refund from fee wallet for failed matches
export const refundFromFeeWallet = async (matchData: {
  matchId: string;
  player1: string;
  player2: string;
  entryFee: number;
  player1Paid: boolean;
  player2Paid: boolean;
}) => {
  try {
    console.log('🔄 Processing refunds from fee wallet for failed match:', matchData.matchId);

    const entryFeeLamports = matchData.entryFee * LAMPORTS_PER_SOL;
    const refundTransactions = [];

    // Create refund transaction for player 1 if they paid
    if (matchData.player1Paid) {
      console.log(`💰 Creating refund transaction for Player 1: ${matchData.player1}`);
      const player1RefundTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(FEE_WALLET_ADDRESS),
          toPubkey: new PublicKey(matchData.player1),
          lamports: entryFeeLamports
        })
      );
      refundTransactions.push({
        player: matchData.player1,
        transaction: player1RefundTx,
        amount: entryFeeLamports
      });
    }

    // Create refund transaction for player 2 if they paid
    if (matchData.player2Paid) {
      console.log(`💰 Creating refund transaction for Player 2: ${matchData.player2}`);
      const player2RefundTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(FEE_WALLET_ADDRESS),
          toPubkey: new PublicKey(matchData.player2),
          lamports: entryFeeLamports
        })
      );
      refundTransactions.push({
        player: matchData.player2,
        transaction: player2RefundTx,
        amount: entryFeeLamports
      });
    }

    console.log(`✅ Created ${refundTransactions.length} refund transactions`);
    console.log('📤 Refund details:', {
      matchId: matchData.matchId,
      player1Paid: matchData.player1Paid,
      player2Paid: matchData.player2Paid,
      refundCount: refundTransactions.length
    });

    return {
      success: true,
      transactions: refundTransactions,
      message: `Created ${refundTransactions.length} refund transactions`
    };

  } catch (error: unknown) {
    console.error('❌ Error creating fee wallet refund transactions:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
};

// Referral payout batch functions
export const referralPayoutService = {
  /**
   * Aggregate unpaid referral earnings >= $20 by upline_wallet
   */
  async aggregateWeeklyPayouts(minPayoutUSD: number = 20): Promise<Array<{
    uplineWallet: string;
    totalUSD: number;
    matchCount: number;
    lastMatchTime: Date;
  }>> {
    const result = await AppDataSource.query(`
      SELECT 
        upline_wallet as "uplineWallet",
        SUM(amount_usd) as "totalUSD",
        COUNT(*) as "matchCount",
        MAX("createdAt") as "lastMatchTime"
      FROM referral_earning
      WHERE paid = false
        AND amount_usd IS NOT NULL
      GROUP BY upline_wallet
      HAVING SUM(amount_usd) >= $1
      ORDER BY "totalUSD" DESC
    `, [minPayoutUSD]);

    return result.map((row: any) => ({
      uplineWallet: row.uplineWallet,
      totalUSD: parseFloat(row.totalUSD),
      matchCount: parseInt(row.matchCount),
      lastMatchTime: row.lastMatchTime
    }));
  },

  /**
   * Prepare a payout batch for weekly payouts
   */
  async preparePayoutBatch(
    scheduledSendAt: Date,
    minPayoutUSD: number = 20,
    createdByAdmin?: string
  ): Promise<PayoutBatch> {
    // Get all eligible payouts
    const payouts = await this.aggregateWeeklyPayouts(minPayoutUSD);

    if (payouts.length === 0) {
      throw new Error('No eligible payouts found');
    }

    // Get SOL price
    const solPrice = await PriceService.getSOLPrice();

    // Calculate total amounts
    const totalUSD = payouts.reduce((sum, p) => sum + p.totalUSD, 0);
    const totalSOL = await PriceService.convertUSDToSOL(totalUSD);

    // Create batch
    const batchRepository = AppDataSource.getRepository(PayoutBatch);
    const batch = batchRepository.create({
      batchAt: new Date(),
      scheduledSendAt,
      minPayoutUSD,
      status: PayoutBatchStatus.PREPARED,
      totalAmountUSD: totalUSD,
      totalAmountSOL: totalSOL,
      solPriceAtPayout: solPrice,
      createdByAdmin
    });

    const savedBatch = await batchRepository.save(batch);

    // Update earnings with batch ID
    const earningRepository = AppDataSource.getRepository(ReferralEarning);
    const uplineWallets = payouts.map(p => p.uplineWallet);
    
    await earningRepository.query(`
      UPDATE referral_earning
      SET "payoutBatchId" = $1
      WHERE "uplineWallet" = ANY($2)
        AND paid = false
        AND "payoutBatchId" IS NULL
    `, [savedBatch.id, uplineWallets]);

    console.log(`✅ Prepared payout batch ${savedBatch.id} with ${payouts.length} payouts totaling $${totalUSD} USD (${totalSOL} SOL)`);

    return savedBatch;
  },

  /**
   * Generate Solana transaction for batch payout
   */
  async generateBatchTransaction(batchId: string): Promise<Transaction> {
    const batchRepository = AppDataSource.getRepository(PayoutBatch);
    const batch = await batchRepository.findOne({ where: { id: batchId } });

    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }

    if (batch.status !== PayoutBatchStatus.PREPARED && batch.status !== PayoutBatchStatus.REVIEWED) {
      throw new Error(`Batch ${batchId} is not in prepared/reviewed status`);
    }

    // Get all earnings for this batch
    const earningRepository = AppDataSource.getRepository(ReferralEarning);
    const earnings = await earningRepository.find({
      where: { payoutBatchId: batchId, paid: false }
    });

    // Convert USD to SOL for each earning
    const solPrice = batch.solPriceAtPayout || await PriceService.getSOLPrice();
    const transaction = new Transaction();

    // Group by upline wallet to combine payments
    const paymentsByWallet = new Map<string, number>();
    
    for (const earning of earnings) {
      const amountSOL = Number(earning.amountUSD) / solPrice;
      const existing = paymentsByWallet.get(earning.uplineWallet) || 0;
      paymentsByWallet.set(earning.uplineWallet, existing + amountSOL);
    }

    // Add transfers to transaction
    for (const [wallet, amountSOL] of paymentsByWallet.entries()) {
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(FEE_WALLET_ADDRESS),
          toPubkey: new PublicKey(wallet),
          lamports: Math.floor(amountSOL * LAMPORTS_PER_SOL)
        })
      );
    }

    // Get latest blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = new PublicKey(FEE_WALLET_ADDRESS);

    return transaction;
  },

  /**
   * Send payout batch (execute transaction)
   */
  async sendPayoutBatch(batchId: string, transactionSignature: string): Promise<void> {
    const batchRepository = AppDataSource.getRepository(PayoutBatch);
    const batch = await batchRepository.findOne({ where: { id: batchId } });

    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }

    // Update batch status
    batch.status = PayoutBatchStatus.SENT;
    batch.transactionSignature = transactionSignature;
    await batchRepository.save(batch);

    // Mark earnings as paid
    const earningRepository = AppDataSource.getRepository(ReferralEarning);
    await earningRepository.query(`
      UPDATE referral_earning
      SET paid = true,
          "paidAt" = now()
      WHERE "payoutBatchId" = $1
    `, [batchId]);

    console.log(`✅ Payout batch ${batchId} sent with transaction ${transactionSignature}`);
  },

  /**
   * Validate payout batch for anti-abuse
   */
  async validatePayoutBatch(batchId: string): Promise<{
    valid: boolean;
    warnings: string[];
    errors: string[];
  }> {
    const warnings: string[] = [];
    const errors: string[] = [];

    const batchRepository = AppDataSource.getRepository(PayoutBatch);
    const batch = await batchRepository.findOne({ where: { id: batchId } });

    if (!batch) {
      return { valid: false, warnings, errors: ['Batch not found'] };
    }

    // Get batch earnings
    const earningRepository = AppDataSource.getRepository(ReferralEarning);
    const earnings = await earningRepository.find({
      where: { payoutBatchId: batchId }
    });

    // Check for single referrer with >50% of total
    const walletTotals = new Map<string, number>();
    earnings.forEach(e => {
      const existing = walletTotals.get(e.uplineWallet) || 0;
      walletTotals.set(e.uplineWallet, existing + Number(e.amountUSD));
    });

    const maxWalletTotal = Math.max(...Array.from(walletTotals.values()));
    const maxPercentage = (maxWalletTotal / Number(batch.totalAmountUSD)) * 100;

    if (maxPercentage > 50) {
      warnings.push(`Single referrer has ${maxPercentage.toFixed(2)}% of total payout`);
    }

    // Check for unusually high amounts
    if (Number(batch.totalAmountUSD) > 10000) {
      warnings.push(`Large payout batch: $${batch.totalAmountUSD} USD`);
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors
    };
  }
}; 