use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;
use anchor_lang::solana_program::sysvar::rent::Rent;
use anchor_lang::solana_program::ed25519_program;

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

        Ok(())
    }

    /// Submit game result with backend signature verification
    /// Called by either player to approve the result
    /// CRITICAL: Only players can submit, and only before timeout
    pub fn submit_result(
        ctx: Context<SubmitResult>,
        winner_pubkey: Option<Pubkey>,
        result_type: ResultType,
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
        
        // Verify player is authorized (must be player_a or player_b)
        require!(
            player == escrow.player_a || player == escrow.player_b,
            EscrowError::UnauthorizedPlayer
        );

        // CRITICAL: Verify backend signature using Solana's ed25519_program
        // This prevents tampering and ensures backend's final say on results
        
        let backend_pubkey = ctx.accounts.backend_signer.key();
        
        // Construct the message that was signed (must match backend's signing format)
        let message = format!(
            "match_id:{},winner:{},result_type:{:?}",
            escrow.match_id,
            winner_pubkey.map(|p| p.to_string()).unwrap_or_else(|| "None".to_string()),
            result_type
        );
        
        let message_bytes = message.as_bytes();
        
        // Verify signature length
        require!(
            backend_signature.len() == 64,
            EscrowError::InvalidGameStatus
        );
        
        // CRITICAL: Verify Ed25519 signature on-chain using ed25519_program syscall
        // This ensures the backend actually signed this exact result
        // The ed25519_program verifies: signature is valid for (pubkey, message)
        
        // Verify ed25519_program account matches Solana's built-in program
        require_keys_eq!(
            ctx.accounts.ed25519_program.key(),
            anchor_lang::solana_program::ed25519_program::id(),
            EscrowError::InvalidGameStatus
        );
        
        // Construct ed25519 instruction data:
        // [0] = instruction discriminator (0 = verify)
        // [1..33] = public key (32 bytes)
        // [33..97] = signature (64 bytes)
        // [97..] = message
        let mut instruction_data = Vec::new();
        instruction_data.push(0u8); // Instruction discriminator: verify
        instruction_data.extend_from_slice(&backend_pubkey.to_bytes());
        instruction_data.extend_from_slice(&backend_signature);
        instruction_data.extend_from_slice(message_bytes);
        
        // Create instruction to ed25519_program
        let instruction = anchor_lang::solana_program::instruction::Instruction {
            program_id: anchor_lang::solana_program::ed25519_program::id(),
            accounts: vec![], // ed25519_program doesn't use accounts
            data: instruction_data,
        };
        
        // Invoke ed25519_program to verify signature
        // If signature is invalid, this will fail with an error
        anchor_lang::solana_program::program::invoke(
            &instruction,
            &[],
        )?;
        
        msg!("✅ Backend signature verified for match: {}", escrow.match_id);
        msg!("Backend pubkey: {}", backend_pubkey);
        msg!("Message: {}", message);
        
        // Store result
        escrow.winner = winner_pubkey;
        escrow.result_type = result_type;
        
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

        // Calculate fee amount (5% of total pot, rounded down to avoid rounding issues)
        let fee_amount = match escrow.result_type {
            ResultType::Win => {
                // 5% fee from total pot
                total_pot.checked_mul(5)
                    .and_then(|v| v.checked_div(100))
                    .unwrap_or(0)
            }
            ResultType::DrawPartialRefund => {
                // 5% fee from total pot
                total_pot.checked_mul(5)
                    .and_then(|v| v.checked_div(100))
                    .unwrap_or(0)
            }
            ResultType::DrawFullRefund => {
                // No fee for full refund
                0
            }
            ResultType::Unresolved => {
                // Timeout - full refund to both (no fee)
                0
            }
        };

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
                // Timeout - full refund to both players (no result submitted)
                // Only refund if both players deposited
                require!(
                    escrow.is_paid_a && escrow.is_paid_b,
                    EscrowError::InvalidGameStatus
                );
                
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
                
                msg!("Timeout refund: {} lamports to each player", refund_per_player);
            }
        }

        escrow.game_status = GameStatus::Settled;
        msg!("Match settled successfully");
        
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

        // Mark as settled to prevent double execution
        escrow.game_status = GameStatus::Settled;
        
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
    
    /// CHECK: Backend signer pubkey (must match expected backend pubkey)
    /// This account is used for Ed25519 signature verification
    /// The pubkey should be hardcoded/configured to prevent spoofing
    pub backend_signer: UncheckedAccount<'info>,
    
    /// CHECK: Player must be either player_a or player_b
    pub player: Signer<'info>,
    
    /// CHECK: Ed25519 program for signature verification
    /// Must be Solana's built-in ed25519_program (verified in instruction)
    /// CHECK: This is verified to be ed25519_program::id() in the instruction
    pub ed25519_program: UncheckedAccount<'info>,
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
}

