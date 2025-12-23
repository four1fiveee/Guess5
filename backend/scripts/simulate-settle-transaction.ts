/**
 * Runtime Verification: Simulate settle() Transaction
 * 
 * Simulates a settle() transaction to verify:
 * - PDA seeds resolve correctly
 * - Winner/fee transfers are invoked
 * - No math overflows or account mismatches
 */

import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { createPremiumSolanaConnection } from '../src/config/solanaConnection';
import { config } from '../src/config/environment';
import { deriveEscrowPDA } from '../src/services/escrowService';
import { AppDataSource } from '../src/db';
import { Match } from '../src/models/Match';

const IDL = require('../src/types/game-escrow.json');

async function simulateSettleTransaction() {
  console.log('🧪 Starting settle() Transaction Simulation\n');

  try {
    // Initialize database
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    // Get connection
    const connection = createPremiumSolanaConnection();
    console.log('✅ Connection established');
    console.log('  RPC URL:', (connection as any)._rpcEndpoint || 'Helius Premium');
    console.log('');

    // Get program
    const programId = new PublicKey(config.smartContract.programId || 'ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4');
    console.log('Program ID:', programId.toString());
    console.log('');

    // Find a match with escrow that's ready to settle
    const matchRepository = AppDataSource.getRepository(Match);
    const matches = await matchRepository.find({
      where: {
        escrowStatus: 'ACTIVE', // or 'PENDING' if we want to test
      },
      take: 5,
    });

    if (matches.length === 0) {
      console.log('⚠️  No matches found with escrowStatus=ACTIVE');
      console.log('   Looking for any match with escrowAddress...');
      
      const anyMatch = await matchRepository.findOne({
        where: {
          escrowAddress: { $ne: null } as any,
        },
      });

      if (!anyMatch || !anyMatch.escrowAddress) {
        console.log('❌ No matches with escrowAddress found');
        console.log('   Please create a match first or provide a matchId');
        return;
      }

      console.log('✅ Found match:', anyMatch.id);
      await simulateForMatch(anyMatch, connection, programId);
      return;
    }

    console.log(`✅ Found ${matches.length} matches with escrowStatus=ACTIVE`);
    console.log('   Simulating for first match...\n');

    await simulateForMatch(matches[0], connection, programId);

  } catch (error) {
    console.error('❌ Error during simulation:', error);
    throw error;
  }
}

async function simulateForMatch(
  match: Match,
  connection: Connection,
  programId: PublicKey
) {
  console.log('📋 Match Details:');
  console.log('  Match ID:', match.id);
  console.log('  Escrow Address:', match.escrowAddress || 'N/A');
  console.log('  Escrow Status:', match.escrowStatus || 'N/A');
  console.log('  Player 1:', match.player1);
  console.log('  Player 2:', match.player2 || 'N/A');
  console.log('');

  if (!match.escrowAddress) {
    console.log('❌ Match has no escrowAddress - cannot simulate');
    return;
  }

  try {
    // Derive PDA
    const [escrowPDA, bump] = deriveEscrowPDA(match.id);
    console.log('🔑 PDA Derivation:');
    console.log('  Expected PDA:', escrowPDA.toString());
    console.log('  Match escrowAddress:', match.escrowAddress);
    console.log('  Match:', escrowPDA.toString() === match.escrowAddress ? '✅' : '❌');
    console.log('  Bump:', bump);
    console.log('');

    // Fetch escrow account
    const program = new Program(IDL, programId, {
      connection,
      // Dummy wallet for simulation
      wallet: {
        publicKey: SystemProgram.programId,
        signTransaction: async (tx: Transaction) => tx,
        signAllTransactions: async (txs: Transaction[]) => txs,
      } as Wallet,
    });

    let escrowAccount;
    try {
      escrowAccount = await (program.account as any).gameEscrow.fetch(escrowPDA);
      console.log('✅ Escrow Account Fetched:');
      console.log('  Match ID:', escrowAccount.matchId.toString());
      console.log('  Game Status:', escrowAccount.gameStatus);
      console.log('  Result Type:', escrowAccount.resultType);
      console.log('  Winner:', escrowAccount.winner ? new PublicKey(escrowAccount.winner).toString() : 'None');
      console.log('  Entry Fee:', escrowAccount.entryFeeLamports.toString(), 'lamports');
      console.log('  Player A:', new PublicKey(escrowAccount.playerA).toString());
      console.log('  Player B:', new PublicKey(escrowAccount.playerB).toString());
      console.log('');
    } catch (fetchError: any) {
      console.log('❌ Failed to fetch escrow account:', fetchError.message);
      console.log('   Account may not exist or be initialized');
      return;
    }

    // Check escrow balance
    const escrowInfo = await connection.getAccountInfo(escrowPDA);
    const escrowBalance = escrowInfo?.lamports || 0;
    console.log('💰 Escrow Balance:');
    console.log('  Balance:', escrowBalance, 'lamports');
    console.log('  Balance (SOL):', escrowBalance / 1e9, 'SOL');
    console.log('');

    // Check fee wallet
    const feeWallet = new PublicKey(config.solana.feeWalletAddress);
    const feeWalletInfo = await connection.getAccountInfo(feeWallet);
    const feeWalletBalance = feeWalletInfo?.lamports || 0;
    console.log('💳 Fee Wallet:');
    console.log('  Address:', feeWallet.toString());
    console.log('  Balance:', feeWalletBalance, 'lamports');
    console.log('  Balance (SOL):', feeWalletBalance / 1e9, 'SOL');
    console.log('  Writable:', feeWalletInfo?.executable === false ? '✅' : '❌');
    console.log('');

    // Determine winner
    const winner = escrowAccount.winner 
      ? new PublicKey(escrowAccount.winner)
      : SystemProgram.programId; // Fallback for draws/timeouts

    console.log('🎯 Settlement Parameters:');
    console.log('  Winner:', winner.toString());
    console.log('  Result Type:', escrowAccount.resultType);
    console.log('  Game Status:', escrowAccount.gameStatus);
    console.log('');

    // Build settle instruction
    const settleIx = await program.methods
      .settle()
      .accounts({
        gameEscrow: escrowPDA,
        winner: winner,
        playerA: new PublicKey(escrowAccount.playerA),
        playerB: new PublicKey(escrowAccount.playerB),
        feeWallet: feeWallet,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    // Create transaction for simulation
    const transaction = new Transaction().add(settleIx);
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = SystemProgram.programId; // Dummy payer for simulation

    console.log('🔄 Simulating Transaction...\n');

    // Simulate transaction
    const simulation = await connection.simulateTransaction(transaction, {
      replaceRecentBlockhash: true,
      sigVerify: false,
    });

    console.log('📊 Simulation Results:');
    console.log('  Success:', simulation.value.err ? '❌' : '✅');
    
    if (simulation.value.err) {
      console.log('  Error:', JSON.stringify(simulation.value.err, null, 2));
    } else {
      console.log('  Compute Units Used:', simulation.value.unitsConsumed || 'N/A');
      console.log('  Compute Units Requested:', simulation.value.unitsRequested || 'N/A');
    }

    console.log('  Logs:');
    if (simulation.value.logs) {
      simulation.value.logs.forEach((log, i) => {
        console.log(`    [${i}] ${log}`);
      });
    } else {
      console.log('    (No logs)');
    }
    console.log('');

    // Check for specific log patterns
    const logs = simulation.value.logs || [];
    const hasInvokeSigned = logs.some(log => log.includes('invoke') || log.includes('CPI'));
    const hasTransfer = logs.some(log => log.includes('transfer') || log.includes('Transfer'));
    const hasSettled = logs.some(log => log.includes('settled') || log.includes('Settled'));

    console.log('🔍 Log Analysis:');
    console.log('  Has invoke_signed:', hasInvokeSigned ? '✅' : '❌');
    console.log('  Has transfer:', hasTransfer ? '✅' : '❌');
    console.log('  Has settled:', hasSettled ? '✅' : '❌');
    console.log('');

    if (!simulation.value.err && simulation.value.unitsConsumed) {
      const computeUnits = simulation.value.unitsConsumed;
      console.log('⚡ Compute Units:');
      console.log('  Used:', computeUnits);
      console.log('  Under 200k:', computeUnits < 200000 ? '✅' : '❌');
      console.log('');
    }

    return {
      success: !simulation.value.err,
      computeUnitsUsed: simulation.value.unitsConsumed,
      logs: simulation.value.logs,
      error: simulation.value.err,
    };

  } catch (error: any) {
    console.error('❌ Error during simulation:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

// Run simulation
simulateSettleTransaction()
  .then(() => {
    console.log('✅ Simulation complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Simulation failed:', error);
    process.exit(1);
  });

