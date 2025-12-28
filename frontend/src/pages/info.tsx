import { TopRightWallet } from '../components/WalletConnect';
import { WalletSetupGuide } from '../components/WalletSetupGuide';
import Link from 'next/link';

export default function Info() {
  return (
    <div className="flex flex-col items-center min-h-screen bg-primary px-6 py-12 relative">
      <TopRightWallet />
      <div className="flex flex-col items-center max-w-4xl w-full">
        
        {/* Header */}
        <div className="w-full mb-8">
          <Link href="/">
            <button className="bg-accent text-primary text-xs sm:text-sm font-bold px-4 py-2.5 sm:py-3 rounded-lg shadow hover:bg-yellow-400 hover:shadow-lg transition-all duration-200 min-h-[44px] flex items-center justify-center">
              ← Back to Home
            </button>
          </Link>
        </div>

        <h1 className="text-4xl font-bold text-accent mb-8 text-center">Rules & Information</h1>

        {/* Game Rules */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-6 max-w-4xl w-full text-accent shadow mb-6">
          <h2 className="text-2xl font-bold text-accent mb-4">Complete Game Rules</h2>
          
          <h3 className="text-xl font-bold text-accent mb-3 mt-4">How to Play</h3>
          <ol className="list-decimal list-inside text-sm text-white/90 space-y-2">
            <li><b>Connect your Solana wallet</b> using the wallet button in the top right</li>
            <li><b>Choose a lobby:</b> Select $5, $20, $50, or $100 entry fee (paid in SOL at current market rate)</li>
            <li><b>Get matched:</b> Wait for another player to join the same lobby</li>
            <li><b>Deposit funds:</b> Send your entry fee to the secure multisig vault address</li>
            <li><b>Play the game:</b> You have up to 7 tries to guess a secret 5-letter word</li>
            <li><b>Receive hints:</b> After each guess, letters are color-coded:
              <ul className="list-disc list-inside ml-6 mt-1">
                <li><span className="text-green-400">Green</span> = Correct letter in correct position</li>
                <li><span className="text-yellow-400">Yellow</span> = Correct letter in wrong position</li>
                <li><span className="text-gray-400">Gray</span> = Letter not in the word</li>
              </ul>
            </li>
            <li><b>Win conditions:</b> Fewest guesses wins. If tied on guesses, fastest completion time wins</li>
          </ol>

          <h3 className="text-xl font-bold text-accent mb-3 mt-6">Winning & Payouts</h3>
          <ul className="list-disc list-inside text-sm text-white/90 space-y-2">
            <li><b>Winner receives 95%</b> of the total pot (both entry fees)</li>
            <li><b>Platform fee: 5%</b> covers transaction costs and platform maintenance</li>
            <li><b>You must sign to claim:</b> Winners receive a payout proposal that requires your wallet signature. Funds remain safely locked in the multisig vault until you sign.</li>
          </ul>

          <h3 className="text-xl font-bold text-accent mb-3 mt-6">Tie Scenarios</h3>
          <ul className="list-disc list-inside text-sm text-white/90 space-y-2">
            <li><b>Winning Tie:</b> Both players solve in same number of moves AND exact same time → 
              <span className="text-green-400 font-bold"> Full refund to both players (100%)</span>
            </li>
            <li><b>Losing Tie:</b> Both players fail to solve the word → 
              <span className="text-yellow-400 font-bold"> 95% refunded to both players (5% fee kept)</span>
            </li>
            <li><b>Disconnect:</b> If opponent disconnects:
              <ul className="list-disc list-inside ml-6 mt-1">
                <li>If you solved the word: You win</li>
                <li>If you didn't solve: Losing tie (95% refund)</li>
              </ul>
            </li>
            <li><b>Payment Timeout:</b> If the other player doesn't pay within 2 minutes → 
              <span className="text-green-400 font-bold"> Refund proposal created automatically. You can sign it from the lobby page to get your funds back.</span>
            </li>
            <li><b>Game Timeout:</b> If game doesn't start within 2 minutes after both deposits → 
              <span className="text-green-400 font-bold"> Full refund proposal created for both players (100%)</span>
            </li>
          </ul>
        </div>

        {/* Security & Non-Custodial Explanation */}
        <div className="bg-green-900 bg-opacity-20 border border-green-400 rounded-lg p-6 max-w-4xl w-full shadow mb-6">
          <h2 className="text-2xl font-bold text-green-400 mb-4">🔒 Non-Custodial Security System</h2>
          
          <p className="text-sm text-white/90 mb-4">
            Guess5 uses <b>on-chain escrow smart contracts</b>, audited and deployed on Solana, to ensure 
            we <u>never have custody</u> of your funds.
          </p>

          <h3 className="text-lg font-bold text-green-400 mb-3">How the Escrow System Works:</h3>
          <div className="text-sm text-white/90 space-y-3">
            <div className="bg-black bg-opacity-30 rounded p-3">
              <b className="text-green-400">Step 1: Match Creation</b>
              <p className="mt-1">When you're matched with an opponent, the system creates a secure escrow account on Solana blockchain that will hold both players' entry fees.</p>
            </div>

            <div className="bg-black bg-opacity-30 rounded p-3">
              <b className="text-green-400">Step 2: You Deposit Funds</b>
              <p className="mt-1">You send your entry fee directly to the escrow account address. The funds are locked in the escrow smart contract until the game completes or times out.</p>
            </div>

            <div className="bg-black bg-opacity-30 rounded p-3">
              <b className="text-green-400">Step 3: Game Completes</b>
              <p className="mt-1">After the game ends, the backend determines the result and creates a cryptographically signed result:</p>
              <ul className="list-disc list-inside ml-4 mt-2">
                <li><b>If you win:</b> Escrow will send 95% to you, 5% to platform</li>
                <li><b>If it's a tie:</b> Escrow will refund both players appropriately</li>
              </ul>
              <p className="mt-2">The backend <b>signs the result</b> with its private key. This signature is verified on-chain to ensure the result is authentic.</p>
            </div>

            <div className="bg-black bg-opacity-30 rounded p-3">
              <b className="text-green-400">Step 4: You Sign to Settle</b>
              <p className="mt-1">To claim your winnings, <b>you must sign the settlement transaction with your wallet</b>. This submits the backend-signed result to the escrow smart contract, which verifies the signature and automatically distributes funds according to the game result.</p>
              <p className="mt-2 text-green-400">✓ This means we <b>cannot</b> withdraw your funds without your explicit consent</p>
            </div>

            <div className="bg-black bg-opacity-30 rounded p-3">
              <b className="text-red-400">What if the loser refuses to sign?</b>
              <p className="mt-1">The losing player doesn't need to sign! Once the winner signs the settlement transaction with the valid backend signature, the escrow smart contract automatically executes the payout.</p>
            </div>

            <div className="bg-black bg-opacity-30 rounded p-3">
              <b className="text-red-400">What if no one signs after timeout?</b>
              <p className="mt-1">After the timeout period (typically 10 minutes), either player can call the settlement function to trigger automatic refunds. Funds remain safely locked in the escrow smart contract until settlement is executed.</p>
            </div>
          </div>

          <div className="mt-4 bg-black bg-opacity-30 rounded p-4">
            <p className="text-green-400 font-bold mb-2">Why This Matters:</p>
            <ul className="text-sm text-white/90 space-y-1">
              <li>✓ <b>You're always in control</b> - We can't steal or freeze your funds</li>
              <li>✓ <b>Transparent</b> - All transactions are on Solana blockchain</li>
              <li>✓ <b>Audited</b> - Our escrow smart contract is open-source and verifiable</li>
              <li>✓ <b>No trust required</b> - Smart contracts enforce the rules</li>
            </ul>
          </div>
        </div>

        {/* FAQ */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-6 max-w-4xl w-full text-accent shadow mb-6">
          <h2 className="text-2xl font-bold text-accent mb-4">Frequently Asked Questions</h2>
          
          <div className="space-y-4 text-sm text-white/90">
            <div>
              <b className="text-accent text-base">Q: What happens if the other player doesn't pay or disconnects during matchmaking?</b>
              <p className="mt-1">If the other player doesn't complete payment within 2 minutes, the match is automatically cancelled. 
              If you already paid, a refund proposal will be created within 2 minutes. You can sign the refund proposal from the lobby page 
              to get your funds back. The refund proposal will appear in your pending refunds section.</p>
            </div>

            <div>
              <b className="text-accent text-base">Q: What happens if I disconnect during a game?</b>
              <p className="mt-1">If you disconnect, you can return within 5 minutes by refreshing the page. Your progress is saved. 
              If you don't return, the opponent wins if they solved the word, otherwise it's a losing tie.</p>
            </div>

                         <div>
               <b className="text-accent text-base">Q: How long do I have to sign a winning payout?</b>
               <p className="mt-1">Your funds remain safely locked in the escrow smart contract until you sign. After the timeout period, 
               either player can trigger settlement to recover their funds automatically.</p>
             </div>

            <div>
              <b className="text-accent text-base">Q: Can Guess5 steal my money?</b>
              <p className="mt-1">No. Due to the escrow smart contract design, we cannot access funds alone—we need at least one player signature to settle. 
              Funds can only move after games complete or timeouts, and only when a player signs to approve the settlement transaction. Even if we wanted to steal funds, the smart contract enforces these rules on-chain.</p>
            </div>

            <div>
              <b className="text-accent text-base">Q: What if my opponent refuses to sign the payout?</b>
              <p className="mt-1">The losing player doesn't need to sign. Once the winner signs the settlement transaction with a valid backend signature, 
              the escrow smart contract automatically executes the payout.</p>
            </div>

            <div>
              <b className="text-accent text-base">Q: Why do you charge a 5% fee?</b>
              <p className="mt-1">The 5% fee covers Solana transaction costs (creating vaults, proposals, signatures) and 
              platform maintenance costs (servers, development, support).</p>
            </div>

            <div>
              <b className="text-accent text-base">Q: Is my deposit instant?</b>
              <p className="mt-1">Solana transactions are very fast, typically 1-3 seconds. Once confirmed on the blockchain, 
              your deposit is verified and the game can start.</p>
            </div>

            <div>
              <b className="text-accent text-base">Q: Can I play on mobile?</b>
              <p className="mt-1">Yes! Guess5 works on mobile browsers with Solana wallet mobile apps (Phantom, Solflare, Backpack, Glow). Connect your wallet 
              through your wallet app and play directly in your mobile browser.</p>
            </div>

            <div>
              <b className="text-accent text-base">Q: How does the escrow system work?</b>
              <p className="mt-1">Guess5 uses a custom-built escrow smart contract on Solana. When you deposit funds, they're held in a program-controlled account (PDA) that only releases funds based on verified game results. The smart contract verifies backend signatures to ensure results are authentic, and requires player signatures to execute settlements. This ensures we never have custody of your funds.</p>
            </div>

            <div>
              <b className="text-accent text-base">Q: Why might my entry fee differ slightly from another player's?</b>
              <p className="mt-1">SOL prices fluctuate in real-time, so the SOL amount needed for a $5, $20, $50, or $100 entry fee 
              changes constantly. Our matchmaking system allows players to be matched if their entry fees are within 3% of each other. 
              This ensures fair matching even when SOL prices move slightly between when you enter the queue and when you're matched. 
              Both players will pay the same amount (the lower of the two entry fees) to ensure fairness.</p>
            </div>
          </div>
        </div>

        {/* Wallet Setup Guide */}
        <div className="mt-8 w-full">
          <WalletSetupGuide />
        </div>

        {/* Transparency & Data Download */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-6 max-w-4xl w-full text-accent shadow mb-6">
          <h2 className="text-2xl font-bold text-accent mb-4">Complete Transparency</h2>
          <p className="text-sm text-white/90 mb-4">
            Every match, transaction, and fee is publicly verifiable on the Solana blockchain.
          </p>
          
          <div className="text-sm text-white/90 space-y-3 mb-6">
            <div className="flex items-start space-x-3">
              <span className="text-green-400 font-bold">✓</span>
              <span><b>Blockchain Verified:</b> All transactions are permanently recorded on Solana's public blockchain</span>
            </div>
            <div className="flex items-start space-x-3">
              <span className="text-green-400 font-bold">✓</span>
              <span><b>Real-Time Data:</b> Access complete match history with actual blockchain fees and timestamps</span>
            </div>
            <div className="flex items-start space-x-3">
              <span className="text-green-400 font-bold">✓</span>
              <span><b>Click to Verify:</b> Every transaction includes direct links to Solana Explorer for instant verification</span>
            </div>
            <div className="flex items-start space-x-3">
              <span className="text-green-400 font-bold">✓</span>
              <span><b>Fair Play Guaranteed:</b> All game outcomes, moves, and completion times are publicly auditable</span>
            </div>
          </div>

          <div className="text-center">
          </div>
        </div>

        {/* Social Links */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-6 max-w-4xl w-full text-accent shadow mb-6">
          <h2 className="text-2xl font-bold text-accent mb-4">Connect With Us</h2>
          <div className="flex gap-4 justify-center items-center flex-wrap">
            <a
              href="https://discord.gg/CcXWUv7r"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-6 py-3 rounded-lg shadow border border-indigo-500/30 hover:border-indigo-400/50 transition-all duration-200 min-h-[44px] flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C2.4 6.314 1.896 8.2 1.712 10.102a.082.082 0 0 0 .031.074a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.074c-.236-2.001-.793-3.887-1.932-5.704a.061.061 0 0 0-.031-.03z"/>
              </svg>
              <span>Join Our Discord</span>
            </a>
            <a
              href="https://instagram.com/Guess5.io"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white text-sm font-medium px-6 py-3 rounded-lg shadow border border-purple-500/30 hover:border-purple-400/50 transition-all duration-200 min-h-[44px] flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
              </svg>
              <span>Follow @Guess5.io</span>
            </a>
          </div>
          <p className="text-sm text-white/70 text-center mt-4">
            Join our community for updates, tips, and support!
          </p>
        </div>

        {/* Back to Home */}
        <div className="w-full text-center mt-8">
          <Link href="/">
            <button className="bg-accent text-primary text-base sm:text-lg font-bold px-8 py-4 rounded-lg shadow-lg hover:bg-yellow-400 hover:shadow-xl transition-all duration-200 transform hover:scale-105 active:scale-95 min-h-[52px] flex items-center justify-center">
              Ready to Play? Start Now →
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}

