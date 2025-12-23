/**
 * Runtime Verification: Winner Account Logic
 * 
 * Verifies that winner account is correctly passed for different result types
 */

import { PublicKey, SystemProgram } from '@solana/web3.js';
import { AppDataSource } from '../src/db';
import { Match } from '../src/models/Match';
import { createPremiumSolanaConnection } from '../src/config/solanaConnection';
import { config } from '../src/config/environment';
import { deriveEscrowPDA } from '../src/services/escrowService';
import { Program } from '@coral-xyz/anchor';

const IDL = require('../src/types/game-escrow.json');

async function verifyWinnerAccountLogic() {
  console.log('🔐 Verifying Winner Account Logic\n');

  try {
    // Initialize database
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const connection = createPremiumSolanaConnection();
    const programId = new PublicKey(config.smartContract.programId || 'ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4');
    const program = new Program(IDL, programId, {
      connection,
      wallet: {
        publicKey: SystemProgram.programId,
        signTransaction: async (tx: any) => tx,
        signAllTransactions: async (txs: any[]) => txs,
      } as any,
    });

    const matchRepository = AppDataSource.getRepository(Match);
    const matches = await matchRepository.find({
      where: {
        escrowAddress: { $ne: null } as any,
      },
      take: 10,
    });

    if (matches.length === 0) {
      console.log('⚠️  No matches with escrowAddress found');
      return;
    }

    console.log(`✅ Found ${matches.length} matches with escrow\n`);

    for (const match of matches) {
      if (!match.escrowAddress) continue;

      console.log(`📋 Match: ${match.id}`);
      console.log('  Escrow Address:', match.escrowAddress);
      console.log('  Escrow Status:', match.escrowStatus || 'N/A');
      console.log('');

      try {
        const [escrowPDA] = deriveEscrowPDA(match.id);
        const escrowAccount = await (program.account as any).gameEscrow.fetch(escrowPDA);

        const resultType = escrowAccount.resultType;
        const winner = escrowAccount.winner 
          ? new PublicKey(escrowAccount.winner)
          : null;

        console.log('  On-Chain State:');
        console.log('    Result Type:', JSON.stringify(resultType));
        console.log('    Winner:', winner?.toString() || 'None');
        console.log('    Game Status:', escrowAccount.gameStatus);
        console.log('');

        // Simulate what escrowService.ts does
        const winnerForSettle = winner || SystemProgram.programId;
        
        console.log('  TypeScript Logic (escrowService.ts):');
        console.log('    winner variable:', winner ? winner.toString() : 'null');
        console.log('    winner || SystemProgram.programId:', winnerForSettle.toString());
        console.log('');

        // Check if winner account is valid
        const winnerInfo = await connection.getAccountInfo(winnerForSettle);
        const isWritable = winnerInfo && !winnerInfo.executable;

        console.log('  Account Validation:');
        console.log('    Winner Account Exists:', winnerInfo ? '✅' : '❌');
        console.log('    Is Writable:', isWritable ? '✅' : '❌');
        console.log('    Is Executable:', winnerInfo?.executable ? '❌ (BAD)' : '✅');
        console.log('');

        // Determine expected behavior
        const isWin = resultType?.win !== undefined;
        const isDraw = resultType?.drawFullRefund !== undefined || resultType?.drawPartialRefund !== undefined;
        const isUnresolved = resultType?.unresolved !== undefined;

        console.log('  Expected Behavior:');
        if (isWin) {
          console.log('    Result Type: Win');
          console.log('    Winner Required: ✅ YES');
          console.log('    Winner Valid:', winner ? '✅' : '❌ MISSING');
          if (!winner) {
            console.log('    ⚠️  ERROR: Win result type requires winner!');
          }
        } else if (isDraw || isUnresolved) {
          console.log('    Result Type:', isDraw ? 'Draw' : 'Unresolved');
          console.log('    Winner Required: ❌ NO');
          console.log('    Fallback to SystemProgram.programId: ✅ OK');
          console.log('    Note: Winner account not used for transfers in this case');
        }
        console.log('');

        // Check if SystemProgram.programId is acceptable as fallback
        if (!winner && winnerForSettle.equals(SystemProgram.programId)) {
          console.log('  ⚠️  WARNING: Using SystemProgram.programId as winner');
          console.log('    This is acceptable for draws/timeouts, but verify Rust program');
          console.log('    handles this correctly (should not use winner account for transfers)');
        }
        console.log('');

      } catch (error: any) {
        console.log('  ❌ Error fetching escrow:', error.message);
        console.log('');
      }
    }

    console.log('✅ Winner account logic verification complete');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

verifyWinnerAccountLogic()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  });

