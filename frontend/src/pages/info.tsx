import { TopRightWallet } from '../components/WalletConnect';
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
          <h2 className="text-2xl font-bold text-accent mb-4">📋 Complete Game Rules</h2>
          
          <h3 className="text-xl font-bold text-accent mb-3 mt-4">How to Play</h3>
          <ol className="list-decimal list-inside text-sm text-white/90 space-y-2">
            <li><b>Connect your Phantom wallet</b> using the wallet button in the top right</li>
            <li><b>Choose a lobby:</b> Select $5, $10, $25, or $100 entry fee (paid in SOL at current market rate)</li>
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
            <li><b>Game Timeout:</b> If game doesn't start within 10 minutes after both deposits → 
              <span className="text-green-400 font-bold"> Full refund proposal created for both players (100%)</span>
            </li>
          </ul>
        </div>

        {/* Security & Non-Custodial Explanation */}
        <div className="bg-green-900 bg-opacity-20 border border-green-400 rounded-lg p-6 max-w-4xl w-full shadow mb-6">
          <h2 className="text-2xl font-bold text-green-400 mb-4">🔒 Non-Custodial Security System</h2>
          
          <p className="text-sm text-white/90 mb-4">
            Guess5 uses <b>Squads Protocol</b>, an audited multisig wallet system on Solana, to ensure 
            we <u>never have custody</u> of your funds.
          </p>

          <h3 className="text-lg font-bold text-green-400 mb-3">How the 2-of-3 Multisig Works:</h3>
          <div className="text-sm text-white/90 space-y-3">
            <div className="bg-black bg-opacity-30 rounded p-3">
              <b className="text-green-400">Step 1: Match Creation</b>
              <p className="mt-1">When you're matched with an opponent, the system creates a secure Squads vault with 3 signers:</p>
              <ul className="list-disc list-inside ml-4 mt-2">
                <li><b>You</b> (Player 1)</li>
                <li><b>Your Opponent</b> (Player 2)</li>
                <li><b>Guess5 Platform</b> (System)</li>
              </ul>
              <p className="mt-2 text-yellow-400">⚠️ Any transaction requires <b>2 out of 3 signatures</b> to execute</p>
            </div>

            <div className="bg-black bg-opacity-30 rounded p-3">
              <b className="text-green-400">Step 2: You Deposit Funds</b>
              <p className="mt-1">You send your entry fee directly to the Squads vault address. The funds are locked in the vault until 
              2 of the 3 parties agree to release them.</p>
            </div>

            <div className="bg-black bg-opacity-30 rounded p-3">
              <b className="text-green-400">Step 3: Game Completes</b>
              <p className="mt-1">After the game ends, the platform proposes a payout transaction:</p>
              <ul className="list-disc list-inside ml-4 mt-2">
                <li><b>If you win:</b> Proposal sends 95% to you, 5% to platform</li>
                <li><b>If it's a tie:</b> Proposal refunds both players appropriately</li>
              </ul>
              <p className="mt-2">The platform <b>signs the proposal</b> (that's 1 signature). Now we need 1 more signature...</p>
            </div>

            <div className="bg-black bg-opacity-30 rounded p-3">
              <b className="text-green-400">Step 4: You Sign to Claim</b>
              <p className="mt-1">To claim your winnings, <b>you must sign the proposal with your wallet</b>. This gives us the 
              required 2 signatures (Platform + You), and the transaction executes.</p>
              <p className="mt-2 text-green-400">✓ This means we <b>cannot</b> withdraw your funds without your explicit consent</p>
            </div>

            <div className="bg-black bg-opacity-30 rounded p-3">
              <b className="text-red-400">What if the loser refuses to sign?</b>
              <p className="mt-1">The losing player doesn't need to sign! Since the winner + platform = 2 signatures, 
              the transaction executes without the loser's permission.</p>
            </div>

            <div className="bg-black bg-opacity-30 rounded p-3">
              <b className="text-red-400">What if no one signs after 30 minutes?</b>
              <p className="mt-1">The system automatically creates a <b>refund proposal</b> that either player can sign 
              to get their money back (minus fees if applicable). Funds remain safely locked in the multisig vault until a player signs to execute the refund.</p>
            </div>
          </div>

          <div className="mt-4 bg-black bg-opacity-30 rounded p-4">
            <p className="text-green-400 font-bold mb-2">Why This Matters:</p>
            <ul className="text-sm text-white/90 space-y-1">
              <li>✓ <b>You're always in control</b> - We can't steal or freeze your funds</li>
              <li>✓ <b>Transparent</b> - All transactions are on Solana blockchain</li>
              <li>✓ <b>Audited</b> - Squads Protocol is professionally audited</li>
              <li>✓ <b>No trust required</b> - Smart contracts enforce the rules</li>
            </ul>
          </div>
        </div>

        {/* FAQ */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-6 max-w-4xl w-full text-accent shadow mb-6">
          <h2 className="text-2xl font-bold text-accent mb-4">❓ Frequently Asked Questions</h2>
          
          <div className="space-y-4 text-sm text-white/90">
            <div>
              <b className="text-accent text-base">Q: What happens if I disconnect during a game?</b>
              <p className="mt-1">If you disconnect, you can return within 5 minutes by refreshing the page. Your progress is saved. 
              If you don't return, the opponent wins if they solved the word, otherwise it's a losing tie.</p>
            </div>

                         <div>
               <b className="text-accent text-base">Q: How long do I have to sign a winning payout?</b>
               <p className="mt-1">Your funds remain safely locked in the multisig vault until you sign. After 30 minutes of no activity, 
               the system creates a refund proposal that either player can sign to recover their funds.</p>
             </div>

            <div>
              <b className="text-accent text-base">Q: Can Guess5 steal my money?</b>
              <p className="mt-1">No. Due to the 2-of-3 multisig design, we cannot access funds alone—we need at least one player signature. 
              Funds can only move after games complete or timeouts, and only when a player signs to approve the transaction. Even if we wanted to steal funds, the smart contract enforces these rules on-chain.</p>
            </div>

            <div>
              <b className="text-accent text-base">Q: What if my opponent refuses to sign the payout?</b>
              <p className="mt-1">The losing player doesn't need to sign. The winner + platform signatures are enough 
              (2 of 3 required) to execute the transaction.</p>
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
              <p className="mt-1">Yes! Guess5 works on mobile browsers with Phantom wallet's mobile app. Connect your wallet 
              through the Phantom app and play directly in your mobile browser.</p>
            </div>

            <div>
              <b className="text-accent text-base">Q: What is Squads Protocol?</b>
              <p className="mt-1">Squads Protocol is an audited, production-ready multisig wallet program on Solana. It's used 
              by major projects for secure fund management. Learn more at <a href="https://squads.so" target="_blank" rel="noopener noreferrer" 
              className="text-blue-400 underline">squads.so</a></p>
            </div>
          </div>
        </div>

        {/* Transparency & Data Download */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-6 max-w-4xl w-full text-accent shadow mb-6">
          <h2 className="text-2xl font-bold text-accent mb-4">📊 Complete Transparency</h2>
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
            <a 
              href="https://guess5.onrender.com/api/match/generate-report" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center bg-accent text-primary text-sm font-bold px-6 py-3 rounded-lg shadow hover:bg-yellow-400 transition-colors"
            >
              📥 Download Complete Match History (CSV)
            </a>
            <p className="text-sm text-white/70 mt-3">
              Complete match data with game results, winner amounts, blockchain verification links, and vault addresses
            </p>
          </div>
        </div>

        {/* Social Links */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-6 max-w-4xl w-full text-accent shadow mb-6">
          <h2 className="text-2xl font-bold text-accent mb-4">💬 Connect With Us</h2>
          <div className="flex gap-4 justify-center items-center flex-wrap">
            <a
              href="https://discord.gg/CcXWUv7r"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-6 py-3 rounded-lg shadow border border-indigo-500/30 hover:border-indigo-400/50 transition-all duration-200 min-h-[44px] flex items-center justify-center gap-2"
            >
              <span>💬</span>
              <span>Join Our Discord</span>
            </a>
            <a
              href="https://instagram.com/Guess5.io"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white text-sm font-medium px-6 py-3 rounded-lg shadow border border-purple-500/30 hover:border-purple-400/50 transition-all duration-200 min-h-[44px] flex items-center justify-center gap-2"
            >
              <span>📷</span>
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

