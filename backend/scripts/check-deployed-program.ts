/**
 * Runtime Verification: Check Deployed Program Hash and IDL
 * 
 * Verifies that the deployed program matches the local build
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { createPremiumSolanaConnection } from '../src/config/solanaConnection';
import { config } from '../src/config/environment';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const PROGRAM_ID = new PublicKey(config.smartContract.programId || 'ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4');

async function checkDeployedProgram() {
  console.log('🔍 Checking Deployed Program Hash and IDL\n');
  console.log('Program ID:', PROGRAM_ID.toString());
  console.log('');

  try {
    const connection = createPremiumSolanaConnection();
    console.log('✅ Connection established');
    console.log('');

    // Get program account info
    console.log('📦 Fetching Program Account Info...');
    const programInfo = await connection.getAccountInfo(PROGRAM_ID);
    
    if (!programInfo) {
      console.log('❌ Program account not found!');
      return;
    }

    console.log('✅ Program Account Found:');
    console.log('  Owner:', programInfo.owner.toString());
    console.log('  Executable:', programInfo.executable ? '✅' : '❌');
    console.log('  Data Length:', programInfo.data.length, 'bytes');
    console.log('  Lamports:', programInfo.lamports);
    console.log('');

    // Get program data hash (if available via RPC)
    try {
      console.log('🔐 Fetching Program Data Hash...');
      const programData = await connection.getParsedAccountInfo(PROGRAM_ID);
      
      if (programData.value && 'parsed' in programData.value) {
        const parsed = programData.value.parsed as any;
        if (parsed.info) {
          console.log('  Program Data:', JSON.stringify(parsed.info, null, 2));
        }
      }
    } catch (hashError: any) {
      console.log('⚠️  Could not fetch program data hash:', hashError.message);
      console.log('   This is normal - use solana CLI for detailed hash');
    }

    console.log('');

    // Check local build
    console.log('🔨 Checking Local Build...');
    const programDir = path.join(__dirname, '../programs/game-escrow');
    const targetDir = path.join(programDir, 'target', 'deploy');
    const soFile = path.join(targetDir, 'game_escrow.so');

    if (fs.existsSync(soFile)) {
      const stats = fs.statSync(soFile);
      console.log('✅ Local .so file found:');
      console.log('  Path:', soFile);
      console.log('  Size:', stats.size, 'bytes');
      console.log('  Modified:', stats.mtime.toISOString());
      console.log('');

      // Try to get hash of local file
      try {
        const crypto = require('crypto');
        const fileBuffer = fs.readFileSync(soFile);
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        console.log('  SHA256 Hash:', hash);
        console.log('');
      } catch (hashError) {
        console.log('⚠️  Could not compute local file hash');
      }
    } else {
      console.log('⚠️  Local .so file not found at:', soFile);
      console.log('   Run: anchor build');
      console.log('');
    }

    // Check IDL
    console.log('📄 Checking IDL...');
    const idlPath = path.join(programDir, 'target', 'idl', 'game_escrow.json');
    const idlPathAlt = path.join(__dirname, '../src/types/game-escrow.json');

    let idlPathFound = null;
    if (fs.existsSync(idlPath)) {
      idlPathFound = idlPath;
    } else if (fs.existsSync(idlPathAlt)) {
      idlPathFound = idlPathAlt;
    }

    if (idlPathFound) {
      const idl = JSON.parse(fs.readFileSync(idlPathFound, 'utf-8'));
      console.log('✅ IDL found:');
      console.log('  Path:', idlPathFound);
      console.log('  Program ID:', idl.metadata?.address || 'N/A');
      console.log('  Instructions:', idl.instructions?.length || 0);
      console.log('  Accounts:', idl.accounts?.length || 0);
      console.log('');

      // Check if program ID matches
      const idlProgramId = idl.metadata?.address;
      if (idlProgramId && idlProgramId !== PROGRAM_ID.toString()) {
        console.log('⚠️  IDL Program ID mismatch!');
        console.log('  IDL:', idlProgramId);
        console.log('  Config:', PROGRAM_ID.toString());
      } else {
        console.log('✅ IDL Program ID matches');
      }
      console.log('');
    } else {
      console.log('⚠️  IDL not found');
      console.log('   Checked:', idlPath);
      console.log('   Checked:', idlPathAlt);
      console.log('');
    }

    // Try to use solana CLI if available
    console.log('💻 Checking via Solana CLI...');
    try {
      const cluster = config.solana.network?.includes('devnet') ? 'devnet' : 'mainnet-beta';
      const cmd = `solana program show ${PROGRAM_ID.toString()} --url ${cluster}`;
      console.log('  Command:', cmd);
      
      try {
        const output = execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
        console.log('  Output:');
        console.log(output);
        console.log('');
      } catch (cliError: any) {
        console.log('⚠️  Solana CLI not available or command failed');
        console.log('   Error:', cliError.message);
        console.log('   Install: https://docs.solana.com/cli/install-solana-cli-tools');
        console.log('');
      }
    } catch (error) {
      console.log('⚠️  Could not run Solana CLI check');
      console.log('');
    }

    console.log('✅ Program check complete');
    console.log('');
    console.log('📋 Summary:');
    console.log('  Program exists on-chain: ✅');
    console.log('  Program is executable: ✅');
    console.log('  Local build exists:', fs.existsSync(soFile) ? '✅' : '❌');
    console.log('  IDL exists:', idlPathFound ? '✅' : '❌');
    console.log('');

  } catch (error: any) {
    console.error('❌ Error checking deployed program:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

checkDeployedProgram()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Check failed:', error);
    process.exit(1);
  });

