use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("BnATdNCmijkHo74t76djNNDqfUyzSacvrEbG94KFSVux");

// Gas fee constant: 0.0001 SOL to cover transaction costs
const GAS_FEE_LAMPORTS: u64 = 100_000; // 0.0001 SOL

#[program]
pub mod guess5_escrow {
    use super::*;

    /// Creates a new match with escrow vault
    /// Players will deposit directly into the vault PDA
    pub fn create_match(
        ctx: Context<CreateMatch>,
        stake_lamports: u64,
        fee_bps: u16,
        deadline_slot: u64,
    ) -> Result<()> {
        let match_account = &mut ctx.accounts.match_account;
        let vault = &mut ctx.accounts.vault;
        
        // Validate fee is reasonable (max 5% = 500 basis points)
        require!(fee_bps <= 500, ErrorCode::FeeTooHigh);
        
        // Validate stake amount is reasonable (min 0.001 SOL = 1,000,000 lamports)
        require!(stake_lamports >= 1_000_000, ErrorCode::StakeTooLow);
        
        // Validate deadline is in the future
        let current_slot = Clock::get()?.slot;
        require!(deadline_slot > current_slot, ErrorCode::InvalidDeadline);
        
        // Initialize match account
        match_account.player1 = ctx.accounts.player1.key();
        match_account.player2 = ctx.accounts.player2.key();
        match_account.stake_lamports = stake_lamports;
        match_account.fee_bps = fee_bps;
        match_account.deadline_slot = deadline_slot;
        match_account.fee_wallet = ctx.accounts.fee_wallet.key();
        match_account.results_attestor = ctx.accounts.results_attestor.key();
        match_account.vault = vault.key();
        match_account.status = MatchStatus::Active;
        match_account.result = None;
        match_account.created_at = Clock::get()?.unix_timestamp;
        match_account.settled_at = None;
        
        // Initialize vault account
        vault.match_account = match_account.key();
        vault.balance = 0;
        vault.player1_deposited = false;
        vault.player2_deposited = false;
        
        emit!(MatchCreated {
            match_account: match_account.key(),
            vault: vault.key(),
            player1: ctx.accounts.player1.key(),
            player2: ctx.accounts.player2.key(),
            stake_lamports,
            fee_bps,
            deadline_slot,
        });
        
        Ok(())
    }

    /// Player deposits stake into the match vault
    /// This is called by each player individually
    pub fn deposit(ctx: Context<Deposit>) -> Result<()> {
        let match_account = &ctx.accounts.match_account;
        let vault = &mut ctx.accounts.vault;
        let player = &ctx.accounts.player;
        
        // Validate match is still active
        require!(match_account.status == MatchStatus::Active, ErrorCode::MatchNotActive);
        
        // Validate deadline hasn't passed
        let current_slot = Clock::get()?.slot;
        require!(current_slot <= match_account.deadline_slot, ErrorCode::DeadlinePassed);
        
        // Validate player is part of this match
        require!(
            player.key() == match_account.player1 || player.key() == match_account.player2,
            ErrorCode::InvalidPlayer
        );
        
        // Check if this player has already deposited
        let is_player1 = player.key() == match_account.player1;
        if is_player1 {
            require!(!vault.player1_deposited, ErrorCode::AlreadyDeposited);
        } else {
            require!(!vault.player2_deposited, ErrorCode::AlreadyDeposited);
        }
        
        // Transfer stake from player to vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: player.to_account_info(),
                to: vault.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, match_account.stake_lamports)?;
        
        // Update vault state
        vault.balance += match_account.stake_lamports;
        if is_player1 {
            vault.player1_deposited = true;
        } else {
            vault.player2_deposited = true;
        }
        
        emit!(DepositMade {
            match_account: match_account.key(),
            vault: vault.key(),
            player: player.key(),
            amount: match_account.stake_lamports,
            is_player1,
        });
        
        Ok(())
    }

    /// Settles the match and distributes funds
    /// Only callable by the results attestor
    pub fn settle_match(ctx: Context<SettleMatch>, result: MatchResult) -> Result<()> {
        let match_account = &mut ctx.accounts.match_account;
        let vault = &ctx.accounts.vault;
        
        // Validate match is active and both players have deposited
        require!(match_account.status == MatchStatus::Active, ErrorCode::MatchNotActive);
        require!(vault.player1_deposited && vault.player2_deposited, ErrorCode::NotAllDeposited);
        
        // Validate deadline hasn't passed
        let current_slot = Clock::get()?.slot;
        require!(current_slot <= match_account.deadline_slot, ErrorCode::DeadlinePassed);
        
        // Validate caller is the results attestor
        require!(
            ctx.accounts.results_attestor.key() == match_account.results_attestor,
            ErrorCode::UnauthorizedAttestor
        );
        
        // Calculate payouts
        let total_pot = match_account.stake_lamports * 2;
        let fee_amount = (total_pot * match_account.fee_bps as u64) / 10000;
        let winner_amount = total_pot - fee_amount;
        
        // Update match status
        match_account.status = MatchStatus::Settled;
        match_account.result = Some(result.clone());
        match_account.settled_at = Some(Clock::get()?.unix_timestamp);
        
        // Distribute funds based on result
        match result {
            MatchResult::Player1 => {
                // Transfer winnings to player1
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: vault.to_account_info(),
                        to: ctx.accounts.player1.to_account_info(),
                    },
                );
                system_program::transfer(cpi_context, winner_amount)?;
                
                // Transfer fee to fee wallet
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: vault.to_account_info(),
                        to: ctx.accounts.fee_wallet.to_account_info(),
                    },
                );
                system_program::transfer(cpi_context, fee_amount)?;
            },
            MatchResult::Player2 => {
                // Transfer winnings to player2
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: vault.to_account_info(),
                        to: ctx.accounts.player2.to_account_info(),
                    },
                );
                system_program::transfer(cpi_context, winner_amount)?;
                
                // Transfer fee to fee wallet
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: vault.to_account_info(),
                        to: ctx.accounts.fee_wallet.to_account_info(),
                    },
                );
                system_program::transfer(cpi_context, fee_amount)?;
            },
            MatchResult::WinnerTie | MatchResult::Timeout | MatchResult::Error => {
                // Refund both players minus gas fee to cover transaction costs
                let refund_per_player = match_account.stake_lamports - GAS_FEE_LAMPORTS;
                let total_gas_fee = GAS_FEE_LAMPORTS * 2; // Gas fee from both players
                
                // Refund player1 (minus gas fee)
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: vault.to_account_info(),
                        to: ctx.accounts.player1.to_account_info(),
                    },
                );
                system_program::transfer(cpi_context, refund_per_player)?;
                
                // Refund player2 (minus gas fee)
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: vault.to_account_info(),
                        to: ctx.accounts.player2.to_account_info(),
                    },
                );
                system_program::transfer(cpi_context, refund_per_player)?;
                
                // Send gas fee to fee wallet
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: vault.to_account_info(),
                        to: ctx.accounts.fee_wallet.to_account_info(),
                    },
                );
                system_program::transfer(cpi_context, total_gas_fee)?;
            },
            MatchResult::LosingTie => {
                // Losing tie: both players get 95% back, 5% fee to platform
                let refund_per_player = match_account.stake_lamports - fee_amount;
                let total_fee = fee_amount * 2; // Fee from both players
                
                // Refund player1 (95% of their stake)
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: vault.to_account_info(),
                        to: ctx.accounts.player1.to_account_info(),
                    },
                );
                system_program::transfer(cpi_context, refund_per_player)?;
                
                // Refund player2 (95% of their stake)
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: vault.to_account_info(),
                        to: ctx.accounts.player2.to_account_info(),
                    },
                );
                system_program::transfer(cpi_context, refund_per_player)?;
                
                // Send total fee to fee wallet
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: vault.to_account_info(),
                        to: ctx.accounts.fee_wallet.to_account_info(),
                    },
                );
                system_program::transfer(cpi_context, total_fee)?;
            },
        }
        
        emit!(MatchSettled {
            match_account: match_account.key(),
            vault: vault.key(),
            result,
            winner_amount,
            fee_amount,
        });
        
        Ok(())
    }

    /// Refunds players if deadline has passed
    /// Anyone can call this to trigger automatic refunds
    pub fn refund_timeout(ctx: Context<RefundTimeout>) -> Result<()> {
        let match_account = &mut ctx.accounts.match_account;
        let vault = &ctx.accounts.vault;
        
        // Validate match is still active
        require!(match_account.status == MatchStatus::Active, ErrorCode::MatchNotActive);
        
        // Validate deadline has passed
        let current_slot = Clock::get()?.slot;
        require!(current_slot > match_account.deadline_slot, ErrorCode::DeadlineNotPassed);
        
        // Update match status
        match_account.status = MatchStatus::Refunded;
        match_account.result = Some(MatchResult::Timeout); // Mark as timeout
        match_account.settled_at = Some(Clock::get()?.unix_timestamp);
        
        // Refund both players if they deposited (minus gas fee)
        let refund_amount = match_account.stake_lamports - GAS_FEE_LAMPORTS;
        let mut total_gas_fee = 0;
        
        if vault.player1_deposited {
            let cpi_context = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: vault.to_account_info(),
                    to: ctx.accounts.player1.to_account_info(),
                },
            );
            system_program::transfer(cpi_context, refund_amount)?;
            total_gas_fee += GAS_FEE_LAMPORTS;
        }
        
        if vault.player2_deposited {
            let cpi_context = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: vault.to_account_info(),
                    to: ctx.accounts.player2.to_account_info(),
                },
            );
            system_program::transfer(cpi_context, refund_amount)?;
            total_gas_fee += GAS_FEE_LAMPORTS;
        }
        
        // Send gas fee to fee wallet if any players deposited
        if total_gas_fee > 0 {
            let cpi_context = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: vault.to_account_info(),
                    to: ctx.accounts.fee_wallet.to_account_info(),
                },
            );
            system_program::transfer(cpi_context, total_gas_fee)?;
        }
        
        emit!(MatchRefunded {
            match_account: match_account.key(),
            vault: vault.key(),
            reason: "timeout".to_string(),
        });
        
        Ok(())
    }

    /// Refunds a single player if they deposited but the other player didn't
    /// This can be called by anyone after the deadline if only one player deposited
    pub fn refund_partial_deposit(ctx: Context<RefundPartialDeposit>) -> Result<()> {
        let match_account = &mut ctx.accounts.match_account;
        let vault = &ctx.accounts.vault;
        
        // Validate match is still active
        require!(match_account.status == MatchStatus::Active, ErrorCode::MatchNotActive);
        
        // Validate deadline has passed
        let current_slot = Clock::get()?.slot;
        require!(current_slot > match_account.deadline_slot, ErrorCode::DeadlineNotPassed);
        
        // Validate only one player deposited
        let only_player1_deposited = vault.player1_deposited && !vault.player2_deposited;
        let only_player2_deposited = !vault.player1_deposited && vault.player2_deposited;
        require!(only_player1_deposited || only_player2_deposited, ErrorCode::InvalidPartialDeposit);
        
        // Update match status
        match_account.status = MatchStatus::Refunded;
        match_account.result = Some(MatchResult::Error); // Mark as error due to incomplete match
        match_account.settled_at = Some(Clock::get()?.unix_timestamp);
        
        // Refund the player who deposited
        if only_player1_deposited {
            let cpi_context = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: vault.to_account_info(),
                    to: ctx.accounts.player1.to_account_info(),
                },
            );
            system_program::transfer(cpi_context, match_account.stake_lamports)?;
        } else if only_player2_deposited {
            let cpi_context = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: vault.to_account_info(),
                    to: ctx.accounts.player2.to_account_info(),
                },
            );
            system_program::transfer(cpi_context, match_account.stake_lamports)?;
        }
        
        emit!(MatchRefunded {
            match_account: match_account.key(),
            vault: vault.key(),
            reason: "partial_deposit".to_string(),
        });
        
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(stake_lamports: u64, fee_bps: u16, deadline_slot: u64)]
pub struct CreateMatch<'info> {
    #[account(
        init,
        payer = fee_wallet,
        space = 8 + Match::INIT_SPACE,
        seeds = [b"match", player1.key().as_ref(), player2.key().as_ref(), &stake_lamports.to_le_bytes()],
        bump
    )]
    pub match_account: Account<'info, Match>,
    
    #[account(
        init,
        payer = fee_wallet,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", match_account.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    
    /// CHECK: Player 1 wallet address
    pub player1: UncheckedAccount<'info>,
    
    /// CHECK: Player 2 wallet address  
    pub player2: UncheckedAccount<'info>,
    
    /// CHECK: Results attestor (who can settle matches)
    pub results_attestor: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub fee_wallet: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub match_account: Account<'info, Match>,
    
    #[account(
        mut,
        seeds = [b"vault", match_account.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    
    #[account(mut)]
    pub player: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleMatch<'info> {
    #[account(mut)]
    pub match_account: Account<'info, Match>,
    
    #[account(
        mut,
        seeds = [b"vault", match_account.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    
    /// CHECK: Results attestor (validated in instruction)
    pub results_attestor: UncheckedAccount<'info>,
    
    /// CHECK: Player 1 wallet (for transfers)
    #[account(mut)]
    pub player1: UncheckedAccount<'info>,
    
    /// CHECK: Player 2 wallet (for transfers)
    #[account(mut)]
    pub player2: UncheckedAccount<'info>,
    
    /// CHECK: Fee wallet (for transfers)
    #[account(mut)]
    pub fee_wallet: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundTimeout<'info> {
    #[account(mut)]
    pub match_account: Account<'info, Match>,
    
    #[account(
        mut,
        seeds = [b"vault", match_account.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    
    /// CHECK: Player 1 wallet (for refunds)
    #[account(mut)]
    pub player1: UncheckedAccount<'info>,
    
    /// CHECK: Player 2 wallet (for refunds)
    #[account(mut)]
    pub player2: UncheckedAccount<'info>,
    
    /// CHECK: Fee wallet (for gas fee collection)
    #[account(mut)]
    pub fee_wallet: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundPartialDeposit<'info> {
    #[account(mut)]
    pub match_account: Account<'info, Match>,
    
    #[account(
        mut,
        seeds = [b"vault", match_account.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    
    /// CHECK: Player 1 wallet (for refunds)
    #[account(mut)]
    pub player1: UncheckedAccount<'info>,
    
    /// CHECK: Player 2 wallet (for refunds)
    #[account(mut)]
    pub player2: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Match {
    pub player1: Pubkey,
    pub player2: Pubkey,
    pub stake_lamports: u64,
    pub fee_bps: u16,
    pub deadline_slot: u64,
    pub fee_wallet: Pubkey,
    pub results_attestor: Pubkey,
    pub vault: Pubkey,
    pub status: MatchStatus,
    pub result: Option<MatchResult>,
    pub created_at: i64,
    pub settled_at: Option<i64>,
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub match_account: Pubkey,
    pub balance: u64,
    pub player1_deposited: bool,
    pub player2_deposited: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum MatchStatus {
    Active,
    Deposited,
    Settled,
    Refunded,
}

impl anchor_lang::Space for MatchStatus {
    const INIT_SPACE: usize = 1; // 1 byte for the enum discriminant
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum MatchResult {
    Player1,           // Player 1 wins
    Player2,           // Player 2 wins
    WinnerTie,         // Both players solved (winner tie - no fee)
    LosingTie,         // Neither player solved (losing tie - no fee)
    Timeout,           // Game timed out (no fee)
    Error,             // Game error/abandoned (no fee)
}

impl anchor_lang::Space for MatchResult {
    const INIT_SPACE: usize = 1; // 1 byte for the enum discriminant
}

#[event]
pub struct MatchCreated {
    pub match_account: Pubkey,
    pub vault: Pubkey,
    pub player1: Pubkey,
    pub player2: Pubkey,
    pub stake_lamports: u64,
    pub fee_bps: u16,
    pub deadline_slot: u64,
}

#[event]
pub struct DepositMade {
    pub match_account: Pubkey,
    pub vault: Pubkey,
    pub player: Pubkey,
    pub amount: u64,
    pub is_player1: bool,
}

#[event]
pub struct MatchSettled {
    pub match_account: Pubkey,
    pub vault: Pubkey,
    pub result: MatchResult,
    pub winner_amount: u64,
    pub fee_amount: u64,
}

#[event]
pub struct MatchRefunded {
    pub match_account: Pubkey,
    pub vault: Pubkey,
    pub reason: String,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Fee is too high (max 5%)")]
    FeeTooHigh,
    #[msg("Stake amount is too low (min 0.001 SOL)")]
    StakeTooLow,
    #[msg("Invalid deadline")]
    InvalidDeadline,
    #[msg("Match is not active")]
    MatchNotActive,
    #[msg("Deadline has passed")]
    DeadlinePassed,
    #[msg("Invalid player")]
    InvalidPlayer,
    #[msg("Player has already deposited")]
    AlreadyDeposited,
    #[msg("Not all players have deposited")]
    NotAllDeposited,
    #[msg("Unauthorized results attestor")]
    UnauthorizedAttestor,
    #[msg("Deadline has not passed yet")]
    DeadlineNotPassed,
    #[msg("Invalid partial deposit state")]
    InvalidPartialDeposit,
}
