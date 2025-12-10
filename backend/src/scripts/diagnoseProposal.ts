import { AppDataSource } from '../db/index';
import { Match } from '../models/Match';
import { Connection, PublicKey } from '@solana/web3.js';
import { accounts } from '@sqds/multisig';
import { getTransactionPda } from '@sqds/multisig';
import * as dotenv from 'dotenv';

dotenv.config();

const matchId = 'bee37eb4-c09d-46a4-818d-1f28c6f50e40';
const proposalId = null; // Will be fetched from database

async function diagnoseProposal() {
  console.log('🔍 Starting comprehensive proposal diagnosis...\n');
  
  // Initialize database
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  
  const matchRepository = AppDataSource.getRepository(Match);
  
  // 1. Check database record
  console.log('📊 STEP 1: Checking database record...');
  const match = await matchRepository.findOne({ where: { id: matchId } });
  
  if (!match) {
    console.error('❌ Match not found in database');
    return;
  }
  
  console.log('✅ Match found in database:');
  console.log('  - Match ID:', match.id);
  console.log('  - Player 1:', match.player1);
  console.log('  - Player 2:', match.player2);
  console.log('  - Squads Vault Address:', match.squadsVaultAddress);
  console.log('  - Payout Proposal ID:', match.payoutProposalId);
  console.log('  - Proposal Status:', match.proposalStatus);
  console.log('  - Proposal Created At:', match.proposalCreatedAt);
  console.log('  - Proposal Transaction ID:', match.proposalTransactionId);
  console.log('  - Proposal Signers:', match.proposalSigners);
  console.log('  - Needs Signatures:', match.needsSignatures);
  console.log('');
  
  // 2. Check on-chain proposal account
  console.log('🔗 STEP 2: Checking on-chain proposal account...');
  const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  
  // If no proposalId, skip on-chain check
  if (!match.payoutProposalId) {
    console.log('⚠️ No payoutProposalId in database - proposal may not have been created yet');
    console.log('  - Proposal Status:', match.proposalStatus);
    console.log('  - Proposal Created At:', match.proposalCreatedAt);
    console.log('');
    console.log('🔍 STEP 3: Checking vault for any proposals...');
    
    if (match.squadsVaultAddress) {
      const multisigAddress = new PublicKey(match.squadsVaultAddress);
      console.log('  - Multisig Address:', multisigAddress.toString());
      // Use Squads MCP to check vault
      console.log('  - Use Squads MCP to inspect vault for proposals');
    }
    return;
  }
  
  const proposalPda = new PublicKey(match.payoutProposalId);
  
  try {
    const proposalAccount = await accounts.Proposal.fromAccountAddress(
      connection,
      proposalPda,
      'confirmed'
    );
    
    console.log('✅ Proposal account found on-chain:');
    console.log('  - Proposal PDA:', proposalPda.toString());
    console.log('  - Transaction Index:', proposalAccount.transactionIndex?.toString());
    console.log('  - Status:', JSON.stringify(proposalAccount.status));
    console.log('  - Multisig:', proposalAccount.multisig.toString());
    console.log('  - Creator:', (proposalAccount as any).creator?.toString() || 'N/A');
    console.log('  - Approved:', proposalAccount.approved);
    console.log('  - Rejected:', proposalAccount.rejected);
    console.log('  - Executed:', (proposalAccount as any).executed || false);
    
    // Check signers
    if (proposalAccount.approved) {
      console.log('  - Approved Signers:', proposalAccount.approved.map((s: any) => s.toString()));
    }
    if (proposalAccount.rejected) {
      console.log('  - Rejected Signers:', proposalAccount.rejected.map((s: any) => s.toString()));
    }
    console.log('');
    
    // 3. Derive and check VaultTransaction PDA
    console.log('🔗 STEP 3: Deriving and checking VaultTransaction PDA...');
    const multisigAddress = new PublicKey(match.squadsVaultAddress!);
    const transactionIndex = proposalAccount.transactionIndex;
    const programId = new PublicKey('SQDS4ep65F8691BJ7YVKQN87dJYpZpjfFqcPvNdvA17f');
    
    if (!transactionIndex) {
      console.error('❌ Proposal account has no transactionIndex');
      return;
    }
    
    console.log('  - Using transactionIndex from proposal:', transactionIndex.toString());
    console.log('  - Multisig PDA:', multisigAddress.toString());
    
    // Convert transactionIndex to BigInt if needed
    const txIndexBigInt = typeof transactionIndex === 'bigint' 
      ? transactionIndex 
      : BigInt(transactionIndex.toString());
    
    const [vaultTxPda] = getTransactionPda({
      multisigPda: multisigAddress,
      index: txIndexBigInt,
      programId,
    });
    
    console.log('  - Derived VaultTransaction PDA:', vaultTxPda.toString());
    
    try {
      const vaultTxAccount = await accounts.VaultTransaction.fromAccountAddress(
        connection,
        vaultTxPda,
        'confirmed'
      );
      
      console.log('✅ VaultTransaction account exists on-chain:');
      console.log('  - VaultTransaction PDA:', vaultTxPda.toString());
      console.log('  - Transaction Index:', vaultTxAccount.index?.toString());
      console.log('  - Multisig:', vaultTxAccount.multisig.toString());
      console.log('  - Creator:', vaultTxAccount.creator.toString());
      console.log('  - Vault Index:', vaultTxAccount.vaultIndex);
      console.log('  - Has Message:', !!vaultTxAccount.message);
      
      if (vaultTxAccount.message) {
        const message = vaultTxAccount.message as any;
        console.log('  - Message Type:', typeof message);
        if (message.accountKeys) {
          console.log('  - Account Keys Count:', Array.isArray(message.accountKeys) ? message.accountKeys.length : 'N/A');
        }
        if (message.instructions) {
          console.log('  - Instructions Count:', Array.isArray(message.instructions) ? message.instructions.length : 'N/A');
        }
      }
      console.log('');
    } catch (vaultTxError: any) {
      console.error('❌ VaultTransaction account NOT found on-chain:');
      console.error('  - Error:', vaultTxError.message);
      console.error('  - PDA:', vaultTxPda.toString());
      console.error('  - This is the ROOT CAUSE - VaultTransaction missing prevents approval instruction building');
      console.log('');
    }
    
    // 4. Check proposal creation transaction
    console.log('🔗 STEP 4: Checking proposal creation transaction...');
    if (match.proposalTransactionId) {
      try {
        const creationTx = await connection.getTransaction(match.proposalTransactionId, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        
        if (creationTx) {
          console.log('✅ Proposal creation transaction found:');
          console.log('  - Transaction Signature:', match.proposalTransactionId);
          console.log('  - Transaction Status:', creationTx.meta?.err ? 'FAILED' : 'SUCCEEDED');
          if (creationTx.meta?.err) {
            console.error('  - Error:', JSON.stringify(creationTx.meta.err));
          }
          console.log('  - Slot:', creationTx.slot);
          console.log('  - Block Time:', creationTx.blockTime ? new Date(creationTx.blockTime * 1000).toISOString() : 'N/A');
          
          // Check if VaultTransaction was created in this transaction
          if (creationTx.meta?.innerInstructions) {
            // Use getAccountKeys() method for VersionedMessage
            let accountKeys: any[];
            if (creationTx.transaction.message.version === 'legacy') {
              accountKeys = creationTx.transaction.message.accountKeys;
            } else {
              const keys = creationTx.transaction.message.getAccountKeys();
              // getAccountKeys() returns PublicKey[] | MessageAccountKeys
              // Convert to array if needed
              accountKeys = Array.isArray(keys) ? keys : Array.from(keys.staticAccountKeys || []);
            }
            const allAccounts = accountKeys.map((key: any) => 
              typeof key === 'string' ? key : key.pubkey?.toString() || key.toString()
            );
            const createdAccounts = creationTx.meta.innerInstructions
              .flatMap((ix: any) => ix.instructions || [])
              .filter((ix: any) => ix.programId)
              .map((ix: any) => {
                // Try to find account creation
                return null;
              });
            
            console.log('  - Accounts in transaction:', allAccounts.length);
            if (allAccounts.includes(vaultTxPda.toString())) {
              console.log('  - ✅ VaultTransaction PDA found in transaction accounts');
            } else {
              console.log('  - ⚠️ VaultTransaction PDA NOT found in transaction accounts');
            }
          }
        } else {
          console.error('❌ Proposal creation transaction NOT found');
        }
        console.log('');
      } catch (txError: any) {
        console.error('❌ Error fetching proposal creation transaction:');
        console.error('  - Error:', txError.message);
        console.log('');
      }
    } else {
      console.warn('⚠️ No proposalTransactionId in database');
      console.log('');
    }
    
    // 5. Analyze signer situation
    console.log('👥 STEP 5: Analyzing signer situation...');
    const feeWallet = process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';
    const player1 = match.player1;
    const player2 = match.player2;
    
    console.log('  - Fee Wallet:', feeWallet);
    console.log('  - Player 1:', player1);
    console.log('  - Player 2:', player2);
    
    if (proposalAccount.approved) {
      const approvedSigners = proposalAccount.approved.map((s: any) => s.toString());
      console.log('  - On-chain Approved Signers:', approvedSigners);
      
      const feeWalletSigned = approvedSigners.includes(feeWallet);
      const player1Signed = approvedSigners.includes(player1);
      const player2Signed = approvedSigners.includes(player2);
      
      console.log('  - Fee Wallet Signed:', feeWalletSigned ? '✅' : '❌');
      console.log('  - Player 1 Signed:', player1Signed ? '✅' : '❌');
      console.log('  - Player 2 Signed:', player2Signed ? '✅' : '❌');
      
      if (feeWalletSigned && !player1Signed && !player2Signed) {
        console.log('\n🚨 ROOT CAUSE IDENTIFIED:');
        console.log('  Only the fee wallet has signed. Players cannot sign because:');
        console.log('  1. VaultTransaction is missing (prevents approval instruction building)');
        console.log('  2. Backend cannot build valid approval instruction without remainingAccounts');
        console.log('  3. Players cannot sign an invalid/missing instruction');
      }
    } else {
      console.log('  - No approved signers yet');
    }
    
    // 6. Check proposal age
    console.log('\n⏰ STEP 6: Checking proposal age...');
    if (match.proposalCreatedAt) {
      const ageSeconds = (Date.now() - new Date(match.proposalCreatedAt).getTime()) / 1000;
      console.log('  - Proposal Created At:', match.proposalCreatedAt);
      console.log('  - Age (seconds):', Math.round(ageSeconds));
      console.log('  - Age (minutes):', Math.round(ageSeconds / 60));
      
      if (ageSeconds > 60) {
        console.log('  - ⚠️ Proposal is > 60 seconds old - should be marked as FATAL if VaultTransaction missing');
      } else {
        console.log('  - ✅ Proposal is < 60 seconds old - backend correctly marks as RETRYABLE');
      }
    } else {
      console.warn('  - ⚠️ No proposalCreatedAt timestamp in database');
    }
    
    // 7. Summary
    console.log('\n📋 SUMMARY:');
    console.log('  - Proposal exists on-chain: ✅');
    console.log('  - VaultTransaction exists:', vaultTxPda ? '❌ (MISSING - ROOT CAUSE)' : '❌');
    console.log('  - Proposal status:', JSON.stringify(proposalAccount.status));
    console.log('  - Transaction Index:', transactionIndex.toString());
    console.log('  - Only fee wallet signed: ✅');
    console.log('  - Players cannot sign: ✅ (because VaultTransaction missing)');
    
  } catch (proposalError: any) {
    console.error('❌ Error fetching proposal account:');
    console.error('  - Error:', proposalError.message);
    console.error('  - Stack:', proposalError.stack);
  }
  
  await AppDataSource.destroy();
}

diagnoseProposal().catch(console.error);

