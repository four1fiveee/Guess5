import { Keypair, PublicKey } from '@solana/web3.js';
import * as ed from '@noble/ed25519';
import bs58 from 'bs58';

/**
 * Backend signing utility for escrow result verification
 * Signs match results using Ed25519 for on-chain verification
 */

export interface ResultPayload {
  match_id: string;
  winner: string | null; // Pubkey as string or null for tie
  result_type: 'Win' | 'DrawFullRefund' | 'DrawPartialRefund';
}

/**
 * Sign a match result payload using the backend private key
 * @param payload The result payload to sign
 * @param privateKey The backend private key (bs58 encoded or Uint8Array)
 * @returns The signature as a Uint8Array (64 bytes)
 */
export async function signResultPayload(
  payload: ResultPayload,
  privateKey: string | Uint8Array
): Promise<Uint8Array> {
  // Convert private key to Uint8Array if needed
  let privateKeyBytes: Uint8Array;
  if (typeof privateKey === 'string') {
    try {
      privateKeyBytes = bs58.decode(privateKey);
    } catch {
      // Try as hex string
      privateKeyBytes = new Uint8Array(
        privateKey.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
      );
    }
  } else {
    privateKeyBytes = privateKey;
  }

  // Create message to sign using Borsh serialization (matches on-chain format)
  // CRITICAL: Must match on-chain format exactly
  // Format: [match_id (u128 little-endian), winner_option (1 byte: 0=None, 1=Some), winner? (32 bytes if Some), result_type (u8)]
  
  // Convert match_id string to BigInt (u128)
  const matchIdBigInt = BigInt(payload.match_id);
  
  // Map result type to enum value (matches Rust enum)
  // 0 = Unresolved, 1 = Win, 2 = DrawFullRefund, 3 = DrawPartialRefund
  const resultTypeEnum = {
    'Win': 1,
    'DrawFullRefund': 2,
    'DrawPartialRefund': 3,
  }[payload.result_type] || 0;
  
  // Manually serialize to match Rust Borsh format exactly
  const buf = Buffer.alloc(16 + 1 + (payload.winner ? 32 : 0) + 1);
  let offset = 0;
  
  // Serialize match_id as u128 (little-endian, 16 bytes)
  const matchIdBytes = Buffer.alloc(16);
  matchIdBytes.writeBigUInt64LE(matchIdBigInt & BigInt('0xFFFFFFFFFFFFFFFF'), 0);
  matchIdBytes.writeBigUInt64LE(matchIdBigInt >> BigInt(64), 8);
  matchIdBytes.copy(buf, offset);
  offset += 16;
  
  // Serialize Option<Pubkey> - 1 byte (0=None, 1=Some) + 32 bytes if Some
  if (payload.winner) {
    buf.writeUInt8(1, offset++); // Some variant
    new PublicKey(payload.winner).toBytes().copy(buf, offset);
    offset += 32;
  } else {
    buf.writeUInt8(0, offset++); // None variant
  }
  
  // Serialize result_type as u8
  buf.writeUInt8(resultTypeEnum, offset);
  
  const messageBytes = buf;

  // Sign using Ed25519
  const signature = await ed.sign(messageBytes, privateKeyBytes.slice(0, 32));

  return signature;
}

/**
 * Verify a signature for a result payload
 * @param payload The result payload
 * @param signature The signature to verify (64 bytes)
 * @param publicKey The backend public key
 * @returns true if signature is valid
 */
export async function verifyResultSignature(
  payload: ResultPayload,
  signature: Uint8Array,
  publicKey: PublicKey | string
): Promise<boolean> {
  try {
    const publicKeyBytes =
      typeof publicKey === 'string'
        ? new PublicKey(publicKey).toBytes()
        : publicKey.toBytes();

    // CRITICAL: Must match backend signing format exactly (Borsh serialization)
    const matchIdBigInt = BigInt(payload.match_id);
    const resultTypeEnum = {
      'Win': 1,
      'DrawFullRefund': 2,
      'DrawPartialRefund': 3,
    }[payload.result_type] || 0;
    
    // Manually serialize to match Rust Borsh format exactly
    const buf = Buffer.alloc(16 + 1 + (payload.winner ? 32 : 0) + 1);
    let offset = 0;
    
    // Serialize match_id as u128 (little-endian, 16 bytes)
    const matchIdBytes = Buffer.alloc(16);
    matchIdBytes.writeBigUInt64LE(matchIdBigInt & BigInt('0xFFFFFFFFFFFFFFFF'), 0);
    matchIdBytes.writeBigUInt64LE(matchIdBigInt >> BigInt(64), 8);
    matchIdBytes.copy(buf, offset);
    offset += 16;
    
    // Serialize Option<Pubkey>
    if (payload.winner) {
      buf.writeUInt8(1, offset++);
      new PublicKey(payload.winner).toBytes().copy(buf, offset);
      offset += 32;
    } else {
      buf.writeUInt8(0, offset++);
    }
    
    // Serialize result_type as u8
    buf.writeUInt8(resultTypeEnum, offset);
    
    const messageBytes = buf;

    return await ed.verify(signature, messageBytes, publicKeyBytes);
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Get the backend signer public key from environment
 */
export function getBackendSignerPubkey(): PublicKey {
  const pubkeyStr =
    process.env.BACKEND_SIGNER_PUBKEY ||
    process.env.RESULTS_ATTESTOR_PUBKEY ||
    process.env.FEE_WALLET_ADDRESS;

  if (!pubkeyStr) {
    throw new Error(
      'BACKEND_SIGNER_PUBKEY, RESULTS_ATTESTOR_PUBKEY, or FEE_WALLET_ADDRESS must be set'
    );
  }

  return new PublicKey(pubkeyStr);
}

/**
 * Get the backend private key from environment
 */
export function getBackendSignerPrivateKey(): string {
  const privateKey =
    process.env.BACKEND_SIGNER_PRIVATE_KEY ||
    process.env.RESULTS_ATTESTOR_PRIVATE_KEY ||
    process.env.FEE_WALLET_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error(
      'BACKEND_SIGNER_PRIVATE_KEY, RESULTS_ATTESTOR_PRIVATE_KEY, or FEE_WALLET_PRIVATE_KEY must be set'
    );
  }

  return privateKey;
}

/**
 * Create a signed result for a match
 * This is what gets passed to submit_result instruction
 */
export async function createSignedResult(
  matchId: string,
  winner: string | null,
  resultType: 'Win' | 'DrawFullRefund' | 'DrawPartialRefund'
): Promise<{
  payload: ResultPayload;
  signature: Uint8Array;
  signatureBase58: string;
}> {
  const payload: ResultPayload = {
    match_id: matchId,
    winner,
    result_type: resultType,
  };

  const privateKey = getBackendSignerPrivateKey();
  const signature = await signResultPayload(payload, privateKey);

  return {
    payload,
    signature,
    signatureBase58: bs58.encode(signature),
  };
}

