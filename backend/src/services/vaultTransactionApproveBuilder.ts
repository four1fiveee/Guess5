/**
 * Builds VaultTransaction approval instruction from Squads IDL
 * Since SDK doesn't provide a helper, we build it manually using Anchor's coder
 */

import { Program, Idl, AnchorProvider } from '@coral-xyz/anchor';
import { Connection, PublicKey, TransactionInstruction, SystemProgram, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { enhancedLogger } from '../utils/enhancedLogger';

let cachedIdl: Idl | null = null;
let cachedProgram: Program<Idl> | null = null;

/**
 * Loads the Squads IDL from package or on-chain
 */
async function loadIdlOrThrow(connection: Connection, programId: PublicKey): Promise<Idl> {
  if (cachedIdl) {
    return cachedIdl;
  }

  // Try to load IDL from node_modules
  try {
    const sqdsModulePath = require.resolve('@sqds/multisig');
    const sqdsDir = path.dirname(sqdsModulePath);
    
    // Try common IDL locations
    const possiblePaths = [
      path.join(sqdsDir, 'idl.json'),
      path.join(sqdsDir, 'dist', 'idl.json'),
      path.join(sqdsDir, 'lib', 'idl.json'),
      path.join(sqdsDir, '..', 'idl.json'),
      path.join(sqdsDir, '..', '..', 'idl.json'),
      // Also try package root
      path.join(path.dirname(sqdsDir), 'idl.json'),
    ];

    for (const idlPathToTry of possiblePaths) {
      try {
        if (fs.existsSync(idlPathToTry)) {
          const idlRaw = fs.readFileSync(idlPathToTry, 'utf8');
          const idl = JSON.parse(idlRaw) as Idl;
          cachedIdl = idl;
          enhancedLogger.info('✅ Loaded Squads IDL from package', { path: idlPathToTry });
          return idl;
        }
      } catch (e) {
        // Try next path
      }
    }

    // Try to find IDL in package.json exports or require it directly
    try {
      const sqdsPackagePath = require.resolve('@sqds/multisig/package.json');
      const sqdsPackage = JSON.parse(fs.readFileSync(sqdsPackagePath, 'utf8'));
      if (sqdsPackage.exports?.['./idl.json']) {
        const idlPath = require.resolve('@sqds/multisig/idl.json');
        const idlRaw = fs.readFileSync(idlPath, 'utf8');
        const idl = JSON.parse(idlRaw) as Idl;
        cachedIdl = idl;
        enhancedLogger.info('✅ Loaded Squads IDL from package exports', { path: idlPath });
        return idl;
      }
    } catch (e) {
      // Continue to on-chain fetch
    }

    // Try searching the entire node_modules/@sqds/multisig directory
    try {
      const sqdsRoot = path.dirname(require.resolve('@sqds/multisig/package.json'));
      const searchPaths = [
        path.join(sqdsRoot, 'idl.json'),
        path.join(sqdsRoot, 'dist', 'idl.json'),
        path.join(sqdsRoot, 'lib', 'idl.json'),
      ];
      
      for (const searchPath of searchPaths) {
        if (fs.existsSync(searchPath)) {
          const idlRaw = fs.readFileSync(searchPath, 'utf8');
          const idl = JSON.parse(idlRaw) as Idl;
          cachedIdl = idl;
          enhancedLogger.info('✅ Loaded Squads IDL from package root search', { path: searchPath });
          return idl;
        }
      }
    } catch (e) {
      // Continue
    }

    enhancedLogger.warn('⚠️ Could not load IDL from package, attempting on-chain fetch...');
  } catch (e) {
    enhancedLogger.warn('⚠️ Could not load IDL from package, attempting on-chain fetch...', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Fallback: Try to fetch IDL on-chain via Anchor
  try {
    // Create a minimal provider (we don't need a wallet for IDL fetch)
    // Use a dummy keypair for provider (Anchor requires it but we won't use it)
    const { Keypair } = require('@solana/web3.js');
    const dummyKeypair = Keypair.generate();
    const provider = new AnchorProvider(connection, { publicKey: dummyKeypair.publicKey, signTransaction: async (tx) => tx, signAllTransactions: async (txs) => txs } as any, {});
    
    // Try to fetch IDL from on-chain
    // Note: This may not work if IDL is not stored on-chain
    const fetchedIdl = await Program.fetchIdl(programId, provider);
    if (fetchedIdl) {
      cachedIdl = fetchedIdl;
      enhancedLogger.info('✅ Loaded Squads IDL from on-chain');
      return fetchedIdl;
    }
  } catch (e) {
    enhancedLogger.warn('⚠️ Could not fetch IDL on-chain (this is expected if IDL not stored on-chain)', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  throw new Error('Unable to load Squads IDL from package or chain. Please check @sqds/multisig installation.');
}

/**
 * Finds the most likely instruction name to approve a transaction in IDL
 */
function findVaultTransactionApproveInstructionName(idl: Idl): string | null {
  // First, look for instructions containing both 'approve' and 'transaction'/'vault'/'tx'
  const candidates = idl.instructions
    ?.map((i: any) => i.name)
    .filter((name: string) => 
      /approve/i.test(name) && /(transaction|vault|tx)/i.test(name)
    ) || [];

  if (candidates.length > 0) {
    enhancedLogger.info('🔍 Found vault transaction approve instruction candidates:', candidates);
    return candidates[0];
  }

  // Broaden search: any instruction with 'approve' that might accept a transaction PDA
  const broader = idl.instructions
    ?.map((i: any) => i.name)
    .filter((n: string) => /approve/i.test(n)) || [];

  if (broader.length > 0) {
    enhancedLogger.info('🔍 Found broader approve instruction candidates:', broader);
    // Prefer ones that might be transaction-related
    const txRelated = broader.filter((n: string) => /tx|transaction/i.test(n));
    if (txRelated.length > 0) {
      return txRelated[0];
    }
    return broader[0];
  }

  return null;
}

/**
 * Initializes and logs IDL instructions (call at server startup)
 */
export async function initializeIdl(connection: Connection, programId: PublicKey): Promise<void> {
  try {
    const idl = await loadIdlOrThrow(connection, programId);
    logIdlInstructions(idl);
  } catch (error: any) {
    enhancedLogger.error('❌ Failed to initialize IDL', {
      error: error?.message || String(error),
    });
  }
}

/**
 * Logs all available instructions in the IDL for debugging
 */
export function logIdlInstructions(idl: Idl): void {
  const instructions = idl.instructions?.map((i: any) => ({
    name: i.name,
    accounts: i.accounts?.map((a: any) => a.name) || [],
  })) || [];

  enhancedLogger.info('📋 Squads IDL Instructions:', {
    total: instructions.length,
    instructions: instructions.map(i => ({
      name: i.name,
      accountCount: i.accounts.length,
    })),
    allNames: instructions.map(i => i.name),
  });

  // Log instructions with "approve" in the name
  const approveInstructions = instructions.filter((i: any) => /approve/i.test(i.name));
  if (approveInstructions.length > 0) {
    enhancedLogger.info('🔍 Approve-related instructions:', {
      count: approveInstructions.length,
      instructions: approveInstructions.map((i: any) => ({
        name: i.name,
        accounts: i.accounts,
      })),
    });
  }
}

/**
 * Builds the TransactionInstruction for vault transaction approval
 */
export async function buildVaultTransactionApproveInstruction({
  connection,
  programId,
  multisigPubkey,
  transactionPda,
  signerPubkey,
}: {
  connection: Connection;
  programId: PublicKey;
  multisigPubkey: PublicKey;
  transactionPda: PublicKey;
  signerPubkey: PublicKey;
}): Promise<{ ix: TransactionInstruction; instructionName: string; debug: any }> {
  try {
    // Load IDL
    const idl = await loadIdlOrThrow(connection, programId);
    
    // Log all instructions for debugging (first time only)
    if (!cachedIdl) {
      logIdlInstructions(idl);
    }

    // Find the instruction name
    const instructionName = findVaultTransactionApproveInstructionName(idl);
    if (!instructionName) {
      // Log all instructions to help debug
      const allNames = idl.instructions?.map((i: any) => i.name) || [];
      throw new Error(
        `No candidate "approve transaction" instruction found in Squads IDL. ` +
        `Available instructions: ${allNames.join(', ')}. ` +
        `Please inspect idl.instructions to find the correct instruction name.`
      );
    }

    enhancedLogger.info('✅ Found vault transaction approve instruction:', { instructionName });

    // Create Program wrapper to use coder
    if (!cachedProgram || cachedIdl !== idl) {
      // Use a dummy keypair for provider (Anchor requires it but we won't use it for encoding)
      const { Keypair } = require('@solana/web3.js');
      const dummyKeypair = Keypair.generate();
      const provider = new AnchorProvider(connection, { publicKey: dummyKeypair.publicKey, signTransaction: async (tx) => tx, signAllTransactions: async (txs) => txs } as any, {});
      // Program constructor: (idl, programId, provider)
      // TypeScript may have issues with overloads, so we use explicit typing
      cachedProgram = new Program<Idl>(idl as Idl, programId as PublicKey, provider as AnchorProvider) as Program<Idl>;
    }
    const program = cachedProgram;

    // Find the instruction definition in IDL
    const idlInst = idl.instructions?.find((i: any) => i.name === instructionName);
    if (!idlInst) {
      throw new Error(`Instruction ${instructionName} not found in IDL`);
    }

    const accountNames = (idlInst.accounts || []).map((a: any) => a.name);
    enhancedLogger.info('🔍 Instruction accounts:', {
      instructionName,
      accountNames,
      accountCount: accountNames.length,
    });

    // Build account map based on IDL account names
    // Common patterns in Squads: multisig, transaction/vaultTransaction, member/signer, etc.
    const accountsMap: Record<string, PublicKey> = {};
    
    for (const acc of idlInst.accounts || []) {
      const name = acc.name;
      
      if (name === 'multisig' || name === 'multisigAccount' || name === 'squad' || name === 'multisigPda') {
        accountsMap[name] = multisigPubkey;
      } else if (
        /transaction/i.test(name) || 
        /vaultTransaction/i.test(name) || 
        /tx/i.test(name) ||
        name === 'transaction' ||
        name === 'vaultTransaction'
      ) {
        accountsMap[name] = transactionPda;
      } else if (/signer|authority|member/i.test(name) || name === 'member' || name === 'signer') {
        accountsMap[name] = signerPubkey;
      } else if (/sysvarClock|clock/i.test(name) || name === 'clock') {
        accountsMap[name] = SYSVAR_CLOCK_PUBKEY;
      } else if (/systemProgram|system_program/i.test(name) || name === 'systemProgram') {
        accountsMap[name] = SystemProgram.programId;
      } else {
        enhancedLogger.warn(`⚠️ Account ${name} not auto-filled - may need manual mapping`, {
          instructionName,
          accountName: name,
        });
      }
    }

    // Prepare args (most approve instructions take zero args or a memo)
    // Check IDL for args structure
    const args: any[] = [];
    if (idlInst.args && idlInst.args.length > 0) {
      // If IDL shows args, we may need to provide them
      // Common pattern: { memo: null } or empty
      enhancedLogger.info('🔍 Instruction requires args:', {
        instructionName,
        args: idlInst.args.map((a: any) => ({ name: a.name, type: a.type })),
      });
      // For now, use empty args - adjust if needed based on IDL
    }

    // Encode instruction data bytes using Anchor's coder
    let ixData: Buffer;
    try {
      ixData = program.coder.instruction.encode(instructionName, args);
      enhancedLogger.info('✅ Encoded instruction data', {
        instructionName,
        dataLength: ixData.length,
        dataBase64: ixData.toString('base64'),
      });
    } catch (encodeError: any) {
      enhancedLogger.error('❌ Failed to encode instruction', {
        instructionName,
        args,
        error: encodeError?.message || String(encodeError),
      });
      throw new Error(`Failed to encode instruction ${instructionName}: ${encodeError?.message || String(encodeError)}`);
    }

    // Construct account metas in the same order as IDL
    const keys = (idlInst.accounts || []).map((acc: any) => {
      const pubkey = accountsMap[acc.name];
      if (!pubkey) {
        throw new Error(
          `Missing account mapping for IDL account "${acc.name}" in instruction "${instructionName}". ` +
          `Available mappings: ${Object.keys(accountsMap).join(', ')}. ` +
          `Check IDL and provide proper Pubkey for ${acc.name}.`
        );
      }

      // Determine isSigner and isWritable from IDL account structure
      // IDL accounts have isMut (writable) and isSigner flags
      const isWritable = acc.isMut !== false; // Default to writable if not specified
      const isSigner = acc.isSigner === true; // Only true if explicitly marked

      return {
        pubkey,
        isSigner,
        isWritable,
      };
    });

    const ix = new TransactionInstruction({
      keys,
      programId: programId,
      data: ixData,
    });

    enhancedLogger.info('✅ Built vault transaction approval instruction', {
      instructionName,
      programId: programId.toString(),
      accountCount: keys.length,
      accounts: keys.map(k => ({
        pubkey: k.pubkey.toString(),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
    });

    return {
      ix,
      instructionName,
      debug: {
        instructionName,
        idlInst: {
          name: idlInst.name,
          accounts: accountNames,
        },
        accountsMap: Object.keys(accountsMap),
        dataBase64: ixData.toString('base64'),
      },
    };
  } catch (error: any) {
    enhancedLogger.error('❌ Failed to build vault transaction approval instruction', {
      error: error?.message || String(error),
      stack: error?.stack,
      multisig: multisigPubkey.toString(),
      transactionPda: transactionPda.toString(),
      signer: signerPubkey.toString(),
    });
    throw error;
  }
}

