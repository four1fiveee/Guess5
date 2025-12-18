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
 * Build the Borsh-serialized message for a MatchResult, matching the on-chain
 * Rust struct:
 *
 * struct MatchResult {
 *   match_id: u128,
 *   winner_pubkey: [u8; 32], // [0; 32] for draw
 *   result_type: u8,         // 1 = Win, 2 = DrawFullRefund, 3 = DrawPartialRefund/Timeout
 * }
 */
export function buildMatchResultMessage(payload: ResultPayload): Buffer {
  // Convert match_id (UUID string) to u128 using the same scheme as the
  // on-chain program: first 16 bytes of the UUID (32 hex chars) as LE u128.
  const uuidHex = payload.match_id.replace(/-/g, '');
  const matchIdHex = uuidHex.substring(0, 32);
  const matchIdBigInt = BigInt('0x' + matchIdHex);

  // Map result type to u8 (matches Rust field semantics)
  // 0 = Unresolved, 1 = Win, 2 = DrawFullRefund, 3 = DrawPartialRefund
  const resultTypeEnum = {
    Win: 1,
    DrawFullRefund: 2,
    DrawPartialRefund: 3,
  }[payload.result_type] || 0;

  // Allocate buffer: 16 (match_id) + 32 (winner_pubkey) + 1 (result_type)
  const buf = Buffer.alloc(16 + 32 + 1);
  let offset = 0;

  // Serialize match_id as u128 LE (16 bytes)
  const matchIdBytes = Buffer.alloc(16);
  matchIdBytes.writeBigUInt64LE(
    matchIdBigInt & BigInt('0xFFFFFFFFFFFFFFFF'),
    0,
  );
  matchIdBytes.writeBigUInt64LE(matchIdBigInt >> BigInt(64), 8);
  matchIdBytes.copy(buf, offset);
  offset += 16;

  // Serialize winner_pubkey as [u8; 32]; [0; 32] for draw
  if (payload.winner) {
    Buffer.from(new PublicKey(payload.winner).toBytes()).copy(buf, offset);
  } else {
    // Leave as zeros for draw (buffer is already zero-initialized)
  }
  offset += 32;

  // Serialize result_type as u8
  buf.writeUInt8(resultTypeEnum, offset);

  return buf;
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

  // Create message to sign using Borsh serialization (matches on-chain MatchResult)
  // CRITICAL: Must match on-chain format exactly.
  const messageBytes = buildMatchResultMessage(payload);

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
    const messageBytes = buildMatchResultMessage(payload);

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

