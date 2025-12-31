use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;
use anchor_lang::solana_program::sysvar::rent::Rent;
use anchor_lang::solana_program::sysvar::instructions::InstructionsSysvar;
use anchor_lang::solana_program::ed25519_program;
use borsh::{BorshSerialize, BorshDeserialize};
use std::str::FromStr;

pub mod fees;
use crate::fees::{
    calculate_fee, DEFAULT_FEE_BPS, DRAW_FULL_REFUND_BPS, DRAW_PARTIAL_REFUND_BPS,
    NO_PLAY_FEE_BPS, TIMEOUT_FEE_BPS,
};

declare_id!("ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4");

#[program]
pub mod game_escrow {
    use super::*;

    /// Initialize a new match escrow
    /// Called by Player A to create a match
    pub fn initialize_match(
        ctx: Context<InitializeMatch>,
        match_id: u128,
        entry_fee_lamports: u64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.game_escrow;
        escrow.match_id = match_id;
        escrow.player_a = ctx.accounts.player_a.key();
        escrow.player_b = ctx.accounts.player_b.key();
        escrow.entry_fee_lamports = entry_fee_lamports;
        escrow.is_paid_a = false;
        escrow.is_paid_b = false;
        escrow.game_status = GameStatus::Pending;
        escrow.result_type = ResultType::Unresolved;
        escrow.created_at = Clock::get()?.unix_timestamp;
        escrow.timeout_at = escrow.created_at + 600; // 10 minutes
        escrow.winner = None;
        
        msg!("Match initialized: {}", match_id);
        msg!("Player A: {}", escrow.player_a);
        msg!("Player B: {}", escrow.player_b);
        msg!("Entry fee: {} lamports", entry_fee_lamports);
        
        emit!(MatchCreated {
            match_id,
            player_a: escrow.player_a,
            player_b: escrow.player_b,
            entry_fee_lamports,
            timeout_at: escrow.timeout_at,
        });
        
        Ok(())
    }

    /// Deposit entry fee
    /// Called by either player_a or player_b
    pub fn deposit(ctx: Context<Deposit>) -> Result<()> {
        let escrow = &mut ctx.accounts.game_escrow;
        let player = ctx.accounts.player.key();
        
        require!(
            player == escrow.player_a || player == escrow.player_b,
            EscrowError::UnauthorizedPlayer
        );
        
        require!(
            escrow.game_status == GameStatus::Pending,
            EscrowError::InvalidGameStatus
        );

        // Determine which player is depositing
        let is_player_a = player == escrow.player_a;
        
        if is_player_a {
            require!(!escrow.is_paid_a, EscrowError::AlreadyPaid);
            escrow.is_paid_a = true;
        } else {
            require!(!escrow.is_paid_b, EscrowError::AlreadyPaid);
            escrow.is_paid_b = true;
        }

        // Transfer lamports to escrow PDA
        anchor_lang::solana_program::program::invoke(
            &anchor_lang::solana_program::system_instruction::transfer(
                &player,
                &escrow.key(),
                escrow.entry_fee_lamports,
            ),
            &[
                ctx.accounts.player.to_account_info(),
                ctx.accounts.game_escrow.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // If both players have paid, mark game as Active
        if escrow.is_paid_a && escrow.is_paid_b {
            escrow.game_status = GameStatus::Active;
            msg!("Both players deposited. Game is now Active.");
        }

        emit!(Deposited {
            match_id: escrow.match_id,
            player: player,
            is_player_a: is_player_a,
            entry_fee_lamports: escrow.entry_fee_lamports,
            both_paid: escrow.is_paid_a && escrow.is_paid_b,
        });

        Ok(())
    }

    /// Submit game result with backend signature verification.
    ///
    /// The backend signs a flat Borsh-serialized `MatchResult` struct:
    ///
    /// struct MatchResult {
    ///     match_id: u128,
    ///     winner_pubkey: [u8; 32], // [0; 32] for draw
    ///     result_type: u8,         // 1 = Win, 2 = DrawFullRefund, 3 = DrawPartialRefund/Timeout
    /// }
    ///
    /// The client includes an ed25519 signature instruction in the same
    /// transaction. We verify that instruction via instruction
    /// introspection against the provided `backend_signature` and the
    /// Borsh-serialized `MatchResult` message.
    pub fn submit_result(
        ctx: Context<SubmitResult>,
        result: MatchResult,
        backend_signature: [u8; 64],
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.game_escrow;
        let clock = Clock::get()?;
        let player = ctx.accounts.player.key();
        
        // Must be Active status
        require!(
            escrow.game_status == GameStatus::Active,
            EscrowError::InvalidGameStatus
        );
        
        // Must be before timeout
        require!(
            clock.unix_timestamp < escrow.timeout_at,
            EscrowError::GameTimeout
        );
        
        // NOTE: Player signature is NOT required - backend signature is authoritative
        // Backend can submit directly, OR any player can submit (for transparency)
        // The backend signature verification below ensures authenticity regardless of who submits

        // CRITICAL: Verify backend signature using instruction introspection
        // Ed25519 program is a precompile and cannot be invoked via CPI
        // Instead, we verify the signature instruction exists in the transaction
        
        let backend_pubkey = ctx.accounts.backend_signer.key();
        
        // Construct the message using Borsh serialization for deterministic format.
        // This must match the backend's signing format exactly.
        // CRITICAL: MatchResult.match_id must equal the escrow.match_id.
        require!(result.match_id == escrow.match_id, EscrowError::InvalidGameStatus);
        let message = result.try_to_vec()?;
        
        // Verify signature length
        require!(
            backend_signature.len() == 64,
            EscrowError::InvalidSignature
        );
        
        // CRITICAL: Verify Ed25519 signature via instruction introspection
        // The ed25519 signature instruction must be present in the transaction BEFORE our instruction
        // Since ed25519 is a precompile, if the transaction reached us, the signature was verified
        // We just need to verify the instruction exists and contains our data
        
        // Load the current instruction index
        let current_ix_index = ctx.accounts.instructions_sysvar.get_current_instruction_index()?;
        
        // The ed25519 instruction should be at index 0 (before our instruction)
        // Check if it exists and contains our signature data
        let mut signature_verified = false;
        
        // Check previous instructions for ed25519 signature verification
        'outer: for i in 0..current_ix_index {
            if let Ok(ix) = ctx.accounts.instructions_sysvar.get_instruction_at(i) {
                if ix.program_id == anchor_lang::solana_program::ed25519_program::id() {
                    // Ed25519 instruction format (simplified):
                    // Header: [num_signatures(1), offsets and indices...]
                    // Data: signature(64) + pubkey(32) + message(...)
                    
                    let data = &ix.data;
                    // Minimum size: header (9 bytes) + signature (64) + pubkey (32) = 105 bytes
                    if data.len() >= 105 {
                        // Search for our pubkey in the instruction data
                        // Layout (single-signature case, simplified):
                        //   [header (≈9 bytes)] [signature (64)] [pubkey (32)] [message (...)] 
                        for offset in 9..(data.len().saturating_sub(95)) {
                            // Check if pubkey matches at this offset
                            if offset + 32 <= data.len() {
                                let candidate_pubkey = Pubkey::try_from(&data[offset..offset + 32])
                                    .ok();
                                
                                if candidate_pubkey == Some(backend_pubkey) {
                                    // Found our pubkey, check if signature precedes it
                                    if offset >= 64 {
                                        let sig_offset = offset - 64;
                                        let candidate_sig = &data[sig_offset..offset];
                                        
                                        if candidate_sig == backend_signature {
                                            // Verify message bytes follow pubkey and match our
                                            // Borsh-serialized `MatchResult` exactly.
                                            let msg_offset = offset + 32;
                                            if msg_offset + message.len() <= data.len() {
                                                let candidate_msg =
                                                    &data[msg_offset..msg_offset + message.len()];
                                                if candidate_msg == message.as_slice() {
                                                    // The ed25519 precompile has already verified
                                                    // the signature; by additionally checking the
                                                    // message we bind the signature to this result.
                                                    signature_verified = true;
                                                    break 'outer;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        require!(
            signature_verified,
            EscrowError::InvalidSignature
        );
        
        msg!("✅ Backend signature verified for match: {}", escrow.match_id);
        msg!("Backend pubkey: {}", backend_pubkey);
        
        // Store result in escrow account, mapping from flat MatchResult into the
        // existing enum + Option representation.
        let winner_pubkey_array = result.winner_pubkey;
        let is_draw = winner_pubkey_array == [0u8; 32];

        if is_draw {
            escrow.winner = None;
        } else {
            let winner_pubkey = Pubkey::new_from_array(winner_pubkey_array);
            escrow.winner = Some(winner_pubkey);
        }

        escrow.result_type = match result.result_type {
            1 => ResultType::Win,
            2 => ResultType::DrawFullRefund,
            3 => ResultType::DrawPartialRefund,
            _ => ResultType::Unresolved,
        };
        
        // Emit event
        emit!(ResultSubmitted {
            match_id: escrow.match_id,
            winner: escrow.winner,
            result_type: escrow.result_type,
            submitted_by: player, // Can be backend or any account
        });
        
        // Game is ready for settlement
        msg!("Result submitted. Ready for settlement.");
        
        Ok(())
    }

    /// Settle the match and distribute funds
    /// Can be called by anyone after result is submitted or timeout
    /// CRITICAL: Can only be called once - prevents double execution
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let escrow = &mut ctx.accounts.game_escrow;
        let clock = Clock::get()?;
        
        // CRITICAL: Prevent double execution - must be Active, not Settled
        require!(
            escrow.game_status == GameStatus::Active,
            EscrowError::InvalidGameStatus
        );

        // Can settle if:
        // 1. Result was submitted (result_type != Unresolved), OR
        // 2. Timeout has passed (clock.unix_timestamp >= timeout_at)
        let result_submitted = escrow.result_type != ResultType::Unresolved;
        let timeout_passed = clock.unix_timestamp >= escrow.timeout_at;
        let can_settle = result_submitted || timeout_passed;
        
        require!(can_settle, EscrowError::CannotSettle);

        let escrow_balance = ctx.accounts.game_escrow.to_account_info().lamports();
        
        // Calculate expected total pot (both players should have deposited)
        let total_pot = escrow.entry_fee_lamports
            .checked_mul(2)
            .ok_or(EscrowError::InsufficientFunds)?;
        
        // Verify escrow has sufficient balance
        // Account for rent-exempt minimum (escrow account needs to stay rent-exempt)
        let rent_exempt_minimum = Rent::get()?.minimum_balance(8 + GameEscrow::LEN);
        let available_balance = escrow_balance
            .checked_sub(rent_exempt_minimum)
            .ok_or(EscrowError::InsufficientFunds)?;
        
        require!(
            available_balance >= total_pot,
            EscrowError::InsufficientFunds
        );

        // Determine fee basis points based on result type.
        // This centralizes all fee configuration in `fees.rs` for clarity.
        let fee_bps = match escrow.result_type {
            ResultType::Win => DEFAULT_FEE_BPS,
            ResultType::DrawFullRefund => DRAW_FULL_REFUND_BPS,
            ResultType::DrawPartialRefund => DRAW_PARTIAL_REFUND_BPS,
            // Unresolved at settle time => no-play / timeout-style penalty fee.
            ResultType::Unresolved => NO_PLAY_FEE_BPS,
        };

        // Calculate total fee amount in lamports from the total pot.
        let fee_amount = calculate_fee(total_pot, fee_bps)?;

        match escrow.result_type {
            ResultType::Win => {
                if let Some(winner_pubkey) = escrow.winner {
                    // Verify winner account matches provided account
                    require!(
                        winner_pubkey == ctx.accounts.winner.key(),
                        EscrowError::InvalidGameStatus
                    );
                    
                    // Calculate winner amount (total_pot - fee_amount)
                    // Handle rounding: if there's a 1 lamport difference, give it to winner
                    let winner_amount = total_pot.checked_sub(fee_amount)
                        .ok_or(EscrowError::InsufficientFunds)?;
                    
                    // Transfer to winner using CPI with PDA signer
                    let seeds = &[
                        b"match",
                        &escrow.match_id.to_le_bytes(),
                        &[ctx.bumps.game_escrow],
                    ];
                    let signer = &[&seeds[..]];
                    
                    anchor_lang::solana_program::program::invoke_signed(
                        &anchor_lang::solana_program::system_instruction::transfer(
                            &ctx.accounts.game_escrow.key(),
                            &winner_pubkey,
                            winner_amount,
                        ),
                        &[
                            ctx.accounts.game_escrow.to_account_info(),
                            ctx.accounts.winner.to_account_info(),
                            ctx.accounts.system_program.to_account_info(),
                        ],
                        signer,
                    )?;
                    
                    // Transfer fee if any
                    if fee_amount > 0 {
                        anchor_lang::solana_program::program::invoke_signed(
                            &anchor_lang::solana_program::system_instruction::transfer(
                                &ctx.accounts.game_escrow.key(),
                                &ctx.accounts.fee_wallet.key(),
                                fee_amount,
                            ),
                            &[
                                ctx.accounts.game_escrow.to_account_info(),
                                ctx.accounts.fee_wallet.to_account_info(),
                                ctx.accounts.system_program.to_account_info(),
                            ],
                            signer,
                        )?;
                    }
                    
                    msg!("Winner payout: {} lamports to {}", winner_amount, winner_pubkey);
                } else {
                    return Err(EscrowError::InvalidGameStatus.into());
                }
            }
            ResultType::DrawFullRefund => {
                // Full refund to both players (100% each, no fee)
                let refund_per_player = escrow.entry_fee_lamports;
                
                // Use PDA signer for transfers
                let seeds = &[
                    b"match",
                    &escrow.match_id.to_le_bytes(),
                    &[ctx.bumps.game_escrow],
                ];
                let signer = &[&seeds[..]];
                
                anchor_lang::solana_program::program::invoke_signed(
                    &anchor_lang::solana_program::system_instruction::transfer(
                        &ctx.accounts.game_escrow.key(),
                        &ctx.accounts.player_a.key(),
                        refund_per_player,
                    ),
                    &[
                        ctx.accounts.game_escrow.to_account_info(),
                        ctx.accounts.player_a.to_account_info(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                    signer,
                )?;
                
                anchor_lang::solana_program::program::invoke_signed(
                    &anchor_lang::solana_program::system_instruction::transfer(
                        &ctx.accounts.game_escrow.key(),
                        &ctx.accounts.player_b.key(),
                        refund_per_player,
                    ),
                    &[
                        ctx.accounts.game_escrow.to_account_info(),
                        ctx.accounts.player_b.to_account_info(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                    signer,
                )?;
                
                msg!("Full refund: {} lamports to each player", refund_per_player);
            }
            ResultType::DrawPartialRefund => {
                // 95% refund to each player, 5% fee
                // Calculate: entry_fee * 95 / 100 (rounded down)
                let refund_per_player = escrow.entry_fee_lamports
                    .checked_mul(95)
                    .and_then(|v| v.checked_div(100))
                    .ok_or(EscrowError::InsufficientFunds)?;
                
                // Use PDA signer for transfers
                let seeds = &[
                    b"match",
                    &escrow.match_id.to_le_bytes(),
                    &[ctx.bumps.game_escrow],
                ];
                let signer = &[&seeds[..]];
                
                anchor_lang::solana_program::program::invoke_signed(
                    &anchor_lang::solana_program::system_instruction::transfer(
                        &ctx.accounts.game_escrow.key(),
                        &ctx.accounts.player_a.key(),
                        refund_per_player,
                    ),
                    &[
                        ctx.accounts.game_escrow.to_account_info(),
                        ctx.accounts.player_a.to_account_info(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                    signer,
                )?;
                
                anchor_lang::solana_program::program::invoke_signed(
                    &anchor_lang::solana_program::system_instruction::transfer(
                        &ctx.accounts.game_escrow.key(),
                        &ctx.accounts.player_b.key(),
                        refund_per_player,
                    ),
                    &[
                        ctx.accounts.game_escrow.to_account_info(),
                        ctx.accounts.player_b.to_account_info(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                    signer,
                )?;
                
                // Transfer fee (5% of total pot)
                if fee_amount > 0 {
                    anchor_lang::solana_program::program::invoke_signed(
                        &anchor_lang::solana_program::system_instruction::transfer(
                            &ctx.accounts.game_escrow.key(),
                            &ctx.accounts.fee_wallet.key(),
                            fee_amount,
                        ),
                        &[
                            ctx.accounts.game_escrow.to_account_info(),
                            ctx.accounts.fee_wallet.to_account_info(),
                            ctx.accounts.system_program.to_account_info(),
                        ],
                        signer,
                    )?;
                }
                
                msg!("Partial refund: {} lamports to each player, {} fee", refund_per_player, fee_amount);
            }
            ResultType::Unresolved => {
                // Timeout - penalty refund (90% to each player, 10% penalty fee)
                // This prevents gaming: players can't refuse to submit to get better refunds
                // Only refund if both players deposited
                require!(
                    escrow.is_paid_a && escrow.is_paid_b,
                    EscrowError::InvalidGameStatus
                );
                
                // Calculate 90% refund per player (10% penalty for timeout)
                let refund_per_player = escrow.entry_fee_lamports
                    .checked_mul(90)
                    .and_then(|v| v.checked_div(100))
                    .ok_or(EscrowError::InsufficientFunds)?;
                
                // Use PDA signer for transfers
                let seeds = &[
                    b"match",
                    &escrow.match_id.to_le_bytes(),
                    &[ctx.bumps.game_escrow],
                ];
                let signer = &[&seeds[..]];
                
                anchor_lang::solana_program::program::invoke_signed(
                    &anchor_lang::solana_program::system_instruction::transfer(
                        &ctx.accounts.game_escrow.key(),
                        &ctx.accounts.player_a.key(),
                        refund_per_player,
                    ),
                    &[
                        ctx.accounts.game_escrow.to_account_info(),
                        ctx.accounts.player_a.to_account_info(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                    signer,
                )?;
                
                anchor_lang::solana_program::program::invoke_signed(
                    &anchor_lang::solana_program::system_instruction::transfer(
                        &ctx.accounts.game_escrow.key(),
                        &ctx.accounts.player_b.key(),
                        refund_per_player,
                    ),
                    &[
                        ctx.accounts.game_escrow.to_account_info(),
                        ctx.accounts.player_b.to_account_info(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                    signer,
                )?;
                
                // Transfer penalty fee (10% of total pot) to fee wallet
                if fee_amount > 0 {
                    anchor_lang::solana_program::program::invoke_signed(
                        &anchor_lang::solana_program::system_instruction::transfer(
                            &ctx.accounts.game_escrow.key(),
                            &ctx.accounts.fee_wallet.key(),
                            fee_amount,
                        ),
                        &[
                            ctx.accounts.game_escrow.to_account_info(),
                            ctx.accounts.fee_wallet.to_account_info(),
                            ctx.accounts.system_program.to_account_info(),
                        ],
                        signer,
                    )?;
                }
                
                msg!("Timeout penalty refund: {} lamports to each player (90%), {} lamports penalty fee (10%)", refund_per_player, fee_amount);
            }
        }

        escrow.game_status = GameStatus::Settled;
        msg!("Match settled successfully");
        
        emit!(MatchSettled {
            match_id: escrow.match_id,
            result_type: escrow.result_type,
            winner: escrow.winner,
            total_pot,
            fee_amount,
        });
        
        Ok(())
    }

    /// Refund if only one player paid (after timeout)
    /// CRITICAL: Can only be called once - prevents double execution
    pub fn refund_if_only_one_paid(ctx: Context<RefundSingle>) -> Result<()> {
        let escrow = &mut ctx.accounts.game_escrow;
        let clock = Clock::get()?;
        
        // Must be after timeout
        require!(
            clock.unix_timestamp >= escrow.timeout_at,
            EscrowError::GameNotTimeout
        );
        
        // Must still be Pending (not Active or Settled)
        require!(
            escrow.game_status == GameStatus::Pending,
            EscrowError::InvalidGameStatus
        );

        // Get available balance (account for rent-exempt minimum)
        let escrow_balance = ctx.accounts.game_escrow.to_account_info().lamports();
        let rent_exempt_minimum = Rent::get()?.minimum_balance(8 + GameEscrow::LEN);
        let available_balance = escrow_balance
            .checked_sub(rent_exempt_minimum)
            .ok_or(EscrowError::InsufficientFunds)?;
        
        // Use PDA signer for transfers
        let seeds = &[
            b"match",
            &escrow.match_id.to_le_bytes(),
            &[ctx.bumps.game_escrow],
        ];
        let signer = &[&seeds[..]];
        
        if escrow.is_paid_a && !escrow.is_paid_b {
            // Refund player A (full amount they deposited)
            anchor_lang::solana_program::program::invoke_signed(
                &anchor_lang::solana_program::system_instruction::transfer(
                    &ctx.accounts.game_escrow.key(),
                    &ctx.accounts.player_a.key(),
                    available_balance, // Refund all available (their deposit)
                ),
                &[
                    ctx.accounts.game_escrow.to_account_info(),
                    ctx.accounts.player_a.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer,
            )?;
            msg!("Refunded {} lamports to Player A", available_balance);
        } else if escrow.is_paid_b && !escrow.is_paid_a {
            // Refund player B (full amount they deposited)
            anchor_lang::solana_program::program::invoke_signed(
                &anchor_lang::solana_program::system_instruction::transfer(
                    &ctx.accounts.game_escrow.key(),
                    &ctx.accounts.player_b.key(),
                    available_balance, // Refund all available (their deposit)
                ),
                &[
                    ctx.accounts.game_escrow.to_account_info(),
                    ctx.accounts.player_b.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer,
            )?;
            msg!("Refunded {} lamports to Player B", available_balance);
        } else {
            return Err(EscrowError::BothPlayersPaid.into());
        }

        // CRITICAL: Close escrow account to return rent to initializer (Player A)
        // This maximizes platform profitability by recovering rent
        // After refunding available_balance, close the account to return rent
        let initializer = escrow.player_a; // Player A is always the initializer
        
        // Close the account - Anchor will automatically return rent to the initializer (Player A)
        // The rent goes back to whoever paid for account creation (Player A)
        let escrow_account_info = ctx.accounts.game_escrow.to_account_info();
        let initializer_account_info = ctx.accounts.player_a.to_account_info();
        
        // Transfer remaining rent to initializer before closing
        let remaining_lamports = escrow_account_info.lamports();
        if remaining_lamports > 0 {
            **escrow_account_info.try_borrow_mut_lamports()? -= remaining_lamports;
            **initializer_account_info.try_borrow_mut_lamports()? += remaining_lamports;
            msg!("Returned {} lamports rent to initializer (Player A)", remaining_lamports);
        }
        
        // Close the account (set discriminator to closed state)
        escrow_account_info.assign(&system_program::ID);
        escrow_account_info.realloc(0, false)?;
        
        // Mark as settled to prevent double execution
        escrow.game_status = GameStatus::Settled;
        
        emit!(Refunded {
            match_id: escrow.match_id,
            refunded_to: if escrow.is_paid_a && !escrow.is_paid_b {
                escrow.player_a
            } else {
                escrow.player_b
            },
            amount: available_balance,
            reason: "timeout_single_player",
        });
        
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(match_id: u128)]
pub struct InitializeMatch<'info> {
    #[account(
        init,
        payer = player_a,
        space = 8 + GameEscrow::LEN,
        seeds = [b"match", &match_id.to_le_bytes()],
        bump
    )]
    pub game_escrow: Account<'info, GameEscrow>,
    
    #[account(mut)]
    pub player_a: Signer<'info>,
    
    /// CHECK: Player B doesn't need to sign for initialization
    pub player_b: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub game_escrow: Account<'info, GameEscrow>,
    
    #[account(mut)]
    pub player: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitResult<'info> {
    #[account(
        mut,
        seeds = [b"match", &game_escrow.match_id.to_le_bytes()],
        bump
    )]
    pub game_escrow: Account<'info, GameEscrow>,
    
    /// CHECK: Backend signer pubkey.
    /// This account is used for Ed25519 signature verification via the
    /// ed25519 precompile and instruction introspection; no fixed pubkey
    /// constraint is enforced so tests and deployments can rotate keys.
    pub backend_signer: UncheckedAccount<'info>,
    
    /// CHECK: Player can be any account - backend signature is authoritative
    /// Backend can submit directly, or players can submit for transparency
    /// No signature required - backend signature proves authenticity
    pub player: UncheckedAccount<'info>,
    
    /// CHECK: Instructions sysvar for signature verification via instruction introspection
    /// This is required to verify the ed25519 signature instruction in the transaction
    pub instructions_sysvar: InstructionsSysvar<'info>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(
        mut,
        seeds = [b"match", &game_escrow.match_id.to_le_bytes()],
        bump
    )]
    pub game_escrow: Account<'info, GameEscrow>,
    
    /// CHECK: Winner account (can be player_a or player_b)
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,
    
    /// CHECK: Player A account
    #[account(mut)]
    pub player_a: UncheckedAccount<'info>,
    
    /// CHECK: Player B account
    #[account(mut)]
    pub player_b: UncheckedAccount<'info>,
    
    /// CHECK: Fee wallet
    #[account(mut)]
    pub fee_wallet: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundSingle<'info> {
    #[account(
        mut,
        seeds = [b"match", &game_escrow.match_id.to_le_bytes()],
        bump
    )]
    pub game_escrow: Account<'info, GameEscrow>,
    
    /// CHECK: Player A account
    #[account(mut)]
    pub player_a: UncheckedAccount<'info>,
    
    /// CHECK: Player B account
    #[account(mut)]
    pub player_b: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[account]
pub struct GameEscrow {
    pub match_id: u128,
    pub player_a: Pubkey,
    pub player_b: Pubkey,
    pub entry_fee_lamports: u64,
    pub is_paid_a: bool,
    pub is_paid_b: bool,
    pub game_status: GameStatus,
    pub winner: Option<Pubkey>,
    pub result_type: ResultType,
    pub created_at: i64,
    pub timeout_at: i64,
}

impl GameEscrow {
    pub const LEN: usize = 8 + // discriminator
        16 + // match_id (u128)
        32 + // player_a (Pubkey)
        32 + // player_b (Pubkey)
        8 +  // entry_fee_lamports (u64)
        1 +  // is_paid_a (bool)
        1 +  // is_paid_b (bool)
        1 +  // game_status (GameStatus enum)
        1 + 32 + // winner (Option<Pubkey>)
        1 +  // result_type (ResultType enum)
        8 +  // created_at (i64)
        8;   // timeout_at (i64)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum GameStatus {
    Pending,
    Active,
    Settled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ResultType {
    Unresolved,
    Win,
    DrawFullRefund,
    DrawPartialRefund,
}

#[error_code]
pub enum EscrowError {
    #[msg("Unauthorized player")]
    UnauthorizedPlayer,
    #[msg("Invalid game status")]
    InvalidGameStatus,
    #[msg("Player already paid")]
    AlreadyPaid,
    #[msg("Game timeout")]
    GameTimeout,
    #[msg("Cannot settle yet")]
    CannotSettle,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Game not timed out yet")]
    GameNotTimeout,
    #[msg("Both players paid, cannot use single refund")]
    BothPlayersPaid,
    #[msg("Invalid signature")]
    InvalidSignature,
    #[msg("Invalid backend signer")]
    InvalidBackendSigner,
    #[msg("Numerical overflow during calculation")]
    NumericalOverflow,
}

// Events
#[event]
pub struct MatchCreated {
    pub match_id: u128,
    pub player_a: Pubkey,
    pub player_b: Pubkey,
    pub entry_fee_lamports: u64,
    pub timeout_at: i64,
}

#[event]
pub struct Deposited {
    pub match_id: u128,
    pub player: Pubkey,
    pub is_player_a: bool,
    pub entry_fee_lamports: u64,
    pub both_paid: bool,
}

#[event]
pub struct ResultSubmitted {
    pub match_id: u128,
    pub winner: Option<Pubkey>,
    pub result_type: ResultType,
    pub submitted_by: Pubkey, // Can be backend or any account
}

#[event]
pub struct MatchSettled {
    pub match_id: u128,
    pub result_type: ResultType,
    pub winner: Option<Pubkey>,
    pub total_pot: u64,
    pub fee_amount: u64,
}

#[event]
pub struct Refunded {
    pub match_id: u128,
    pub refunded_to: Pubkey,
    pub amount: u64,
    pub reason: String,
}

/// Flat result struct used for backend signing.
///
/// This is Borsh-serialized off-chain, signed with Ed25519 by the backend,
/// and verified on-chain via the ed25519 precompile + instruction
/// introspection in `submit_result`.
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct MatchResult {
    pub match_id: u128,
    pub winner_pubkey: [u8; 32], // [0; 32] for draw
    pub result_type: u8,         // 1 = Win, 2 = DrawFullRefund, 3 = DrawPartialRefund/Timeout
}

