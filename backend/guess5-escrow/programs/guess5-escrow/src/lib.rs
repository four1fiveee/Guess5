use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("rnJUt7xoxQvZpPqvY5LeQ3qUYSBnYfLKa5B8K5SWh6X");

#[program]
pub mod guess5_escrow {
    use super::*;

    /// Creates a new match with escrow
    pub fn create_match(
        ctx: Context<CreateMatch>,
        stake_amount: u64,
        fee_bps: u16,
        deadline_slot: u64,
    ) -> Result<()> {
        let match_account = &mut ctx.accounts.match_account;
        let vault = &mut ctx.accounts.vault;
        
        // Validate inputs
        require!(stake_amount > 0, ErrorCode::InvalidStakeAmount);
        require!(fee_bps <= 10000, ErrorCode::InvalidFeeBps); // Max 100%
        require!(deadline_slot > Clock::get()?.slot, ErrorCode::InvalidDeadline);
        
        // Initialize match account
        match_account.player1 = ctx.accounts.player1.key();
        match_account.player2 = ctx.accounts.player2.key();
        match_account.stake_amount = stake_amount;
        match_account.fee_bps = fee_bps;
        match_account.deadline_slot = deadline_slot;
        match_account.status = MatchStatus::Created;
        match_account.result = MatchResult::Error;
        match_account.player1_deposited = 0;
        match_account.player2_deposited = 0;
        match_account.vault_bump = ctx.bumps.vault;
        
        // Initialize vault account
        vault.match_account = match_account.key();
        vault.total_deposited = 0;
        vault.bump = ctx.bumps.vault;
        
        msg!("Match created: {}", match_account.key());
        msg!("Stake amount: {}", stake_amount);
        msg!("Fee: {} bps", fee_bps);
        
        Ok(())
    }

    /// Player deposits their stake
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let match_account = &mut ctx.accounts.match_account;
        let vault = &mut ctx.accounts.vault;
        let player = &ctx.accounts.player;
        
        // Validate match state
        require!(match_account.status == MatchStatus::Created, ErrorCode::InvalidMatchStatus);
        require!(Clock::get()?.slot <= match_account.deadline_slot, ErrorCode::MatchExpired);
        
        // Validate amount
        require!(amount == match_account.stake_amount, ErrorCode::InvalidDepositAmount);
        
        // Check if this is player1 or player2
        let is_player1 = player.key() == match_account.player1;
        let is_player2 = player.key() == match_account.player2;
        require!(is_player1 || is_player2, ErrorCode::UnauthorizedPlayer);
        
        // Check if player has already deposited
        if is_player1 {
            require!(match_account.player1_deposited == 0, ErrorCode::AlreadyDeposited);
            match_account.player1_deposited = amount;
        } else {
            require!(match_account.player2_deposited == 0, ErrorCode::AlreadyDeposited);
            match_account.player2_deposited = amount;
        }
        
        // Transfer SOL to vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: player.to_account_info(),
                to: vault.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;
        
        vault.total_deposited += amount;
        
        // Check if both players have deposited
        if match_account.player1_deposited > 0 && match_account.player2_deposited > 0 {
            match_account.status = MatchStatus::Active;
            msg!("Match is now active!");
        }
        
        msg!("Player {} deposited {} lamports", player.key(), amount);
        
        Ok(())
    }

    /// Settle the match with a result
    pub fn settle_match(ctx: Context<SettleMatch>, result: MatchResult) -> Result<()> {
        let match_account = &mut ctx.accounts.match_account;
        let vault = &mut ctx.accounts.vault;
        
        // Validate match state
        require!(match_account.status == MatchStatus::Active, ErrorCode::InvalidMatchStatus);
        require!(Clock::get()?.slot <= match_account.deadline_slot, ErrorCode::MatchExpired);
        
        // Set result and status
        match_account.result = result;
        match_account.status = MatchStatus::Settled;
        
        // Calculate payouts
        let total_stake = match_account.player1_deposited + match_account.player2_deposited;
        let fee_amount = (total_stake * match_account.fee_bps as u64) / 10000;
        let net_amount = total_stake - fee_amount;
        
        match result {
            MatchResult::Player1 => {
                // Player 1 wins
                let payout = net_amount;
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: vault.to_account_info(),
                        to: ctx.accounts.player1.to_account_info(),
                    },
                );
                system_program::transfer(cpi_context, payout)?;
                
                // Transfer fee to fee wallet if specified
                if fee_amount > 0 {
                    let fee_context = CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: vault.to_account_info(),
                            to: ctx.accounts.fee_wallet.to_account_info(),
                        },
                    );
                    system_program::transfer(fee_context, fee_amount)?;
                }
            },
            MatchResult::Player2 => {
                // Player 2 wins
                let payout = net_amount;
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: vault.to_account_info(),
                        to: ctx.accounts.player2.to_account_info(),
                    },
                );
                system_program::transfer(cpi_context, payout)?;
                
                // Transfer fee to fee wallet if specified
                if fee_amount > 0 {
                    let fee_context = CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: vault.to_account_info(),
                            to: ctx.accounts.fee_wallet.to_account_info(),
                        },
                    );
                    system_program::transfer(fee_context, fee_amount)?;
                }
            },
            MatchResult::WinnerTie => {
                // Split between both players
                let payout_per_player = net_amount / 2;
                let cpi_context1 = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: vault.to_account_info(),
                        to: ctx.accounts.player1.to_account_info(),
                    },
                );
                system_program::transfer(cpi_context1, payout_per_player)?;
                
                let cpi_context2 = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: vault.to_account_info(),
                        to: ctx.accounts.player2.to_account_info(),
                    },
                );
                system_program::transfer(cpi_context2, payout_per_player)?;
                
                // Transfer fee to fee wallet if specified
                if fee_amount > 0 {
                    let fee_context = CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: vault.to_account_info(),
                            to: ctx.accounts.fee_wallet.to_account_info(),
                        },
                    );
                    system_program::transfer(fee_context, fee_amount)?;
                }
            },
            MatchResult::LosingTie => {
                // Both players lose, fee wallet gets everything
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: vault.to_account_info(),
                        to: ctx.accounts.fee_wallet.to_account_info(),
                    },
                );
                system_program::transfer(cpi_context, total_stake)?;
            },
            _ => {
                // Error or timeout - refund both players
                if match_account.player1_deposited > 0 {
                    let cpi_context = CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: vault.to_account_info(),
                            to: ctx.accounts.player1.to_account_info(),
                        },
                    );
                    system_program::transfer(cpi_context, match_account.player1_deposited)?;
                }
                
                if match_account.player2_deposited > 0 {
                    let cpi_context = CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: vault.to_account_info(),
                            to: ctx.accounts.player2.to_account_info(),
                        },
                    );
                    system_program::transfer(cpi_context, match_account.player2_deposited)?;
                }
            }
        }
        
        msg!("Match settled with result: {}", result as u8);
        
        Ok(())
    }

    /// Refund players if match times out
    pub fn refund_timeout(ctx: Context<RefundTimeout>) -> Result<()> {
        let match_account = &mut ctx.accounts.match_account;
        let vault = &mut ctx.accounts.vault;
        
        // Validate match state
        require!(match_account.status == MatchStatus::Created || match_account.status == MatchStatus::Active, ErrorCode::InvalidMatchStatus);
        require!(Clock::get()?.slot > match_account.deadline_slot, ErrorCode::MatchNotExpired);
        
        // Set status
        match_account.status = MatchStatus::Settled;
        match_account.result = MatchResult::Timeout;
        
        // Refund both players
        if match_account.player1_deposited > 0 {
            let cpi_context = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: vault.to_account_info(),
                    to: ctx.accounts.player1.to_account_info(),
                },
            );
            system_program::transfer(cpi_context, match_account.player1_deposited)?;
        }
        
        if match_account.player2_deposited > 0 {
            let cpi_context = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: vault.to_account_info(),
                    to: ctx.accounts.player2.to_account_info(),
                },
            );
            system_program::transfer(cpi_context, match_account.player2_deposited)?;
        }
        
        msg!("Match refunded due to timeout");
        
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(stake_amount: u64, fee_bps: u16, deadline_slot: u64)]
pub struct CreateMatch<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + MatchAccount::INIT_SPACE,
        seeds = [b"match", player1.key().as_ref(), player2.key().as_ref(), &stake_amount.to_le_bytes()],
        bump
    )]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(
        init,
        payer = payer,
        space = 8 + VaultAccount::INIT_SPACE,
        seeds = [b"vault", match_account.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, VaultAccount>,
    
    /// CHECK: This is the player1 (doesn't need to sign for match creation)
    pub player1: UncheckedAccount<'info>,
    
    /// CHECK: This is the player2 (doesn't need to sign)
    pub player2: UncheckedAccount<'info>,
    
    /// CHECK: This account pays for the transaction
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub vault: Account<'info, VaultAccount>,
    
    /// CHECK: This is the player making the deposit
    pub player: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleMatch<'info> {
    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub vault: Account<'info, VaultAccount>,
    
    /// CHECK: Player 1
    pub player1: UncheckedAccount<'info>,
    
    /// CHECK: Player 2
    pub player2: UncheckedAccount<'info>,
    
    /// CHECK: Fee wallet
    pub fee_wallet: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundTimeout<'info> {
    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub vault: Account<'info, VaultAccount>,
    
    /// CHECK: Player 1
    pub player1: UncheckedAccount<'info>,
    
    /// CHECK: Player 2
    pub player2: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct MatchAccount {
    pub player1: Pubkey,
    pub player2: Pubkey,
    pub stake_amount: u64,
    pub fee_bps: u16,
    pub deadline_slot: u64,
    pub status: MatchStatus,
    pub result: MatchResult,
    pub player1_deposited: u64,
    pub player2_deposited: u64,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VaultAccount {
    pub match_account: Pubkey,
    pub total_deposited: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MatchStatus {
    Created,
    Active,
    Settled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MatchResult {
    Player1,
    Player2,
    WinnerTie,
    LosingTie,
    Timeout,
    Error,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid stake amount")]
    InvalidStakeAmount,
    #[msg("Invalid fee basis points")]
    InvalidFeeBps,
    #[msg("Invalid deadline slot")]
    InvalidDeadline,
    #[msg("Invalid match status")]
    InvalidMatchStatus,
    #[msg("Match has expired")]
    MatchExpired,
    #[msg("Invalid deposit amount")]
    InvalidDepositAmount,
    #[msg("Unauthorized player")]
    UnauthorizedPlayer,
    #[msg("Player has already deposited")]
    AlreadyDeposited,
    #[msg("Match has not expired")]
    MatchNotExpired,
}