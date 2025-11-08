import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getFeeWalletKeypair } from '../config/wallet';
import { getBonusForEntryUsd } from '../config/bonusTiers';

const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';
const connection = new Connection(SOLANA_NETWORK, 'confirmed');

const toNumber = (value: any): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
    return { triggered: true, success: false, reason: 'bonus_already_paid' };
  }

  if (existingSignature) {
    return { triggered: true, success: false, reason: 'bonus_signature_exists' };
  }

  if (!winner || winner === 'tie') {
    return { triggered: false, success: false, reason: 'no_winner' };
  }

  if (!normalizedEntryFeeUsd) {
    return { triggered: false, success: false, reason: 'missing_entry_fee_usd' };
  }

  const tierConfig = getBonusForEntryUsd(normalizedEntryFeeUsd);
  if (!tierConfig) {
    return { triggered: false, success: false, reason: 'below_bonus_threshold' };
  }

  const priceReference =
    normalizedSolPrice ||
    (normalizedEntryFeeUsd && normalizedEntryFeeSol
      ? normalizedEntryFeeUsd / normalizedEntryFeeSol
      : undefined);

  if (!priceReference || !Number.isFinite(priceReference) || priceReference <= 0) {
    return { triggered: true, success: false, reason: 'missing_sol_price' };
  }

  const bonusSolValue = tierConfig.bonusUsd / priceReference;
  if (!Number.isFinite(bonusSolValue) || bonusSolValue <= 0) {
    return { triggered: true, success: false, reason: 'invalid_bonus_conversion' };
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

