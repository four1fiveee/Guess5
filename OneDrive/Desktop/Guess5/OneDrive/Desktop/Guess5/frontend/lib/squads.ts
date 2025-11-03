import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { rpc } from '@sqds/multisig';
import { WalletContextState } from '@solana/wallet-adapter-react';

/**
 * Sign a Squads proposal transaction using wallet adapter
 */
export async function signSquadsProposal(
  wallet: WalletContextState,
  connection: Connection,
  vaultAddress: string,
  proposalId: string
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error('Wallet not connected or does not support signing');
  }

  const multisigPda = new PublicKey(vaultAddress);
  const transactionIndex = BigInt(proposalId);

  // Create approval transaction using Squads SDK
  // vaultTransactionApprove returns a transaction that needs to be signed
  const transaction = await rpc.vaultTransactionApprove({
    connection,
    feePayer: wallet.publicKey,
    multisigPda,
    transactionIndex,
    member: wallet.publicKey,
  });

  // Sign the transaction with wallet adapter
  // The transaction might be VersionedTransaction or Transaction
  let signedTransaction;
  if (transaction instanceof VersionedTransaction) {
    signedTransaction = await wallet.signTransaction(transaction);
  } else {
    // For regular Transaction, use signTransaction
    signedTransaction = await wallet.signTransaction(transaction as any);
  }
  
  // Send the transaction
  const signature = await connection.sendRawTransaction(
    signedTransaction.serialize(),
    { skipPreflight: false, maxRetries: 3 }
  );
  
  // Wait for confirmation
  await connection.confirmTransaction(signature, 'confirmed');

  return signature;
}

