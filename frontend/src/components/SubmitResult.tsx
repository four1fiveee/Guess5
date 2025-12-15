import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Transaction, Connection } from '@solana/web3.js';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';

interface SubmitResultProps {
  matchId: string;
  winner: string | null;
  resultType: 'Win' | 'DrawFullRefund' | 'DrawPartialRefund';
  onResultSubmitted: (transactionId: string) => void;
  onError: (error: string) => void;
}

export const SubmitResult: React.FC<SubmitResultProps> = ({
  matchId,
  winner,
  resultType,
  onResultSubmitted,
  onError,
}) => {
  const { publicKey, signTransaction, connected } = useWallet();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<'pending' | 'confirming' | 'confirmed' | 'error'>('pending');
  const [transactionId, setTransactionId] = useState<string | null>(null);

  const network = (process.env.NEXT_PUBLIC_SOLANA_NETWORK as WalletAdapterNetwork) || WalletAdapterNetwork.Devnet;
  const connection = new Connection(
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 
    (network === WalletAdapterNetwork.Devnet 
      ? 'https://api.devnet.solana.com' 
      : 'https://api.mainnet-beta.solana.com'),
    'confirmed'
  );

  const handleSubmit = async () => {
    if (!publicKey || !signTransaction) {
      onError('Wallet not connected');
      return;
    }

    setIsSubmitting(true);
    setStatus('pending');

    try {
      // Get submit result transaction from backend
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/escrow/submit-result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          matchId,
          playerPubkey: publicKey.toString(),
          winner,
          resultType,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create submit result transaction');
      }

      const { transaction: transactionBase64 } = await response.json();
      const transaction = Transaction.from(Buffer.from(transactionBase64, 'base64'));

      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Sign transaction
      const signedTransaction = await signTransaction(transaction);

      // Send transaction
      const signature = await connection.sendRawTransaction(signedTransaction.serialize());
      setTransactionId(signature);
      setStatus('confirming');

      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');

      setStatus('confirmed');
      onResultSubmitted(signature);

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setStatus('error');
      onError(`Submit result failed: ${errorMessage}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!connected) {
    return (
      <div className="bg-secondary bg-opacity-10 rounded-lg p-6 border border-accent">
        <p className="text-white/80">Please connect your wallet to confirm the result</p>
      </div>
    );
  }

  const resultTypeText = {
    Win: winner ? `Winner: ${winner.substring(0, 4)}...${winner.substring(winner.length - 4)}` : 'Winner',
    DrawFullRefund: 'Tie - Full Refund',
    DrawPartialRefund: 'Tie - Partial Refund',
  }[resultType];

  return (
    <div className="bg-secondary bg-opacity-10 rounded-lg p-6 border border-accent">
      <h3 className="text-xl font-bold text-accent mb-4">Confirm Game Result</h3>
      
      <div className="space-y-4">
        <div className="bg-white bg-opacity-5 rounded-lg p-4">
          <p className="text-white/90 mb-2">
            <span className="font-semibold">Result:</span> {resultTypeText}
          </p>
          <p className="text-sm text-white/70">
            Please confirm this result to proceed with settlement. You must sign with your wallet.
          </p>
        </div>

        {status === 'error' && (
          <div className="bg-red-500/20 border border-red-500 rounded-lg p-3">
            <p className="text-red-400 text-sm">Failed to submit result. Please try again.</p>
          </div>
        )}

        {status === 'confirmed' && transactionId && (
          <div className="bg-green-500/20 border border-green-500 rounded-lg p-3">
            <p className="text-green-400 text-sm mb-2">✅ Result confirmed!</p>
            <a
              href={`https://solscan.io/tx/${transactionId}?cluster=${network === WalletAdapterNetwork.Devnet ? 'devnet' : 'mainnet'}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline text-sm"
            >
              View on Solscan
            </a>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={isSubmitting || status === 'confirmed'}
          className="w-full bg-accent text-primary font-bold py-3 px-6 rounded-lg hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting
            ? status === 'confirming'
              ? 'Confirming...'
              : 'Processing...'
            : status === 'confirmed'
            ? 'Result Confirmed'
            : 'Confirm Result'}
        </button>
      </div>
    </div>
  );
};

