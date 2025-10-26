// @ts-nocheck
const { AppDataSource } = require('../db');
const { Match } = require('../models/Match');
const { MatchAttestation } = require('../models/MatchAttestation');
const { MatchAuditLog } = require('../models/MatchAuditLog');
const { multisigVaultService } = require('../services/multisigVaultService');
const { enhancedLogger } = require('../utils/enhancedLogger');
const { LAMPORTS_PER_SOL } = require('@solana/web3.js');

/**
 * Create a new match with multisig vault
 */
exports.createMatchHandler = async (req: any, res: any): Promise<void> => {
  try {
    const { player1Wallet, player2Wallet, entryFee } = req.body;

    if (!player1Wallet || !player2Wallet || !entryFee) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: player1Wallet, player2Wallet, entryFee',
      });
      return;
    }

    enhancedLogger.info('🎮 Creating new match with multisig vault', {
      player1Wallet,
      player2Wallet,
      entryFee,
    });

    // Create match in database
    const matchRepository = AppDataSource.getRepository(Match);
    const match = new Match();
    match.player1 = player1Wallet;
    match.player2 = player2Wallet;
    match.entryFee = entryFee;
    match.status = 'pending';
    match.matchStatus = 'PENDING';
    await matchRepository.save(match);

    // Create multisig vault
    const vaultResult = await multisigVaultService.createVault(
      match.id,
      player1Wallet,
      player2Wallet,
      entryFee
    );

    if (!vaultResult.success) {
      res.status(500).json({
        success: false,
        error: `Failed to create vault: ${vaultResult.error}`,
      });
      return;
    }

    enhancedLogger.info('✅ Match created with multisig vault', {
      matchId: match.id,
      vaultAddress: vaultResult.vaultAddress,
    });

    res.json({
      success: true,
      matchId: match.id,
      vaultAddress: vaultResult.vaultAddress,
      entryFee,
      player1Wallet,
      player2Wallet,
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Error creating match', { error: errorMessage });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

/**
 * Get match status including vault information
 */
exports.getMatchStatusHandler = async (req: any, res: any): Promise<void> => {
  try {
    const { matchId } = req.params;

    if (!matchId) {
      res.status(400).json({
        success: false,
        error: 'Missing matchId parameter',
      });
      return;
    }

    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });

    if (!match) {
      res.status(404).json({
        success: false,
        error: 'Match not found',
      });
      return;
    }

    // Check vault status if vault exists
    let vaultStatus = null;
    if (match.vaultAddress) {
      vaultStatus = await multisigVaultService.checkVaultStatus(match.vaultAddress);
    }

    res.json({
      success: true,
      match: {
        id: match.id,
        player1: match.player1,
        player2: match.player2,
        entryFee: match.entryFee,
        status: match.status,
        matchStatus: match.matchStatus,
        vaultAddress: match.vaultAddress,
        depositATx: match.depositATx,
        depositBTx: match.depositBTx,
        depositAConfirmations: match.depositAConfirmations,
        depositBConfirmations: match.depositBConfirmations,
        payoutTxHash: match.payoutTxHash,
        refundTxHash: match.refundTxHash,
        createdAt: match.createdAt,
      },
      vaultStatus,
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Error getting match status', { error: errorMessage });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

/**
 * Submit attestation for match settlement
 */
exports.submitAttestationHandler = async (req: any, res: any): Promise<void> => {
  try {
    const { matchId } = req.params;
    const attestationData: any = req.body;

    if (!matchId) {
      res.status(400).json({
        success: false,
        error: 'Missing matchId parameter',
      });
      return;
    }

    // Validate attestation data
    if (!attestationData.match_id || !attestationData.vault_address || !attestationData.nonce) {
      res.status(400).json({
        success: false,
        error: 'Invalid attestation data',
      });
      return;
    }

    enhancedLogger.info('📝 Submitting attestation for match settlement', {
      matchId,
      attestationHash: attestationData.match_id,
    });

    // Process payout based on attestation
    const payoutResult = await multisigVaultService.processPayout(attestationData);

    if (!payoutResult.success) {
      res.status(500).json({
        success: false,
        error: `Payout processing failed: ${payoutResult.error}`,
      });
      return;
    }

    enhancedLogger.info('✅ Attestation processed successfully', {
      matchId,
      payoutTxId: payoutResult.transactionId,
    });

    res.json({
      success: true,
      payoutTxId: payoutResult.transactionId,
      matchId,
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Error submitting attestation', { error: errorMessage });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

/**
 * Process refund for timeout scenarios
 */
exports.refundTimeoutHandler = async (req: any, res: any): Promise<void> => {
  try {
    const { matchId } = req.params;
    const { reason } = req.body;

    if (!matchId) {
      res.status(400).json({
        success: false,
        error: 'Missing matchId parameter',
      });
      return;
    }

    const refundReason = reason || 'TIMEOUT_REFUND';

    enhancedLogger.info('🔄 Processing timeout refund', {
      matchId,
      reason: refundReason,
    });

    // Process refund
    const refundResult = await multisigVaultService.processRefund(matchId, refundReason);

    if (!refundResult.success) {
      res.status(500).json({
        success: false,
        error: `Refund processing failed: ${refundResult.error}`,
      });
      return;
    }

    enhancedLogger.info('✅ Timeout refund processed successfully', {
      matchId,
      refundTxId: refundResult.transactionId,
    });

    res.json({
      success: true,
      refundTxId: refundResult.transactionId,
      matchId,
      reason: refundReason,
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Error processing timeout refund', { error: errorMessage });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

/**
 * Get attestations for a match
 */
exports.getAttestationsHandler = async (req: any, res: any): Promise<void> => {
  try {
    const { matchId } = req.params;

    if (!matchId) {
      res.status(400).json({
        success: false,
        error: 'Missing matchId parameter',
      });
      return;
    }

    const attestationRepository = AppDataSource.getRepository(MatchAttestation);
    const attestations = await attestationRepository.find({
      where: { matchId },
      order: { createdAt: 'DESC' },
    });

    res.json({
      success: true,
      attestations: attestations.map(att => ({
        id: att.id,
        attestationHash: att.attestationHash,
        signedByKms: att.signedByKms,
        kmsSignature: att.kmsSignature,
        createdAt: att.createdAt,
        attestationJson: att.attestationJson,
      })),
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Error getting attestations', { error: errorMessage });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

/**
 * Get audit logs for a match
 */
exports.getAuditLogsHandler = async (req: any, res: any): Promise<void> => {
  try {
    const { matchId } = req.params;

    if (!matchId) {
      res.status(400).json({
        success: false,
        error: 'Missing matchId parameter',
      });
      return;
    }

    const auditLogRepository = AppDataSource.getRepository(MatchAuditLog);
    const auditLogs = await auditLogRepository.find({
      where: { matchId },
      order: { createdAt: 'DESC' },
    });

    res.json({
      success: true,
      auditLogs: auditLogs.map(log => ({
        id: log.id,
        eventType: log.eventType,
        eventData: log.eventData,
        createdAt: log.createdAt,
      })),
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Error getting audit logs', { error: errorMessage });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

/**
 * Process deposit to vault
 */
exports.processDepositHandler = async (req: any, res: any): Promise<void> => {
  try {
    const { matchId, playerWallet, amount, depositTxSignature } = req.body;

    if (!matchId || !playerWallet || !amount) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: matchId, playerWallet, amount',
      });
      return;
    }

    enhancedLogger.info('💰 Verifying deposit to vault', {
      matchId,
      playerWallet,
      amount,
      depositTxSignature,
    });

    // Verify deposit on Solana - pass transaction signature for attribution
    const depositResult = await multisigVaultService.verifyDeposit(matchId, playerWallet, amount, depositTxSignature);

    if (!depositResult.success) {
      res.status(500).json({
        success: false,
        error: `Deposit verification failed: ${depositResult.error}`,
      });
      return;
    }

    enhancedLogger.info('✅ Deposit verified successfully', {
      matchId,
      playerWallet,
      transactionId: depositResult.transactionId,
    });

    res.json({
      success: true,
      transactionId: depositResult.transactionId,
      matchId,
      playerWallet,
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Error processing deposit', { error: errorMessage });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};
