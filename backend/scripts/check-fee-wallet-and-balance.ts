/**
 * Runtime Verification: Fee Wallet and Escrow Balance
 * 
 * Verifies that fee wallet is writable and funded, and escrow has sufficient balance
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { createPremiumSolanaConnection } from '../src/config/solanaConnection';
import { config } from '../src/config/environment';
import { AppDataSource } from '../src/db';
import { Match } from '../src/models/Match';
import { deriveEscrowPDA } from '../src/services/escrowService';
import { Program } from '@coral-xyz/anchor';
import { SystemProgram } from '@solana/web3.js';

const IDL = require('../src/types/game-escrow.json');

async function checkFeeWalletAndBalance() {
  console.log('💰 Checking Fee Wallet and Escrow Balance\n');

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

    // Check fee wallet
    console.log('💳 Fee Wallet Check:');
    const feeWalletAddress = config.solana.feeWalletAddress;
    if (!feeWalletAddress) {
      console.log('  ❌ FEE_WALLET_ADDRESS not configured!');
      return;
    }

    const feeWallet = new PublicKey(feeWalletAddress);
    console.log('  Address:', feeWallet.toString());
    
    const feeWalletInfo = await connection.getAccountInfo(feeWallet);
    if (!feeWalletInfo) {
      console.log('  ❌ Fee wallet account does not exist!');
      return;
    }

    const feeWalletBalance = feeWalletInfo.lamports;
    const feeWalletBalanceSOL = feeWalletBalance / 1e9;
    
    console.log('  Balance:', feeWalletBalance, 'lamports');
    console.log('  Balance (SOL):', feeWalletBalanceSOL, 'SOL');
    console.log('  Executable:', feeWalletInfo.executable ? '❌ (BAD)' : '✅');
    console.log('  Owner:', feeWalletInfo.owner.toString());
    console.log('  Writable:', !feeWalletInfo.executable ? '✅' : '❌');
    console.log('');

    // Check if balance is sufficient (should have at least 0.1 SOL for fees)
    const minBalance = 0.1 * 1e9; // 0.1 SOL
    console.log('  Balance Check:');
    console.log('    Minimum Required:', minBalance, 'lamports (0.1 SOL)');
    console.log('    Current Balance:', feeWalletBalance, 'lamports');
    console.log('    Sufficient:', feeWalletBalance >= minBalance ? '✅' : '❌');
    console.log('');

    // Check escrow accounts
    console.log('🏦 Escrow Accounts Check:');
    const matchRepository = AppDataSource.getRepository(Match);
    const matches = await matchRepository.find({
      where: {
        escrowAddress: { $ne: null } as any,
        escrowStatus: 'ACTIVE',
      },
      take: 10,
    });

    if (matches.length === 0) {
      console.log('  ⚠️  No active escrow matches found');
      console.log('');
    } else {
      console.log(`  Found ${matches.length} active escrow matches\n`);

      for (const match of matches) {
        if (!match.escrowAddress) continue;

        console.log(`  📋 Match: ${match.id}`);
        
        try {
          const [escrowPDA] = deriveEscrowPDA(match.id);
          const escrowInfo = await connection.getAccountInfo(escrowPDA);
          
          if (!escrowInfo) {
            console.log('    ❌ Escrow account does not exist on-chain');
            console.log('');
            continue;
          }

          const escrowBalance = escrowInfo.lamports;
          const escrowBalanceSOL = escrowBalance / 1e9;

          // Fetch escrow account data
          const escrowAccount = await (program.account as any).gameEscrow.fetch(escrowPDA);
          const entryFee = escrowAccount.entryFeeLamports.toNumber();
          const totalPot = entryFee * 2; // Both players should have deposited

          // Calculate rent-exempt minimum
          const rentExemptMinimum = await connection.getMinimumBalanceForRentExemption(
            8 + 16 + 32 + 32 + 8 + 1 + 1 + 1 + 1 + 32 + 1 + 8 + 8 // GameEscrow::LEN
          );

          const availableBalance = escrowBalance > rentExemptMinimum 
            ? escrowBalance - rentExemptMinimum 
            : 0;

          console.log('    Escrow PDA:', escrowPDA.toString());
          console.log('    Total Balance:', escrowBalance, 'lamports');
          console.log('    Total Balance (SOL):', escrowBalanceSOL, 'SOL');
          console.log('    Rent-Exempt Minimum:', rentExemptMinimum, 'lamports');
          console.log('    Available Balance:', availableBalance, 'lamports');
          console.log('    Entry Fee (per player):', entryFee, 'lamports');
          console.log('    Expected Total Pot:', totalPot, 'lamports');
          console.log('    Sufficient Funds:', availableBalance >= totalPot ? '✅' : '❌');
          console.log('    Game Status:', escrowAccount.gameStatus);
          console.log('    Result Type:', JSON.stringify(escrowAccount.resultType));
          console.log('');

          if (availableBalance < totalPot) {
            console.log('    ⚠️  WARNING: Insufficient funds in escrow!');
            console.log('      Missing:', totalPot - availableBalance, 'lamports');
            console.log('');
          }

        } catch (error: any) {
          console.log('    ❌ Error checking escrow:', error.message);
          console.log('');
        }
      }
    }

    console.log('✅ Fee wallet and balance check complete');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

checkFeeWalletAndBalance()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Check failed:', error);
    process.exit(1);
  });

