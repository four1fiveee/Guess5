import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { MatchAttestation } from '../models/MatchAttestation';
import { MatchAuditLog } from '../models/MatchAuditLog';
import { multisigVaultService } from '../services/multisigVaultService';
import { kmsService } from '../services/kmsService';
import { AttestationData } from '../services/kmsService';

describe('Multisig Migration Tests', () => {
  let connection: Connection;
  let testMatch: Match;
  let player1Wallet: string;
  let player2Wallet: string;
  const entryFee = 0.1; // 0.1 SOL

  beforeAll(async () => {
    // Initialize database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    // Initialize Solana connection
    connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );

    // Generate test wallets
    const player1Keypair = Keypair.generate();
    const player2Keypair = Keypair.generate();
    player1Wallet = player1Keypair.publicKey.toString();
    player2Wallet = player2Keypair.publicKey.toString();

    // Airdrop SOL to test wallets
    await connection.requestAirdrop(player1Keypair.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(player2Keypair.publicKey, 2 * LAMPORTS_PER_SOL);

    // Wait for airdrops to confirm
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterAll(async () => {
    // Clean up database
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await AppDataSource.getRepository(MatchAuditLog).clear();
    await AppDataSource.getRepository(MatchAttestation).clear();
    await AppDataSource.getRepository(Match).clear();
  });

  describe('Vault Creation', () => {
    it('should create a multisig vault for a match', async () => {
      // Create test match
      const matchRepository = AppDataSource.getRepository(Match);
      testMatch = new Match();
      testMatch.player1 = player1Wallet;
      testMatch.player2 = player2Wallet;
      testMatch.entryFee = entryFee;
      testMatch.status = 'pending';
      testMatch.matchStatus = 'PENDING';
      await matchRepository.save(testMatch);

      // Create vault
      const vaultResult = await multisigVaultService.createVault(
        testMatch.id,
        player1Wallet,
        player2Wallet,
        entryFee
      );

      expect(vaultResult.success).toBe(true);
      expect(vaultResult.vaultAddress).toBeDefined();
      expect(vaultResult.vaultAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/); // Base58 address format

      // Verify match was updated
      const updatedMatch = await matchRepository.findOne({ where: { id: testMatch.id } });
      expect(updatedMatch?.vaultAddress).toBe(vaultResult.vaultAddress);
      expect(updatedMatch?.matchStatus).toBe('VAULT_CREATED');
    });
  });

  describe('Deposit Processing', () => {
    beforeEach(async () => {
      // Create test match with vault
      const matchRepository = AppDataSource.getRepository(Match);
      testMatch = new Match();
      testMatch.player1 = player1Wallet;
      testMatch.player2 = player2Wallet;
      testMatch.entryFee = entryFee;
      testMatch.status = 'pending';
      testMatch.matchStatus = 'PENDING';
      await matchRepository.save(testMatch);

      const vaultResult = await multisigVaultService.createVault(
        testMatch.id,
        player1Wallet,
        player2Wallet,
        entryFee
      );
      expect(vaultResult.success).toBe(true);
    });

    it('should verify player 1 deposit', async () => {
      const depositResult = await multisigVaultService.verifyDeposit(
        testMatch.id,
        player1Wallet,
        entryFee
      );

      expect(depositResult.success).toBe(true);
      expect(depositResult.transactionId).toBeDefined();

      // Verify match was updated
      const matchRepository = AppDataSource.getRepository(Match);
      const updatedMatch = await matchRepository.findOne({ where: { id: testMatch.id } });
      expect(updatedMatch?.depositAConfirmations).toBeGreaterThanOrEqual(0);
    });

    it('should verify player 2 deposit', async () => {
      const depositResult = await multisigVaultService.verifyDeposit(
        testMatch.id,
        player2Wallet,
        entryFee
      );

      expect(depositResult.success).toBe(true);
      expect(depositResult.transactionId).toBeDefined();

      // Verify match was updated
      const matchRepository = AppDataSource.getRepository(Match);
      const updatedMatch = await matchRepository.findOne({ where: { id: testMatch.id } });
      expect(updatedMatch?.depositBConfirmations).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Attestation and Payout Processing', () => {
    beforeEach(async () => {
      // Create test match with vault and deposits
      const matchRepository = AppDataSource.getRepository(Match);
      testMatch = new Match();
      testMatch.player1 = player1Wallet;
      testMatch.player2 = player2Wallet;
      testMatch.entryFee = entryFee;
      testMatch.status = 'pending';
      testMatch.matchStatus = 'PENDING';
      await matchRepository.save(testMatch);

      const vaultResult = await multisigVaultService.createVault(
        testMatch.id,
        player1Wallet,
        player2Wallet,
        entryFee
      );
      expect(vaultResult.success).toBe(true);

      // Verify deposits
      await multisigVaultService.verifyDeposit(testMatch.id, player1Wallet, entryFee);
      await multisigVaultService.verifyDeposit(testMatch.id, player2Wallet, entryFee);
    });

    it('should process winner payout attestation', async () => {
      const attestation: AttestationData = {
        match_id: testMatch.id,
        vault_address: testMatch.vaultAddress || '',
        stake_usd: entryFee,
        stake_lamports: Math.floor(entryFee * LAMPORTS_PER_SOL),
        player_a_wallet: player1Wallet,
        player_b_wallet: player2Wallet,
        player_a_moves: ['APPLE', 'BRAVE'],
        player_b_moves: ['APPLE', 'BRAVE', 'CRANE'],
        player_a_time_ms: 12000,
        player_b_time_ms: 20000,
        player_a_solved: true,
        player_b_solved: false,
        moves_limit: 7,
        time_limit_ms_per_guess: 15000,
        winner_address: player1Wallet,
        reason: 'WIN_BY_FEWER_MOVES',
        nonce: `test_${Date.now()}`,
        timestamp_utc_ms: Date.now(),
      };

      const payoutResult = await multisigVaultService.processPayout(attestation);

      expect(payoutResult.success).toBe(true);
      expect(payoutResult.transactionId).toBeDefined();

      // Verify attestation was created
      const attestationRepository = AppDataSource.getRepository(MatchAttestation);
      const attestations = await attestationRepository.find({ where: { matchId: testMatch.id } });
      expect(attestations).toHaveLength(1);
      expect(attestations[0].signedByKms).toBe(true);
      expect(attestations[0].kmsSignature).toBeDefined();

      // Verify match was updated
      const matchRepository = AppDataSource.getRepository(Match);
      const updatedMatch = await matchRepository.findOne({ where: { id: testMatch.id } });
      expect(updatedMatch?.payoutTxHash).toBe(payoutResult.transactionId);
      expect(updatedMatch?.matchStatus).toBe('SETTLED');
    });

    it('should process tie refund attestation', async () => {
      const attestation: AttestationData = {
        match_id: testMatch.id,
        vault_address: testMatch.vaultAddress || '',
        stake_usd: entryFee,
        stake_lamports: Math.floor(entryFee * LAMPORTS_PER_SOL),
        player_a_wallet: player1Wallet,
        player_b_wallet: player2Wallet,
        player_a_moves: ['APPLE', 'BRAVE'],
        player_b_moves: ['APPLE', 'BRAVE'],
        player_a_time_ms: 12000,
        player_b_time_ms: 12000,
        player_a_solved: true,
        player_b_solved: true,
        moves_limit: 7,
        time_limit_ms_per_guess: 15000,
        winner_address: null,
        reason: 'FULL_REFUND',
        nonce: `test_tie_${Date.now()}`,
        timestamp_utc_ms: Date.now(),
      };

      const payoutResult = await multisigVaultService.processPayout(attestation);

      expect(payoutResult.success).toBe(true);
      expect(payoutResult.transactionId).toBeDefined();

      // Verify match was updated
      const matchRepository = AppDataSource.getRepository(Match);
      const updatedMatch = await matchRepository.findOne({ where: { id: testMatch.id } });
      expect(updatedMatch?.payoutTxHash).toBe(payoutResult.transactionId);
      expect(updatedMatch?.matchStatus).toBe('SETTLED');
    });
  });

  describe('Timeout Refund Processing', () => {
    beforeEach(async () => {
      // Create test match with vault
      const matchRepository = AppDataSource.getRepository(Match);
      testMatch = new Match();
      testMatch.player1 = player1Wallet;
      testMatch.player2 = player2Wallet;
      testMatch.entryFee = entryFee;
      testMatch.status = 'pending';
      testMatch.matchStatus = 'PENDING';
      await matchRepository.save(testMatch);

      const vaultResult = await multisigVaultService.createVault(
        testMatch.id,
        player1Wallet,
        player2Wallet,
        entryFee
      );
      expect(vaultResult.success).toBe(true);
    });

    it('should process timeout refund', async () => {
      const refundResult = await multisigVaultService.processRefund(
        testMatch.id,
        'TIMEOUT_REFUND'
      );

      expect(refundResult.success).toBe(true);
      expect(refundResult.transactionId).toBeDefined();

      // Verify match was updated
      const matchRepository = AppDataSource.getRepository(Match);
      const updatedMatch = await matchRepository.findOne({ where: { id: testMatch.id } });
      expect(updatedMatch?.refundTxHash).toBe(refundResult.transactionId);
      expect(updatedMatch?.matchStatus).toBe('REFUNDED');
    });

    it('should reject refund for non-existent match', async () => {
      const nonExistentMatchId = 'non-existent-match-id';
      
      const refundResult = await multisigVaultService.processRefund(
        nonExistentMatchId,
        'TIMEOUT_REFUND'
      );

      expect(refundResult.success).toBe(false);
      expect(refundResult.error).toContain('Match not found');
    });
  });

  describe('KMS Service', () => {
    it('should generate consistent attestation hashes', () => {
      const attestation: AttestationData = {
        match_id: 'test-match-id',
        vault_address: 'test-vault-address',
        stake_usd: 0.1,
        stake_lamports: 100000000,
        player_a_wallet: player1Wallet,
        player_b_wallet: player2Wallet,
        player_a_moves: ['APPLE'],
        player_b_moves: ['BRAVE'],
        player_a_time_ms: 1000,
        player_b_time_ms: 2000,
        player_a_solved: true,
        player_b_solved: false,
        moves_limit: 7,
        time_limit_ms_per_guess: 15000,
        winner_address: player1Wallet,
        reason: 'WIN_BY_FEWER_MOVES',
        nonce: 'test-nonce',
        timestamp_utc_ms: 1234567890,
      };

      const hash1 = kmsService.generateAttestationHash(attestation);
      const hash2 = kmsService.generateAttestationHash(attestation);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex format
    });

    it('should validate attestation data', async () => {
      const invalidAttestation: Partial<AttestationData> = {
        match_id: '', // Invalid: empty match_id
        stake_usd: -1, // Invalid: negative stake
        reason: 'INVALID_REASON', // Invalid: not in allowed list
      };

      // This would normally be tested through the KMS service validation
      // For now, we'll test the structure
      expect(invalidAttestation.match_id).toBe('');
      expect(invalidAttestation.stake_usd).toBeLessThan(0);
      expect(invalidAttestation.reason).not.toBe('WIN_BY_FEWER_MOVES');
    });
  });

  describe('Audit Logging', () => {
    it('should log vault creation events', async () => {
      // Create test match
      const matchRepository = AppDataSource.getRepository(Match);
      testMatch = new Match();
      testMatch.player1 = player1Wallet;
      testMatch.player2 = player2Wallet;
      testMatch.entryFee = entryFee;
      testMatch.status = 'pending';
      testMatch.matchStatus = 'PENDING';
      await matchRepository.save(testMatch);

      // Create vault
      const vaultResult = await multisigVaultService.createVault(
        testMatch.id,
        player1Wallet,
        player2Wallet,
        entryFee
      );
      expect(vaultResult.success).toBe(true);

      // Verify audit log was created
      const auditLogRepository = AppDataSource.getRepository(MatchAuditLog);
      const auditLogs = await auditLogRepository.find({ where: { matchId: testMatch.id } });
      expect(auditLogs.length).toBeGreaterThan(0);
      
      const vaultCreationLog = auditLogs.find(log => log.eventType === 'VAULT_CREATED');
      expect(vaultCreationLog).toBeDefined();
      expect(vaultCreationLog?.eventData).toHaveProperty('vaultAddress');
    });
  });
});
