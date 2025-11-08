import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getFeeWalletKeypair } from '../config/wallet';
import { getBonusForEntryUsd } from '../config/bonusTiers';

const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';
const connection = new Connection(SOLANA_NETWORK, 'confirmed');

const toNumber = (value: any): number | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return isFinite(value) ? value : undefined;
  const parsed = Number(value);
  return isFinite(parsed) ? parsed : undefined;
};

type BonusParams = {
  matchId: string;
  winner: string;
  entryFeeSol?: number;
  entryFeeUsd?: number;
  solPriceAtTransaction?: number;
  alreadyPaid?: boolean;
  existingSignature?: string | null;
};

type BonusResult =
  | {
      triggered: false;
      success: false;
      reason: string;
    }
  | {
      triggered: true;
      success: false;
      reason: string;
      error?: string;
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
    };

export const disburseBonusIfEligible = async (params: BonusParams): Promise<BonusResult> => {
  const {
    matchId,
    winner,
    entryFeeSol,
    entryFeeUsd,
    solPriceAtTransaction,
    alreadyPaid,
    existingSignature
  } = params;

  const normalizedEntryFeeUsd = toNumber(entryFeeUsd);
  const normalizedEntryFeeSol = toNumber(entryFeeSol);
  const normalizedSolPrice =
    toNumber(solPriceAtTransaction) ||
    (normalizedEntryFeeUsd && normalizedEntryFeeSol
      ? normalizedEntryFeeUsd / normalizedEntryFeeSol
      : undefined);

  if (alreadyPaid) {
    return {
      triggered: true,
      success: false,
      reason: 'bonus_already_paid'
    };
  }

  if (existingSignature) {
    return {
      triggered: true,
      success: false,
      reason: 'bonus_signature_exists'
    };
  }

  if (!winner || winner === 'tie') {
    return {
      triggered: false,
      success: false,
      reason: 'no_winner'
    };
  }

  if (!normalizedEntryFeeUsd) {
    return {
      triggered: false,
      success: false,
      reason: 'missing_entry_fee_usd'
    };
  }

  const tierConfig = getBonusForEntryUsd(normalizedEntryFeeUsd);
  if (!tierConfig) {
    return {
      triggered: false,
      success: false,
      reason: 'below_bonus_threshold'
    };
  }

  const priceReference =
    normalizedSolPrice ||
    (normalizedEntryFeeUsd && normalizedEntryFeeSol
      ? normalizedEntryFeeUsd / normalizedEntryFeeSol
      : undefined);

  if (!priceReference || !isFinite(priceReference) || priceReference <= 0) {
    return {
      triggered: true,
      success: false,
      reason: 'missing_sol_price'
    };
  }

  const bonusSolValue = tierConfig.bonusUsd / priceReference;
  if (!isFinite(bonusSolValue) || bonusSolValue <= 0) {
    return {
      triggered: true,
      success: false,
      reason: 'invalid_bonus_conversion'
    };
  }

  const bonusLamports = Math.max(1, Math.round(bonusSolValue * LAMPORTS_PER_SOL));

  let feeWalletKeypair;
  try {
    feeWalletKeypair = getFeeWalletKeypair();
  } catch (error: any) {
    return {
      triggered: true,
      success: false,
      reason: 'fee_wallet_unavailable',
      error: error?.message || String(error)
    };
  }

  try {
    const transferIx = SystemProgram.transfer({
      fromPubkey: feeWalletKeypair.publicKey,
      toPubkey: new PublicKey(winner),
      lamports: bonusLamports
    });

    const transaction = new Transaction().add(transferIx);
    const signature = await connection.sendTransaction(transaction, [feeWalletKeypair]);
    await connection.confirmTransaction(signature, 'confirmed');

    return {
      triggered: true,
      success: true,
      signature,
      bonusUsd: tierConfig.bonusUsd,
      bonusSol: bonusLamports / LAMPORTS_PER_SOL,
      bonusPercent: tierConfig.bonusPercent,
      tierId: tierConfig.tierId,
      solPriceUsed: priceReference
    };
  } catch (error: any) {
    return {
      triggered: true,
      success: false,
      reason: 'transfer_failed',
      error: error?.message || String(error)
    };
  }
};
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getFeeWalletKeypair } from '../config/wallet';
import { enhancedLogger } from '../utils/enhancedLogger';

type BonusTier = {
  tierId: string;
  minUsd: number;
  usdTarget: number;
  bonusPercent: number;
};

const BONUS_TIERS: BonusTier[] = [
  { tierId: 'vip', minUsd: 80, usdTarget: 100, bonusPercent: 0.1 },
  { tierId: 'highRoller', minUsd: 35, usdTarget: 50, bonusPercent: 0.08 },
  { tierId: 'competitive', minUsd: 12, usdTarget: 20, bonusPercent: 0.05 }
];

const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com', 'confirmed');

export interface BonusCalculationInput {
  entryFeeSol: number;
  entryFeeUsd?: number | null;
  solPriceAtTransaction?: number | null;
}

export interface BonusCalculationResult {
  eligible: boolean;
  tierId?: string;
  bonusPercent?: number;
  bonusUsd?: number;
  bonusSol?: number;
  bonusLamports?: number;
  usdReference?: number;
  reason?: string;
}

const determineTier = (entryFeeUsd?: number | null): BonusTier | null => {
  if (entryFeeUsd == null || Number.isNaN(entryFeeUsd)) {
    return null;
  }

  for (const tier of BONUS_TIERS) {
    if (entryFeeUsd >= tier.minUsd) {
      return tier;
    }
  }
  return null;
};

export const calculateBonus = ({ entryFeeSol, entryFeeUsd, solPriceAtTransaction }: BonusCalculationInput): BonusCalculationResult => {
  const usdReference = entryFeeUsd ?? (solPriceAtTransaction && entryFeeSol ? entryFeeSol * solPriceAtTransaction : undefined);

  if (!usdReference || Number.isNaN(usdReference)) {
    return { eligible: false, reason: 'NO_USD_REFERENCE' };
  }

  const tier = determineTier(usdReference);
  if (!tier) {
    return { eligible: false, reason: 'NO_BONUS_TIER' };
  }

  const bonusUsd = usdReference * tier.bonusPercent;
  const price = solPriceAtTransaction || (entryFeeSol > 0 ? usdReference / entryFeeSol : undefined);

  if (!price || price <= 0) {
    return { eligible: false, reason: 'NO_PRICE' };
  }

  const bonusSol = bonusUsd / price;
  const bonusLamports = Math.round(bonusSol * LAMPORTS_PER_SOL);

  if (bonusLamports <= 0) {
    return { eligible: false, reason: 'BONUS_TOO_SMALL' };
  }

  return {
    eligible: true,
    tierId: tier.tierId,
    bonusPercent: tier.bonusPercent,
    bonusUsd,
    bonusSol,
    bonusLamports,
    usdReference
  };
};

export interface DisburseBonusInput {
  matchId: string;
  winner: string;
  entryFeeSol: number;
  entryFeeUsd?: number | null;
  solPriceAtTransaction?: number | null;
  alreadyPaid?: boolean;
  existingSignature?: string | null;
}

export interface DisburseBonusResult extends BonusCalculationResult {
  triggered: boolean;
  success: boolean;
  signature?: string;
}

export const disburseBonusIfEligible = async ({
  matchId,
  winner,
  entryFeeSol,
  entryFeeUsd,
  solPriceAtTransaction,
  alreadyPaid,
  existingSignature
}: DisburseBonusInput): Promise<DisburseBonusResult> => {
  if (!winner || winner === 'tie') {
    return { triggered: false, success: true, eligible: false, reason: 'NO_WINNER' };
  }

  if (alreadyPaid || existingSignature) {
    return { triggered: false, success: true, eligible: false, reason: 'ALREADY_PAID' };
  }

  const calculation = calculateBonus({ entryFeeSol, entryFeeUsd, solPriceAtTransaction });
  if (!calculation.eligible || !calculation.bonusLamports || !calculation.bonusUsd || !calculation.bonusSol || !calculation.bonusPercent) {
    return { triggered: false, success: true, ...calculation };
  }

  try {
    const feeWalletKeypair = getFeeWalletKeypair();
    const feeWalletBalance = await connection.getBalance(feeWalletKeypair.publicKey);

    if (feeWalletBalance < calculation.bonusLamports) {
      enhancedLogger.warn('âš ï¸ Fee wallet balance insufficient for bonus', {
        matchId,
        requiredLamports: calculation.bonusLamports,
        availableLamports: feeWalletBalance
      });
      return {
        triggered: true,
        success: false,
        ...calculation,
        reason: 'INSUFFICIENT_FUNDS'
      };
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: feeWalletKeypair.publicKey,
        toPubkey: new PublicKey(winner),
        lamports: calculation.bonusLamports
      })
    );

    transaction.feePayer = feeWalletKeypair.publicKey;

    const signature = await sendAndConfirmTransaction(connection, transaction, [feeWalletKeypair], {
      commitment: 'confirmed'
    });

    enhancedLogger.info('ðŸŽ Bonus payout sent', {
      matchId,
      winner,
      signature,
      bonusLamports: calculation.bonusLamports,
      bonusUsd: calculation.bonusUsd,
      bonusSol: calculation.bonusSol,
      tier: calculation.tierId,
      bonusPercent: calculation.bonusPercent
    });

    return {
      triggered: true,
      success: true,
      signature,
      ...calculation
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('âŒ Failed to send bonus payout', {
      matchId,
      winner,
      error: errorMessage
    });

    return {
      triggered: true,
      success: false,
      ...calculation,
      reason: errorMessage
    };
  }
};
