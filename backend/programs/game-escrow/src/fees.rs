use crate::EscrowError;
use anchor_lang::prelude::*;

// Fee configuration in basis points (bps)
// 1_000 bps = 10%, 500 bps = 5%, etc.

/// 5% fee for normal winning matches.
pub const DEFAULT_FEE_BPS: u64 = 500;

/// 5% fee applied on timeout draw-style outcomes.
pub const TIMEOUT_FEE_BPS: u64 = 500;

/// 5% fee for partial refund draws (95% refund).
pub const DRAW_PARTIAL_REFUND_BPS: u64 = 500;

/// 0% fee for perfect ties / full refund draws.
pub const DRAW_FULL_REFUND_BPS: u64 = 0;

/// 10% fee when both players deposited but match never resolves.
pub const NO_PLAY_FEE_BPS: u64 = 1_000;

/// Calculates fee in lamports using basis points (bps).
pub fn calculate_fee(amount: u64, bps: u64) -> Result<u64> {
    amount
        .checked_mul(bps)
        .ok_or(EscrowError::NumericalOverflow)?
        .checked_div(10_000)
        .ok_or(EscrowError::NumericalOverflow)
}


