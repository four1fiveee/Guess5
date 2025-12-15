import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, Connection } from '@solana/web3.js';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';

interface EscrowDepositProps {
  matchId: string;
  entryFee: number;
  onDepositComplete: (transactionId: string) => void;
  onError: (error: string) => void;
}

export const EscrowDeposit: React.FC<EscrowDepositProps> = ({
  matchId,
  entryFee,
  onDepositComplete,
  onError,
}) => {
  const { publicKey, signTransaction, connected } = useWallet();
  const [isDepositing, setIsDepositing] = useState(false);
  const [depositStatus, setDepositStatus] = useState<'pending' | 'confirming' | 'confirmed' | 'error'>('pending');
  const [transactionId, setTransactionId] = useState<string | null>(null);

  const network = (process.env.NEXT_PUBLIC_SOLANA_NETWORK as WalletAdapterNetwork) || WalletAdapterNetwork.Devnet;
  const connection = new Connection(
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 
    (network === WalletAdapterNetwork.Devnet 
      ? 'https://api.devnet.solana.com' 
      : 'https://api.mainnet-beta.solana.com'),
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
      // Get deposit transaction from backend
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/escrow/deposit-transaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          matchId,
          playerPubkey: publicKey.toString(),
          entryFee,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create deposit transaction');
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
      setDepositStatus('confirming');

      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');

      setDepositStatus('confirmed');
      onDepositComplete(signature);

      // Notify backend of deposit
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/match/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          matchId,
          wallet: publicKey.toString(),
          paymentSignature: signature,
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

  if (!connected) {
    return (
      <div className="bg-secondary bg-opacity-10 rounded-lg p-6 border border-accent">
        <p className="text-white/80">Please connect your wallet to deposit</p>
      </div>
    );
  }

  return (
    <div className="bg-secondary bg-opacity-10 rounded-lg p-6 border border-accent">
      <h3 className="text-xl font-bold text-accent mb-4">Deposit Entry Fee</h3>
      
      <div className="space-y-4">
        <div className="bg-white bg-opacity-5 rounded-lg p-4">
          <p className="text-white/90 mb-2">
            <span className="font-semibold">Entry Fee:</span> {entryFee} SOL
          </p>
          <p className="text-sm text-white/70">
            Your entry fee will be held in escrow until the match is settled.
          </p>
        </div>

        {depositStatus === 'error' && (
          <div className="bg-red-500/20 border border-red-500 rounded-lg p-3">
            <p className="text-red-400 text-sm">Deposit failed. Please try again.</p>
          </div>
        )}

        {depositStatus === 'confirmed' && transactionId && (
          <div className="bg-green-500/20 border border-green-500 rounded-lg p-3">
            <p className="text-green-400 text-sm mb-2">✅ Deposit confirmed!</p>
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
          onClick={handleDeposit}
          disabled={isDepositing || depositStatus === 'confirmed'}
          className="w-full bg-accent text-primary font-bold py-3 px-6 rounded-lg hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isDepositing
            ? depositStatus === 'confirming'
              ? 'Confirming...'
              : 'Processing...'
            : depositStatus === 'confirmed'
            ? 'Deposit Complete'
            : `Deposit ${entryFee} SOL`}
        </button>
      </div>
    </div>
  );
};

