import React, { useState } from 'react';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';

interface PaymentTransaction {
  from: string;
  to: string;
  amount: number;
  description: string;
  instruction?: string;
  transaction?: string;
}

interface PayoutInstructionsProps {
  winner?: string;
  winnerAmount: number;
  feeAmount: number;
  feeWallet: string;
  transactions: PaymentTransaction[];
  playerWallet: string;
  automatedPayout?: boolean;
  payoutSignature?: string;
  smartContract?: boolean;
  matchPda?: string;
  vaultPda?: string;
}

interface CompletedTransaction {
  signature: string;
  amount: number;
  to: string;
  description: string;
}

const PayoutInstructions: React.FC<PayoutInstructionsProps> = ({
  winner,
  winnerAmount,
  feeAmount,
  feeWallet,
  transactions,
  playerWallet,
  automatedPayout = false,
  payoutSignature,
  smartContract = false,
  matchPda,
  vaultPda
}) => {
  const { publicKey, sendTransaction } = useWallet();
  const [sendingTx, setSendingTx] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<{[key: string]: 'pending' | 'success' | 'error'}>({});
  const [completedTxs, setCompletedTxs] = useState<CompletedTransaction[]>([]);

  // Get USD conversion info from localStorage
  const entryFeeUSD = Number(localStorage.getItem('entryFeeUSD') || '0');
  const entryFeeSOL = Number(localStorage.getItem('entryFeeSOL') || '0');
  const solPrice = entryFeeSOL > 0 ? entryFeeUSD / entryFeeSOL : null;

  // Calculate USD values for payouts
  const winnerAmountUSD = solPrice ? winnerAmount * solPrice : null;
  const feeAmountUSD = solPrice ? feeAmount * solPrice : null;

  const isWinner = winner === playerWallet;
  const isLoser = winner && winner !== playerWallet;
  const isTie = !winner;

  const sendPayment = async (to: string, amount: number, txIndex: number) => {
    if (!publicKey || !sendTransaction) {
      alert('Please connect your wallet first!');
      return;
    }

    try {
      setSendingTx(`tx-${txIndex}`);
      setTxStatus(prev => ({ ...prev, [`tx-${txIndex}`]: 'pending' }));

      // Create connection to devnet
      const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
      
      let transaction: Transaction;
      
      // Check if this is a smart contract transaction
      const txData = transactions[txIndex];
      if (smartContract && txData.instruction === 'submitResult' && txData.transaction) {
        // Deserialize smart contract transaction
        const transactionBuffer = Buffer.from(txData.transaction, 'base64');
        transaction = Transaction.from(transactionBuffer);
        
        // Update the transaction to use the current user's public key
        transaction.feePayer = publicKey;
        
        // Get recent blockhash
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        
        console.log('🔗 Sending smart contract submit result transaction');
      } else {
        // Legacy transaction
        transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: new PublicKey(to),
            lamports: Math.floor(amount * LAMPORTS_PER_SOL),
          })
        );

        // Get recent blockhash
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;
        
        console.log('💰 Sending legacy payment transaction');
      }

      // Send transaction
      const signature = await sendTransaction(transaction, connection);
      
      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      
      if (confirmation.value.err) {
        throw new Error('Transaction failed');
      }

      setTxStatus(prev => ({ ...prev, [`tx-${txIndex}`]: 'success' }));
      
      // Add to completed transactions
      const completedTx: CompletedTransaction = {
        signature,
        amount,
        to,
        description: transactions[txIndex].description
      };
      setCompletedTxs(prev => [...prev, completedTx]);
      
      console.log(`✅ ${smartContract ? 'Smart contract' : 'Payment'} transaction sent: ${signature}`);
      
    } catch (error) {
      console.error('❌ Transaction error:', error);
      setTxStatus(prev => ({ ...prev, [`tx-${txIndex}`]: 'error' }));
      alert(`Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSendingTx(null);
    }
  };

  const getButtonText = (txIndex: number) => {
    const status = txStatus[`tx-${txIndex}`];
    if (sendingTx === `tx-${txIndex}`) return 'Sending...';
    if (status === 'success') return '✅ Sent';
    if (status === 'error') return '❌ Failed';
    return 'Send Payment';
  };

  const getButtonClass = (txIndex: number) => {
    const status = txStatus[`tx-${txIndex}`];
    if (status === 'success') return 'bg-green-500 hover:bg-green-600';
    if (status === 'error') return 'bg-red-500 hover:bg-red-600';
    if (sendingTx === `tx-${txIndex}`) return 'bg-gray-500 cursor-not-allowed';
    return 'bg-orange-500 hover:bg-orange-600';
  };

  const openExplorer = (signature: string) => {
    window.open(`https://explorer.solana.com/tx/${signature}?cluster=devnet`, '_blank');
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        🎉 Game Complete!
      </h2>

      {/* Winner/Loser/Tie Display */}
      <div className="mb-6">
        {isWinner && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
            <h3 className="font-bold">🏆 You Won!</h3>
            <p>
              You will receive <span className="text-lg font-bold">{winnerAmountUSD ? `$${winnerAmountUSD.toFixed(2)}` : ''}</span>
              <span className="text-gray-600"> ({winnerAmount.toFixed(4)} SOL)</span> from the loser
            </p>
          </div>
        )}
        {isLoser && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            <h3 className="font-bold">😔 You Lost</h3>
            <p>
              You need to send <span className="text-lg font-bold">{winnerAmountUSD ? `$${winnerAmountUSD.toFixed(2)}` : ''}</span>
              <span className="text-gray-600"> ({winnerAmount.toFixed(4)} SOL)</span> to the winner
            </p>
          </div>
        )}
        {isTie && (
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
            <h3 className="font-bold">🤝 It's a Tie!</h3>
            <p>Both players receive a full refund of their entry fee</p>
            <p className="text-sm mt-1">No additional payments required</p>
          </div>
        )}
      </div>

      {/* Automated Payout Status */}
      {automatedPayout && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-6">
          <h3 className="font-bold">🤖 Automated Payout Completed!</h3>
          <p>Your winnings have been automatically sent to your wallet.</p>
          {payoutSignature && (
            <div className="mt-2">
              <p className="text-sm">Transaction: {payoutSignature.slice(0, 8)}...{payoutSignature.slice(-8)}</p>
              <button
                onClick={() => openExplorer(payoutSignature)}
                className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-xs mt-1"
              >
                View on Explorer
              </button>
            </div>
          )}
        </div>
      )}

      {/* Manual Payment Instructions (only show if not automated) */}
      {!automatedPayout && (
        <>
          {/* Fee Information */}
          <div className="bg-accent/10 border border-accent/20 text-accent px-4 py-3 rounded mb-6">
            <h3 className="font-bold">💰 Fee Information</h3>
            <p>Fee wallet: {feeWallet}</p>
            <p>
              Total fee: <span className="font-bold">{feeAmountUSD ? `$${feeAmountUSD.toFixed(2)}` : ''}</span>
              <span className="text-gray-600"> ({feeAmount.toFixed(4)} SOL)</span>
            </p>
          </div>

          {/* Required Transactions */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-3">
              📋 Required Transactions
            </h3>
            {transactions.map((tx, index) => {
              const isYourTransaction = tx.from === playerWallet;
              const txUSD = solPrice ? tx.amount * solPrice : null;
              return (
                <div 
                  key={index} 
                  className={`border rounded-lg p-4 mb-3 ${
                    isYourTransaction 
                      ? 'border-orange-300 bg-orange-50' 
                      : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-medium text-gray-800">
                        {isYourTransaction ? '🔴 You need to send:' : '🟢 You will receive:'}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">{tx.description}</p>
                      <div className="mt-2 text-sm">
                        <p><span className="font-medium">From:</span> {tx.from}</p>
                        <p><span className="font-medium">To:</span> {tx.to}</p>
                        <p>
                          <span className="font-medium">Amount:</span> 
                          <span className="font-bold">{txUSD ? `$${txUSD.toFixed(2)}` : ''}</span>
                          <span className="text-gray-600"> ({tx.amount.toFixed(4)} SOL)</span>
                        </p>
                      </div>
                    </div>
                    {isYourTransaction && (
                      <div className="ml-4">
                        <button 
                          className={`${getButtonClass(index)} text-white px-4 py-2 rounded text-sm transition-colors`}
                          onClick={() => sendPayment(tx.to, tx.amount, index)}
                          disabled={sendingTx === `tx-${index}` || txStatus[`tx-${index}`] === 'success'}
                        >
                          {getButtonText(index)}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Completed Transactions */}
          {completedTxs.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-700 mb-3">
                ✅ Completed Transactions
              </h3>
              {completedTxs.map((tx, index) => (
                <div key={index} className="bg-green-50 border border-green-200 rounded-lg p-3 mb-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-medium text-green-800">{tx.description}</p>
                      <p className="text-sm text-green-600">
                        {tx.amount.toFixed(4)} SOL → {tx.to.slice(0, 4)}...{tx.to.slice(-4)}
                      </p>
                    </div>
                    <button
                      onClick={() => openExplorer(tx.signature)}
                      className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-xs"
                    >
                      View on Explorer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

                {/* Show automated payout message if enabled */}
      {automatedPayout && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
          <div className="text-center">
            <div className="text-green-600 text-lg font-semibold mb-2">
              ✅ Automated Payout Completed
            </div>
            <p className="text-green-700 text-sm">
              All payments have been processed automatically by the fee wallet.
            </p>
            {payoutSignature && (
              <div className="mt-3">
                <a 
                  href={`https://explorer.solana.com/tx/${payoutSignature}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 text-sm underline"
                >
                  View Transaction on Explorer
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Only show manual instructions if automated payout is disabled */}
      {!automatedPayout && (
        <>
          {/* Instructions */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
            <h3 className="font-semibold text-gray-700 mb-2">📝 How to Complete Payments</h3>
            <ol className="list-decimal list-inside text-sm text-gray-600 space-y-1">
              <li>All payments are made in SOL, but amounts are shown in USD for clarity (conversion rate is based on the time you matched with your opponent).</li>
              <li>Make sure your Phantom wallet is connected</li>
              <li>Click "Send Payment" for each transaction you need to make</li>
              <li>Confirm the transaction in your Phantom wallet</li>
              <li>Wait for transaction confirmation on devnet</li>
              <li>Both players must complete their payments for the game to be fully settled</li>
            </ol>
          </div>

          {/* Warning */}
          <div className="mt-6 bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
            <p className="text-sm">
              ⚠️ <strong>Important:</strong> Make sure you have enough SOL in your wallet to cover the payments. 
              The game results are final once both players have submitted their results.
            </p>
          </div>
        </>
      )}
        </>
      )}
    </div>
  );
};

export default PayoutInstructions; 