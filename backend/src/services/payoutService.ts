import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import { FEE_WALLET_ADDRESS } from '../config/wallet';

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
  } catch (error) {
    console.error('❌ Error creating escrow account:', error);
    return { success: false, error: error.message };
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
  } catch (error) {
    console.error('❌ Error creating escrow transaction:', error);
    return { success: false, error: error.message };
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

    const entryFeeLamports = matchData.entryFee * LAMPORTS_PER_SOL;
    const winnerAmount = entryFeeLamports * 0.9; // 90% to winner
    const feeAmount = entryFeeLamports * 0.1; // 10% to fee wallet

    console.log('💰 Payout breakdown:');
    console.log('  - Winner gets:', winnerAmount / LAMPORTS_PER_SOL, 'SOL');
    console.log('  - Fee wallet gets:', feeAmount / LAMPORTS_PER_SOL, 'SOL');

    // Create payout transaction from escrow
    const payoutTransaction = new Transaction().add(
      // Transfer 90% to winner
      SystemProgram.transfer({
        fromPubkey: new PublicKey(matchData.escrowAddress),
        toPubkey: new PublicKey(matchData.winner),
        lamports: winnerAmount
      }),
      // Transfer 10% to fee wallet
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

  } catch (error) {
    console.error('❌ Error creating payout transaction:', error);
    return { success: false, error: error.message };
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

  } catch (error) {
    console.error('❌ Error creating refund transaction:', error);
    return { success: false, error: error.message };
  }
}; 