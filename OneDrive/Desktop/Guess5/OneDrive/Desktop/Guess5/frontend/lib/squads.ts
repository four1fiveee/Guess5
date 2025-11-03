import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { instructions } from '@sqds/multisig';
import { WalletContextState } from '@solana/wallet-adapter-react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://guess5.onrender.com';

/**
 * Sign a Squads proposal transaction using wallet adapter
 * This function constructs the approval instruction manually since wallet adapters
 * don't expose Keypairs that the SDK's vaultTransactionApprove requires
 */
export async function signSquadsProposal(
  wallet: WalletContextState,
  connection: Connection,
  matchId: string,
  vaultAddress: string,
  proposalId: string
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error('Wallet not connected or does not support signing');
  }

  try {
    // Option 1: Try to get unsigned transaction from backend
    // This is the preferred approach as backend can construct it correctly
    try {
      const response = await axios.get(`${API_URL}/api/multisig/build-approval/${matchId}`, {
        params: { wallet: wallet.publicKey.toString() },
      });

      if (response.data.success && response.data.transaction) {
        // Deserialize the transaction from backend
        const transactionBuffer = Buffer.from(response.data.transaction, 'base64');
        const transaction = VersionedTransaction.deserialize(transactionBuffer);

        // Sign with wallet
        const signedTransaction = await wallet.signTransaction(transaction);

        // Send the transaction
        const signature = await connection.sendRawTransaction(
          signedTransaction.serialize(),
          { skipPreflight: false, maxRetries: 3 }
        );

        // Wait for confirmation
        await connection.confirmTransaction(signature, 'confirmed');

        return signature;
      }
    } catch (backendError: any) {
      console.warn('Backend build-approval endpoint not available, constructing locally:', backendError.message);
      // Fall through to Option 2
    }

    // Option 2: Construct the approval instruction manually
    const multisigPda = new PublicKey(vaultAddress);
    const transactionIndex = BigInt(proposalId);

    // Build the approval instruction using Squads SDK's instruction builder
    const approvalIx = instructions.vaultTransactionApprove({
      multisigPda,
      transactionIndex,
      member: wallet.publicKey,
    });

    // Build transaction message
    const { TransactionMessage } = await import('@solana/web3.js');
    const { blockhash } = await connection.getLatestBlockhash('finalized');

    const message = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [approvalIx],
    });

    const compiledMessage = message.compileToV0Message();
    const transaction = new VersionedTransaction(compiledMessage);

    // Sign the transaction with wallet adapter
    const signedTransaction = await wallet.signTransaction(transaction);

    // Send the transaction
    const signature = await connection.sendRawTransaction(
      signedTransaction.serialize(),
      { skipPreflight: false, maxRetries: 3 }
    );

    // Wait for confirmation
    await connection.confirmTransaction(signature, 'confirmed');

    return signature;
  } catch (error: any) {
    console.error('Error signing Squads proposal:', error);
    throw new Error(`Failed to sign proposal: ${error.message}`);
  }
}

