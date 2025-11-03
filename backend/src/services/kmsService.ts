// @ts-ignore
// @ts-ignore
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { createHash } from 'crypto';
import { enhancedLogger } from '../utils/enhancedLogger';

export interface AttestationData {
  match_id: string;
  vault_address: string;
  stake_usd: number;
  stake_lamports: number;
  player_a_wallet: string;
  player_b_wallet: string;
  player_a_moves: string[];
  player_b_moves: string[];
  player_a_time_ms: number;
  player_b_time_ms: number;
  player_a_solved: boolean;
  player_b_solved: boolean;
  moves_limit: number;
  time_limit_ms_per_guess: number;
  winner_address: string | null;
  reason: string;
  nonce: string;
  timestamp_utc_ms: number;
}

export interface KmsSigningResult {
  success: boolean;
  signature?: string;
  error?: string;
  attestationHash?: string;
}

export class KmsService {
  private kmsClient: KMSClient;
  private keyId: string;

  constructor() {
    this.kmsClient = new KMSClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    this.keyId = process.env.KMS_KEY_ID || '';
  }

  /**
   * Generate attestation hash from attestation data
   */
  generateAttestationHash(attestation: AttestationData): string {
    const sortedJson = JSON.stringify(attestation, Object.keys(attestation).sort());
    return createHash('sha256').update(sortedJson).digest('hex');
  }

  /**
   * Sign attestation using KMS
   */
  async signAttestation(attestation: AttestationData): Promise<KmsSigningResult> {
    try {
      enhancedLogger.info('🔐 Starting KMS signing process', {
        matchId: attestation.match_id,
        vaultAddress: attestation.vault_address,
      });

      // Generate attestation hash
      const attestationHash = this.generateAttestationHash(attestation);
      
      // Validate attestation data
      const validationResult = this.validateAttestation(attestation);
      if (!validationResult.valid) {
        enhancedLogger.error('❌ Attestation validation failed', {
          matchId: attestation.match_id,
          errors: validationResult.errors,
        });
        return {
          success: false,
          error: `Attestation validation failed: ${validationResult.errors.join(', ')}`,
        };
      }

      // Create message to sign (hash + timestamp for replay protection)
      const messageToSign = Buffer.from(`${attestationHash}:${attestation.timestamp_utc_ms}`, 'utf8');

      // Sign with KMS
      const signCommand = new SignCommand({
        KeyId: this.keyId,
        Message: messageToSign,
        MessageType: 'RAW',
        SigningAlgorithm: 'ECDSA_SHA_256',
      });

      const signResult = await this.kmsClient.send(signCommand);
      
      if (!signResult.Signature) {
        throw new Error('KMS signing failed - no signature returned');
      }

      // Convert signature to hex string
      const signature = Buffer.from(signResult.Signature).toString('hex');

      enhancedLogger.info('✅ KMS signing successful', {
        matchId: attestation.match_id,
        attestationHash,
        signatureLength: signature.length,
      });

      return {
        success: true,
        signature,
        attestationHash,
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ KMS signing failed', {
        matchId: attestation.match_id,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Validate attestation data before signing
   */
  private validateAttestation(attestation: AttestationData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Required fields validation
    if (!attestation.match_id) errors.push('match_id is required');
    if (!attestation.vault_address) errors.push('vault_address is required');
    if (!attestation.player_a_wallet) errors.push('player_a_wallet is required');
    if (!attestation.player_b_wallet) errors.push('player_b_wallet is required');
    if (!attestation.nonce) errors.push('nonce is required');

    // Stake validation
    if (attestation.stake_usd <= 0) errors.push('stake_usd must be positive');
    if (attestation.stake_lamports <= 0) errors.push('stake_lamports must be positive');

    // Game data validation
    if (attestation.moves_limit <= 0) errors.push('moves_limit must be positive');
    if (attestation.time_limit_ms_per_guess <= 0) errors.push('time_limit_ms_per_guess must be positive');

    // Moves validation
    if (!Array.isArray(attestation.player_a_moves)) errors.push('player_a_moves must be an array');
    if (!Array.isArray(attestation.player_b_moves)) errors.push('player_b_moves must be an array');

    // Reason validation
    const validReasons = [
      'WIN_BY_FEWER_MOVES',
      'WIN_BY_FASTER_TIME',
      'FULL_REFUND',
      'PARTIAL_REFUND',
      'TIMEOUT_REFUND'
    ];
    if (!validReasons.includes(attestation.reason)) {
      errors.push(`Invalid reason: ${attestation.reason}`);
    }

    // Winner validation
    if (attestation.reason.includes('WIN') && !attestation.winner_address) {
      errors.push('winner_address is required for WIN scenarios');
    }

    // Time validation
    if (attestation.player_a_time_ms < 0) errors.push('player_a_time_ms must be non-negative');
    if (attestation.player_b_time_ms < 0) errors.push('player_b_time_ms must be non-negative');

    // Timestamp validation (should be recent)
    const now = Date.now();
    const timeDiff = Math.abs(now - attestation.timestamp_utc_ms);
    if (timeDiff > 5 * 60 * 1000) { // 5 minutes
      errors.push('timestamp_utc_ms is too old or in the future');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Verify signature (for testing purposes)
   */
  async verifySignature(attestation: AttestationData, signature: string): Promise<boolean> {
    try {
      const attestationHash = this.generateAttestationHash(attestation);
      const messageToSign = Buffer.from(`${attestationHash}:${attestation.timestamp_utc_ms}`, 'utf8');
      
      // This would typically use KMS VerifyCommand, but for now we'll just validate format
      return signature.length > 0 && attestationHash.length === 64;
    } catch (error) {
      enhancedLogger.error('❌ Signature verification failed', { error });
      return false;
    }
  }
}

// Export singleton instance
export const kmsService = new KmsService();
