export type BonusTier = {
  id: string;
  minEntryUsd: number;
  bonusUsd: number;
  label: string;
};

export const BONUS_TIERS: BonusTier[] = [
  {
    id: 'vip',
    minEntryUsd: 100,
    bonusUsd: 30,
    label: 'VIP Elite Boost'
  },
  {
    id: 'highRoller',
    minEntryUsd: 50,
    bonusUsd: 12,
    label: 'High Roller Boost'
  },
  {
    id: 'competitive',
    minEntryUsd: 20,
    bonusUsd: 3,
    label: 'Competitive Bonus'
  }
];

export const getBonusForEntryUsd = (entryFeeUsd?: number) => {
  if (entryFeeUsd === undefined || entryFeeUsd === null || isNaN(Number(entryFeeUsd))) {
    return null;
  }
  const normalized = Number(entryFeeUsd);
  if (!isFinite(normalized) || normalized <= 0) {
    return null;
  }
  const tier = BONUS_TIERS.find((config) => normalized >= config.minEntryUsd);
  if (!tier) {
    return null;
  }
  const bonusPercent = Math.max(0, Math.min((tier.bonusUsd / normalized) * 100, 1000));
  return {
    tierId: tier.id,
    bonusUsd: tier.bonusUsd,
    bonusPercent
  };
};

