import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';

// Configuration
const SOLANA_NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK || "https://api.devnet.solana.com";
const connection = new Connection(SOLANA_NETWORK);

export interface PaymentData {
  matchId: string;
  winner: string;
  loser: string;
  entryFee: number;
  escrowAddress: string;
}

export interface RefundData {
  matchId: string;
  player1: string;
  player2: string;
  entryFee: number;
  escrowAddress: string;
}

export const transferToEscrow = async (
  fromWallet: string, 
  escrowAddress: string, 
  amount: number,
  signTransaction: (transaction: Transaction) => Promise<Transaction>
) => {
  try {
    console.log('💸 Creating escrow transfer transaction:', {
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

    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = new PublicKey(fromWallet);

    // Sign and send transaction
    const signedTransaction = await signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signedTransaction.serialize());
    
    // Confirm transaction
    await connection.confirmTransaction(signature);

    console.log('✅ Escrow transfer successful:', signature);

    return {
      success: true,
      signature: signature,
      message: 'Entry fee transferred to escrow'
    };

  } catch (error) {
    console.error('❌ Error transferring to escrow:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Transfer failed' 
    };
  }
};

export const executePayout = async (
  paymentData: PaymentData,
  signTransaction: (transaction: Transaction) => Promise<Transaction>
) => {
  try {
    console.log('💰 Executing automated payout:', paymentData);

    const entryFeeLamports = paymentData.entryFee * LAMPORTS_PER_SOL;
    const winnerAmount = entryFeeLamports * 0.9; // 90% to winner
    const feeAmount = entryFeeLamports * 0.1; // 10% to fee wallet

    console.log('💰 Payout breakdown:');
    console.log('  - Winner gets:', winnerAmount / LAMPORTS_PER_SOL, 'SOL');
    console.log('  - Fee wallet gets:', feeAmount / LAMPORTS_PER_SOL, 'SOL');

    // Create payout transaction from escrow
    const payoutTransaction = new Transaction().add(
      // Transfer 90% to winner
      SystemProgram.transfer({
        fromPubkey: new PublicKey(paymentData.escrowAddress),
        toPubkey: new PublicKey(paymentData.winner),
        lamports: winnerAmount
      }),
      // Transfer 10% to fee wallet
      SystemProgram.transfer({
        fromPubkey: new PublicKey(paymentData.escrowAddress),
        toPubkey: new PublicKey("2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt"), // Fee wallet
        lamports: feeAmount
      })
    );

    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    payoutTransaction.recentBlockhash = blockhash;
    payoutTransaction.feePayer = new PublicKey(paymentData.escrowAddress);

    // Sign and send transaction
    const signedTransaction = await signTransaction(payoutTransaction);
    const signature = await connection.sendRawTransaction(signedTransaction.serialize());
    
    // Confirm transaction
    await connection.confirmTransaction(signature);

    console.log('✅ Payout transaction successful:', signature);

    return {
      success: true,
      signature: signature,
      winnerAmount: winnerAmount / LAMPORTS_PER_SOL,
      feeAmount: feeAmount / LAMPORTS_PER_SOL,
      message: 'Automated payout completed'
    };

  } catch (error) {
    console.error('❌ Error executing payout:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Payout failed' 
    };
  }
};

export const executeRefund = async (
  refundData: RefundData,
  signTransaction: (transaction: Transaction) => Promise<Transaction>
) => {
  try {
    console.log('🔄 Executing escrow refund:', refundData);

    const entryFeeLamports = refundData.entryFee * LAMPORTS_PER_SOL;

    // Create refund transaction
    const refundTransaction = new Transaction().add(
      // Refund player 1
      SystemProgram.transfer({
        fromPubkey: new PublicKey(refundData.escrowAddress),
        toPubkey: new PublicKey(refundData.player1),
        lamports: entryFeeLamports
      }),
      // Refund player 2
      SystemProgram.transfer({
        fromPubkey: new PublicKey(refundData.escrowAddress),
        toPubkey: new PublicKey(refundData.player2),
        lamports: entryFeeLamports
      })
    );

    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    refundTransaction.recentBlockhash = blockhash;
    refundTransaction.feePayer = new PublicKey(refundData.escrowAddress);

    // Sign and send transaction
    const signedTransaction = await signTransaction(refundTransaction);
    const signature = await connection.sendRawTransaction(signedTransaction.serialize());
    
    // Confirm transaction
    await connection.confirmTransaction(signature);

    console.log('✅ Refund transaction successful:', signature);

    return {
      success: true,
      signature: signature,
      refundAmount: entryFeeLamports / LAMPORTS_PER_SOL,
      message: 'Escrow refund completed'
    };

  } catch (error) {
    console.error('❌ Error executing refund:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Refund failed' 
    };
  }
}; 