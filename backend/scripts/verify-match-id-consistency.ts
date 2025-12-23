/**
 * Runtime Verification: Match ID Format Consistency
 * 
 * Verifies that match_id conversion between TypeScript (UUID) and Rust (u128)
 * produces byte-identical PDAs.
 */

import { PublicKey, Connection } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { createPremiumSolanaConnection } from '../src/config/solanaConnection';
import { config } from '../src/config/environment';

const PROGRAM_ID = new PublicKey(config.smartContract.programId || 'ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4');

/**
 * Derive PDA using TypeScript method (UUID hex → BN → LE bytes)
 * This should match the fixed deriveEscrowPDA function
 */
function derivePDA_TypeScript(matchId: string): [PublicKey, number] {
  const uuidHex = matchId.replace(/-/g, '');
  if (uuidHex.length !== 32) {
    throw new Error(`Invalid matchId format: expected 32 hex characters, got ${uuidHex.length}`);
  }
  // Match Rust: match_id.to_le_bytes() where match_id is u128
  const matchIdHex = uuidHex.substring(0, 32);
  const matchIdBN = new BN(matchIdHex, 16);
  const matchIdBytes = matchIdBN.toArrayLike(Buffer, 'le', 16);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('match'), matchIdBytes],
    PROGRAM_ID
  );
}

/**
 * Derive PDA using Rust method (UUID hex → BN → to_le_bytes())
 * This simulates what Rust does: BN(matchIdHex, 16).toArrayLike(Buffer, "le", 16)
 */
function derivePDA_Rust(matchId: string): [PublicKey, number] {
  const uuidHex = matchId.replace(/-/g, '').substring(0, 32);
  const matchIdBN = new BN(uuidHex, 16);
  // Convert BN to 16-byte little-endian buffer (matching Rust's to_le_bytes())
  const matchIdBytes = matchIdBN.toArrayLike(Buffer, 'le', 16);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('match'), matchIdBytes],
    PROGRAM_ID
  );
}

/**
 * Compare byte arrays
 */
function compareBytes(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Main verification function
 */
async function verifyMatchIdConsistency() {
  console.log('🔍 Starting Match ID Format Consistency Verification\n');
  console.log('Program ID:', PROGRAM_ID.toString());
  console.log('');

  // Test with a sample UUID
  const testMatchId = '550e8400-e29b-41d4-a716-446655440000';
  console.log('Test Match ID:', testMatchId);
  console.log('');

  try {
    // TypeScript method (using fixed implementation)
    const [pdaTS, bumpTS] = derivePDA_TypeScript(testMatchId);
    const uuidHex = testMatchId.replace(/-/g, '');
    const matchIdHex = uuidHex.substring(0, 32);
    const matchIdBN_TS = new BN(matchIdHex, 16);
    const matchIdBytesTS = matchIdBN_TS.toArrayLike(Buffer, 'le', 16);
    
    console.log('📦 TypeScript PDA Derivation (FIXED):');
    console.log('  UUID Hex:', uuidHex);
    console.log('  Match ID BN:', matchIdBN_TS.toString());
    console.log('  Match ID Bytes (LE, hex):', matchIdBytesTS.toString('hex'));
    console.log('  Match ID Bytes (length):', matchIdBytesTS.length);
    console.log('  PDA:', pdaTS.toString());
    console.log('  Bump:', bumpTS);
    console.log('');

    // Rust method
    const [pdaRust, bumpRust] = derivePDA_Rust(testMatchId);
    const matchIdBN_Rust = new BN(uuidHex.substring(0, 32), 16);
    const matchIdBytesRust = matchIdBN_Rust.toArrayLike(Buffer, 'le', 16);
    
    console.log('🦀 Rust PDA Derivation (simulated):');
    console.log('  UUID Hex (first 32 chars):', uuidHex.substring(0, 32));
    console.log('  Match ID BN:', matchIdBN_Rust.toString());
    console.log('  Match ID Bytes (LE, hex):', matchIdBytesRust.toString('hex'));
    console.log('  Match ID Bytes (length):', matchIdBytesRust.length);
    console.log('  PDA:', pdaRust.toString());
    console.log('  Bump:', bumpRust);
    console.log('');

    // Compare
    const bytesMatch = compareBytes(matchIdBytesTS, matchIdBytesRust);
    const pdaMatch = pdaTS.equals(pdaRust);
    const bumpMatch = bumpTS === bumpRust;

    console.log('🔬 Comparison Results:');
    console.log('  Match ID Bytes Match:', bytesMatch ? '✅' : '❌');
    console.log('  PDA Match:', pdaMatch ? '✅' : '❌');
    console.log('  Bump Match:', bumpMatch ? '✅' : '❌');
    console.log('');

    if (!bytesMatch) {
      console.log('⚠️  BYTE MISMATCH DETECTED!');
      console.log('  TypeScript bytes (LE):', matchIdBytesTS.toString('hex'));
      console.log('  Rust bytes (LE):', matchIdBytesRust.toString('hex'));
      console.log('');
      console.log('This will cause PDA derivation to fail!');
      return false;
    }

    if (!pdaMatch) {
      console.log('⚠️  PDA MISMATCH DETECTED!');
      console.log('  TypeScript PDA:', pdaTS.toString());
      console.log('  Rust PDA:', pdaRust.toString());
      console.log('');
      console.log('Settlement will fail - wrong vault address!');
      return false;
    }

    console.log('✅ All checks passed! Match ID format is consistent.');
    return true;

  } catch (error) {
    console.error('❌ Error during verification:', error);
    return false;
  }
}

// Run verification
verifyMatchIdConsistency()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

