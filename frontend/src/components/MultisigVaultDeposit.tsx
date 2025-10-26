import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Connection } from '@solana/web3.js';

interface MultisigVaultDepositProps {
  matchId: string;
  vaultAddress: string;
  entryFee: number;
  onDepositComplete: (transactionId: string) => void;
  onError: (error: string) => void;
}

export const MultisigVaultDeposit: React.FC<MultisigVaultDepositProps> = ({
  matchId,
  vaultAddress,
  entryFee,
  onDepositComplete,
  onError,
}) => {
  const { publicKey, signTransaction } = useWallet();
  const [isDepositing, setIsDepositing] = useState(false);
  const [depositStatus, setDepositStatus] = useState<'pending' | 'confirming' | 'confirmed' | 'error'>('pending');
  const [transactionId, setTransactionId] = useState<string | null>(null);

  const connection = new Connection(
    process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'https://api.devnet.solana.com',
    'confirmed'
  );

  const handleDeposit = async () => {
    if (!publicKey || !signTransaction) {
      onError('Wallet not connected');
      return;
    }

    setIsDepositing(true);
    setDepositStatus('pending');

    try {
      // Convert entry fee to lamports
      const lamports = Math.floor(entryFee * LAMPORTS_PER_SOL);

      // Create transaction to send SOL to vault
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(vaultAddress),
          lamports,
        })
      );

      // Get recent blockhash
      const { blockhash } = await connection.getRecentBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Sign transaction
      const signedTransaction = await signTransaction(transaction);

      // Send transaction
      const signature = await connection.sendRawTransaction(signedTransaction.serialize());
      setTransactionId(signature);
      setDepositStatus('confirming');

      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');

      setDepositStatus('confirmed');
      onDepositComplete(signature);

      // Notify backend of deposit with transaction signature for proper attribution
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/multisig/deposits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          matchId,
          playerWallet: publicKey.toString(),
          amount: entryFee,
          depositTxSignature: signature, // Use depositTxSignature for consistency with backend
        }),
      });

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setDepositStatus('error');
      onError(`Deposit failed: ${errorMessage}`);
    } finally {
      setIsDepositing(false);
    }
  };

  return (
    <div className="bg-secondary bg-opacity-10 rounded-lg p-6 border border-accent">
      <h3 className="text-xl font-bold text-accent mb-4">Deposit to Vault</h3>
      
      <div className="space-y-4">
        <div className="bg-white bg-opacity-5 rounded-lg p-4">
          <p className="text-sm text-white/80 mb-2">Vault Address:</p>
          <p className="text-xs font-mono text-accent break-all">{vaultAddress}</p>
        </div>

        <div className="bg-white bg-opacity-5 rounded-lg p-4">
          <p className="text-sm text-white/80 mb-2">Entry Fee:</p>
          <p className="text-lg font-bold text-accent">{entryFee} SOL</p>
        </div>

        <div className="bg-white bg-opacity-5 rounded-lg p-4">
          <p className="text-sm text-white/80 mb-2">Status:</p>
          <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${
              depositStatus === 'pending' ? 'bg-yellow-500' :
              depositStatus === 'confirming' ? 'bg-blue-500' :
              depositStatus === 'confirmed' ? 'bg-green-500' :
              'bg-red-500'
            }`} />
            <span className="text-sm text-white">
              {depositStatus === 'pending' ? 'Ready to deposit' :
               depositStatus === 'confirming' ? 'Confirming...' :
               depositStatus === 'confirmed' ? 'Confirmed' :
               'Error'}
            </span>
          </div>
        </div>

        {transactionId && (
          <div className="bg-white bg-opacity-5 rounded-lg p-4">
            <p className="text-sm text-white/80 mb-2">Transaction ID:</p>
            <p className="text-xs font-mono text-accent break-all">{transactionId}</p>
            <a
              href={`https://explorer.solana.com/tx/${transactionId}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-yellow-400 text-sm underline"
            >
              View on Solana Explorer
            </a>
          </div>
        )}

        <button
          onClick={handleDeposit}
          disabled={isDepositing || depositStatus === 'confirmed'}
          className={`w-full py-3 px-4 rounded-lg font-bold transition-colors ${
            isDepositing || depositStatus === 'confirmed'
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
              : 'bg-accent text-primary hover:bg-yellow-400'
          }`}
        >
          {isDepositing ? 'Processing...' : 
           depositStatus === 'confirmed' ? 'Deposit Confirmed' :
           'Deposit to Vault'}
        </button>
      </div>
    </div>
  );
};
