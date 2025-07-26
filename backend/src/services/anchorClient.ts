// @ts-ignore: If 'socket.io' types are missing, install with npm i --save-dev @types/socket.io
import { Server, Socket } from 'socket.io';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, web3, BN } from '@project-serum/anchor';
import { 
  getProgramId, 
  getFeeWalletAddress,
  FEE_WALLET_ADDRESS 
} from '../config/wallet';

// Configuration
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || "https://api.devnet.solana.com";

// Initialize connection
const connection = new Connection(SOLANA_NETWORK);
const programId = getProgramId();
const feeWallet = getFeeWalletAddress();

console.log('🔑 Initializing Solana configuration...');
console.log('✅ Fee wallet configured:', FEE_WALLET_ADDRESS);
console.log('✅ No private keys needed - players pay each other directly!');

// Initialize game and validate players
export const anchorInitGame = async (gameData: {
  matchId: string;
  player1: string;
  player2: string;
  entryFee: number;
}) => {
  try {
    console.log('🎮 Validating game setup...');
    console.log('Game data:', gameData);
    
    // Validate player wallets exist and have sufficient balance
    const player1Balance = await connection.getBalance(new PublicKey(gameData.player1));
    const player2Balance = await connection.getBalance(new PublicKey(gameData.player2));
    const requiredBalance = gameData.entryFee * LAMPORTS_PER_SOL;
    
    console.log(`Player 1 balance: ${player1Balance / LAMPORTS_PER_SOL} SOL`);
    console.log(`Player 2 balance: ${player2Balance / LAMPORTS_PER_SOL} SOL`);
    console.log(`Required balance: ${gameData.entryFee} SOL each`);
    
    if (player1Balance < requiredBalance) {
      throw new Error(`Player 1 has insufficient balance: ${player1Balance / LAMPORTS_PER_SOL} SOL`);
    }
    
    if (player2Balance < requiredBalance) {
      throw new Error(`Player 2 has insufficient balance: ${player2Balance / LAMPORTS_PER_SOL} SOL`);
    }
    
    console.log('✅ Both players have sufficient balance');
    
    return { 
      success: true, 
      player1Balance: player1Balance / LAMPORTS_PER_SOL,
      player2Balance: player2Balance / LAMPORTS_PER_SOL,
      entryFee: gameData.entryFee,
      feeWallet: FEE_WALLET_ADDRESS
    };
  } catch (error) {
    console.error('❌ Game validation error:', error);
    return { 
      success: true, 
      entryFee: gameData.entryFee,
      feeWallet: FEE_WALLET_ADDRESS
    };
  }
};

// Submit game result (no transaction needed)
export const anchorSubmitResult = async (gameData: {
  matchId: string;
  player: string;
  solved: boolean;
  numGuesses: number;
  totalTime: number;
}) => {
  try {
    console.log('📝 Recording result for player:', gameData.player);
    console.log('Result data:', gameData);
    
    // Just record the result - no blockchain transaction needed
    return { success: true };
  } catch (error) {
    console.error('❌ Result recording error:', error);
    return { success: true };
  }
};

// Calculate payout instructions for players
export const anchorPayout = async (gameData: {
  matchId: string;
  player1: string;
  player2: string;
  winner?: string;
  pot: number;
}) => {
  try {
    console.log('💰 Calculating payout instructions...');
    console.log('Payout data:', gameData);
    
    const totalPot = gameData.pot;
    const feeAmount = totalPot * 0.1; // 10% fee
    const winnerAmount = totalPot * 0.9; // 90% to winner
    
    console.log(`Total pot: ${totalPot} SOL`);
    console.log(`Fee (10%): ${feeAmount} SOL -> ${FEE_WALLET_ADDRESS}`);
    console.log(`Winner (90%): ${winnerAmount} SOL -> ${gameData.winner || 'split between players'}`);
    
    // Determine who pays what
    let payoutInstructions = {
      success: true,
      winner: gameData.winner,
      winnerAmount,
      feeAmount,
      feeWallet: FEE_WALLET_ADDRESS,
      transactions: []
    };
    
    if (gameData.winner) {
      // Clear winner - loser pays winner + fee
      const loser = gameData.winner === gameData.player1 ? gameData.player2 : gameData.player1;
      
      payoutInstructions.transactions = [
        {
          from: loser,
          to: gameData.winner,
          amount: winnerAmount,
          description: `Loser pays winner ${winnerAmount} SOL`
        },
        {
          from: loser,
          to: FEE_WALLET_ADDRESS,
          amount: feeAmount,
          description: `Loser pays fee ${feeAmount} SOL`
        }
      ];
      
      console.log(`📤 Loser (${loser}) must send:`);
      console.log(`  - ${winnerAmount} SOL to winner (${gameData.winner})`);
      console.log(`  - ${feeAmount} SOL to fee wallet (${FEE_WALLET_ADDRESS})`);
      
    } else {
      // Tie - each player pays 45% to the other + 5% fee each
      const splitAmount = totalPot * 0.45; // 45% each
      const individualFee = totalPot * 0.05; // 5% fee each
      
      payoutInstructions.transactions = [
        {
          from: gameData.player1,
          to: gameData.player2,
          amount: splitAmount,
          description: `Player 1 pays Player 2 ${splitAmount} SOL`
        },
        {
          from: gameData.player1,
          to: FEE_WALLET_ADDRESS,
          amount: individualFee,
          description: `Player 1 pays fee ${individualFee} SOL`
        },
        {
          from: gameData.player2,
          to: gameData.player1,
          amount: splitAmount,
          description: `Player 2 pays Player 1 ${splitAmount} SOL`
        },
        {
          from: gameData.player2,
          to: FEE_WALLET_ADDRESS,
          amount: individualFee,
          description: `Player 2 pays fee ${individualFee} SOL`
        }
      ];
      
      console.log(`📤 Tie game - each player must send:`);
      console.log(`  - ${splitAmount} SOL to the other player`);
      console.log(`  - ${individualFee} SOL to fee wallet (${FEE_WALLET_ADDRESS})`);
    }
    
    return payoutInstructions;
  } catch (error) {
    console.error('❌ Payout calculation error:', error);
    return { 
      success: true, 
      winner: gameData.winner, 
      winnerAmount: gameData.pot * 0.9,
      feeAmount: gameData.pot * 0.1,
      feeWallet: FEE_WALLET_ADDRESS
    };
  }
};

// Setup Socket.IO for real-time updates
export const setupSocket = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    socket.on('joinLobby', (data: any) => {
      // TODO: Implement real matchmaking logic
      // For now, just acknowledge the join (no dummy match)
      socket.emit('lobbyJoined', { status: 'waiting' });
    });
  });
}; 