import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getFeeWalletKeypair } from '../config/wallet';
import { getBonusForEntryUsd } from '../config/bonusTiers';
import { logger } from '../utils/logger';

const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';

const createConnection = () => new Connection(SOLANA_NETWORK, 'confirmed');

type BonusServiceDependencies = {
  connection: Connection;
  getFeeWalletKeypair: typeof getFeeWalletKeypair;
};

let dependencies: BonusServiceDependencies = {
  connection: createConnection(),
  getFeeWalletKeypair
};

export const setBonusServiceDependencies = (
  overrides: Partial<BonusServiceDependencies>
) => {
  dependencies = { ...dependencies, ...overrides };
};

export const resetBonusServiceDependencies = () => {
  dependencies = {
    connection: createConnection(),
    getFeeWalletKeypair
  };
};

const toNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
};

type BonusParams = {
  matchId: string;
  winner: string;
  entryFeeSol?: number;
  entryFeeUsd?: number;
  solPriceAtTransaction?: number;
  alreadyPaid?: boolean;
  existingSignature?: string | null;
  executionSignature?: string;
  executionTimestamp?: string | number | Date;
  executionSlot?: number;
};

type BonusResult =
  | {
      triggered: false;
      success: false;
      reason: string;
      executionSignature?: string;
      executionTimestamp?: string;
    }
  | {
      triggered: true;
      success: false;
      reason: string;
      error?: string;
      executionSignature?: string;
      executionTimestamp?: string;
    }
  | {
      triggered: true;
      success: true;
      signature: string;
      bonusUsd: number;
      bonusSol: number;
      bonusPercent: number;
      tierId: string;
      solPriceUsed: number;
      executionSignature: string;
      executionTimestamp: string;
    };

export const disburseBonusIfEligible = async (params: BonusParams): Promise<BonusResult> => {
  const {
    matchId,
    winner,
    entryFeeSol,
    entryFeeUsd,
    solPriceAtTransaction,
    alreadyPaid,
    existingSignature,
    executionSignature,
    executionTimestamp,
    executionSlot
  } = params;

  const normalizedEntryFeeUsd = toNumber(entryFeeUsd);
  const normalizedEntryFeeSol = toNumber(entryFeeSol);
  const normalizedSolPrice =
    toNumber(solPriceAtTransaction) ||
    (normalizedEntryFeeUsd && normalizedEntryFeeSol
      ? normalizedEntryFeeUsd / normalizedEntryFeeSol
      : undefined);

  if (alreadyPaid) {
    return { triggered: true, success: false, reason: 'bonus_already_paid' };
  }

  if (existingSignature) {
    return { triggered: true, success: false, reason: 'bonus_signature_exists' };
  }

  if (!winner || winner === 'tie') {
    logger.info('Skipping bonus payout - no eligible winner', {
      matchId,
      winner
    });
    return { triggered: false, success: false, reason: 'no_winner' };
  }

  const normalizedExecutionSignature = executionSignature?.trim();
  if (!normalizedExecutionSignature) {
    logger.warn('Bonus payout requires execution signature', { matchId, winner });
    return {
      triggered: false,
      success: false,
      reason: 'missing_execution_signature'
    };
  }

  if (executionTimestamp === undefined || executionTimestamp === null) {
    logger.warn('Bonus payout requires execution timestamp', {
      matchId,
      winner,
      executionSignature: normalizedExecutionSignature
    });
    return {
      triggered: false,
      success: false,
      reason: 'missing_execution_timestamp',
      executionSignature: normalizedExecutionSignature
    };
  }

  const parsedExecutionDate = new Date(executionTimestamp);
  if (Number.isNaN(parsedExecutionDate.getTime())) {
    logger.warn('Invalid execution timestamp provided for bonus payout', {
      matchId,
      winner,
      executionSignature: normalizedExecutionSignature,
      executionTimestamp
    });
    return {
      triggered: false,
      success: false,
      reason: 'invalid_execution_timestamp',
      executionSignature: normalizedExecutionSignature
    };
  }

  const executionTimestampIso = parsedExecutionDate.toISOString();

  if (!normalizedEntryFeeUsd) {
    logger.warn('Bonus payout skipped - missing entry fee USD reference', {
      matchId,
      winner,
      executionSignature: normalizedExecutionSignature
    });
    return {
      triggered: false,
      success: false,
      reason: 'missing_entry_fee_usd',
      executionSignature: normalizedExecutionSignature,
      executionTimestamp: executionTimestampIso
    };
  }

  const tierConfig = getBonusForEntryUsd(normalizedEntryFeeUsd);
  if (!tierConfig) {
    logger.info('Entry fee below bonus threshold', {
      matchId,
      winner,
      entryFeeUsd: normalizedEntryFeeUsd
    });
    return {
      triggered: false,
      success: false,
      reason: 'below_bonus_threshold',
      executionSignature: normalizedExecutionSignature,
      executionTimestamp: executionTimestampIso
    };
  }

  const priceReference =
    normalizedSolPrice ||
    (normalizedEntryFeeUsd && normalizedEntryFeeSol
      ? normalizedEntryFeeUsd / normalizedEntryFeeSol
      : undefined);

  if (!priceReference || !Number.isFinite(priceReference) || priceReference <= 0) {
    logger.warn('Unable to resolve SOL price for bonus payout', {
      matchId,
      winner,
      entryFeeUsd: normalizedEntryFeeUsd,
      entryFeeSol: normalizedEntryFeeSol,
      executionSignature: normalizedExecutionSignature
    });
    return {
      triggered: true,
      success: false,
      reason: 'missing_sol_price',
      executionSignature: normalizedExecutionSignature,
      executionTimestamp: executionTimestampIso
    };
  }

  const bonusSolValue = tierConfig.bonusUsd / priceReference;
  if (!Number.isFinite(bonusSolValue) || bonusSolValue <= 0) {
    logger.warn('Invalid bonus conversion computed', {
      matchId,
      winner,
      entryFeeUsd: normalizedEntryFeeUsd,
      priceReference,
      executionSignature: normalizedExecutionSignature
    });
    return {
      triggered: true,
      success: false,
      reason: 'invalid_bonus_conversion',
      executionSignature: normalizedExecutionSignature,
      executionTimestamp: executionTimestampIso
    };
  }

  const bonusLamports = Math.max(1, Math.round(bonusSolValue * LAMPORTS_PER_SOL));

  let feeWalletKeypair: ReturnType<typeof getFeeWalletKeypair>;
  try {
    feeWalletKeypair = dependencies.getFeeWalletKeypair();
  } catch (error: unknown) {
    const errorMessage = toErrorMessage(error);
    logger.error('Fee wallet unavailable for bonus payout', {
      matchId,
      winner,
      error: errorMessage
    });
    return {
      triggered: true,
      success: false,
      reason: 'fee_wallet_unavailable',
      error: errorMessage,
      executionSignature: normalizedExecutionSignature,
      executionTimestamp: executionTimestampIso
    };
  }

  try {
    logger.info('Attempting bonus payout', {
      matchId,
      winner,
      bonusUsd: tierConfig.bonusUsd,
      bonusLamports,
      executionSignature: normalizedExecutionSignature,
      executionTimestamp: executionTimestampIso,
      executionSlot
    });

    const transferIx = SystemProgram.transfer({
      fromPubkey: feeWalletKeypair.publicKey,
      toPubkey: new PublicKey(winner),
      lamports: bonusLamports
    });

    const transaction = new Transaction().add(transferIx);
    const signature = await dependencies.connection.sendTransaction(transaction, [feeWalletKeypair]);
    await dependencies.connection.confirmTransaction(signature, 'confirmed');

    logger.info('Bonus payout confirmed on-chain', {
      matchId,
      winner,
      bonusLamports,
      executionSignature: normalizedExecutionSignature,
      bonusSignature: signature
    });

    return {
      triggered: true,
      success: true,
      signature,
      bonusUsd: tierConfig.bonusUsd,
      bonusSol: bonusLamports / LAMPORTS_PER_SOL,
      bonusPercent: tierConfig.bonusPercent,
      tierId: tierConfig.tierId,
      solPriceUsed: priceReference,
      executionSignature: normalizedExecutionSignature,
      executionTimestamp: executionTimestampIso
    };
  } catch (error: unknown) {
    const errorMessage = toErrorMessage(error);
    logger.error('Bonus transfer failed', {
      matchId,
      winner,
      error: errorMessage,
      executionSignature: normalizedExecutionSignature
    });
    return {
      triggered: true,
      success: false,
      reason: 'transfer_failed',
      error: errorMessage,
      executionSignature: normalizedExecutionSignature,
      executionTimestamp: executionTimestampIso
    };
  }
};


