use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("8v2ZyLNP5Apk17MbQxryjXuL6HHN65dxuDwRJDGARShz");

#[program]
pub mod guess5_escrow {
    use super::*;

    /// Initialize a new match escrow
    pub fn initialize_match(
        ctx: Context<InitializeMatch>,
        match_id: String,
        entry_fee: u64,
    ) -> Result<()> {
        let match_escrow = &mut ctx.accounts.match_escrow;
        
        // Initialize match data
        match_escrow.match_id = match_id;
        match_escrow.player1 = ctx.accounts.player1.key();
        match_escrow.player2 = Pubkey::default(); // Will be set when second player joins
        match_escrow.entry_fee = entry_fee;
        match_escrow.status = MatchStatus::Waiting;
        match_escrow.created_at = Clock::get()?.unix_timestamp;
        match_escrow.fee_wallet = ctx.accounts.fee_wallet.key();
        
        msg!("Match initialized: {}", match_escrow.match_id);
        Ok(())
    }

    /// Join an existing match (second player)
    pub fn join_match(
        ctx: Context<JoinMatch>,
        player2_entry_fee: u64,
    ) -> Result<()> {
        let match_escrow = &mut ctx.accounts.match_escrow;
        
        // Verify match is waiting for second player
        require!(match_escrow.status == MatchStatus::Waiting, Guess5Error::InvalidMatchStatus);
        require!(match_escrow.player2 == Pubkey::default(), Guess5Error::MatchAlreadyFull);
        
        // Use the lesser entry fee for fair wagering
        let actual_entry_fee = std::cmp::min(match_escrow.entry_fee, player2_entry_fee);
        match_escrow.entry_fee = actual_entry_fee;
        match_escrow.player2 = ctx.accounts.player2.key();
        match_escrow.status = MatchStatus::Escrow;
        
        msg!("Player 2 joined match: {}", match_escrow.match_id);
        Ok(())
    }

    /// Lock entry fee in escrow (called by each player)
    pub fn lock_entry_fee(
        ctx: Context<LockEntryFee>,
        amount: u64,
    ) -> Result<()> {
        // Get account infos before any mutable borrows
        let match_escrow_info = ctx.accounts.match_escrow.to_account_info();
        let player_info = ctx.accounts.player.to_account_info();
        let system_program_info = ctx.accounts.system_program.to_account_info();
        
        let match_escrow = &mut ctx.accounts.match_escrow;
        
        // Verify match is in escrow status
        require!(match_escrow.status == MatchStatus::Escrow, Guess5Error::InvalidMatchStatus);
        
        // Verify player is part of the match
        let player = ctx.accounts.player.key();
        require!(
            player == match_escrow.player1 || player == match_escrow.player2,
            Guess5Error::NotMatchParticipant
        );
        
        // Verify correct entry fee amount
        require!(amount == match_escrow.entry_fee, Guess5Error::IncorrectEntryFee);
        
        // Transfer SOL to escrow account
        let transfer_ctx = CpiContext::new(
            system_program_info,
            Transfer {
                from: player_info,
                to: match_escrow_info,
            },
        );
        transfer(transfer_ctx, amount)?;
        
        // Track which player has locked their fee
        if player == match_escrow.player1 {
            match_escrow.player1_locked = true;
            msg!("Player 1 locked entry fee");
        } else {
            match_escrow.player2_locked = true;
            msg!("Player 2 locked entry fee");
        }
        
        // Check if both players have locked their fees
        if match_escrow.player1_locked && match_escrow.player2_locked {
            match_escrow.status = MatchStatus::Active;
            match_escrow.game_start_time = Clock::get()?.unix_timestamp;
            msg!("Both players locked fees - game activated!");
        }
        
        Ok(())
    }

    /// Submit game result (called by each player)
    pub fn submit_result(
        ctx: Context<SubmitResult>,
        result: GameResult,
        attempts: u8,
        solved: bool,
    ) -> Result<()> {
        // Get account infos before any mutable borrows
        let match_escrow_info = ctx.accounts.match_escrow.to_account_info();
        let player1_info = ctx.accounts.player1.to_account_info();
        let player2_info = ctx.accounts.player2.to_account_info();
        let fee_wallet_info = ctx.accounts.fee_wallet.to_account_info();
        let system_program_info = ctx.accounts.system_program.to_account_info();
        
        let match_escrow = &mut ctx.accounts.match_escrow;
        
        // Verify match is active
        require!(match_escrow.status == MatchStatus::Active, Guess5Error::InvalidMatchStatus);
        
        // Verify player is part of the match
        let player = ctx.accounts.player.key();
        require!(
            player == match_escrow.player1 || player == match_escrow.player2,
            Guess5Error::NotMatchParticipant
        );
        
        // Store player's result
        if player == match_escrow.player1 {
            match_escrow.player1_result = result.clone();
            match_escrow.player1_attempts = attempts;
            match_escrow.player1_solved = solved;
            msg!("Player 1 submitted result: {:?}", result);
        } else {
            match_escrow.player2_result = result.clone();
            match_escrow.player2_attempts = attempts;
            match_escrow.player2_solved = solved;
            msg!("Player 2 submitted result: {:?}", result);
        }
        
        // Check if both players have submitted results
        if match_escrow.player1_result != GameResult::NotSubmitted && 
           match_escrow.player2_result != GameResult::NotSubmitted {
            
            // Determine winner and execute payout
            let winner = determine_winner(match_escrow);
            match_escrow.winner = winner;
            match_escrow.status = MatchStatus::Completed;
            match_escrow.completed_at = Clock::get()?.unix_timestamp;
            
            // Execute payout directly here
            let total_pot = match_escrow.entry_fee * 2; // Both players' entry fees
            let winner_amount = (total_pot * 90) / 100; // 90% to winner
            let fee_amount = (total_pot * 10) / 100; // 10% to fee wallet
            
            // Transfer to winner if there is one
            if let Some(winner) = match_escrow.winner {
                let winner_account = if winner == match_escrow.player1 {
                    player1_info
                } else {
                    player2_info
                };
                
                // Transfer to winner
                let transfer_winner_ctx = CpiContext::new(
                    system_program_info.clone(),
                    Transfer {
                        from: match_escrow_info.clone(),
                        to: winner_account,
                    },
                );
                transfer(transfer_winner_ctx, winner_amount)?;
                msg!("Transferred {} lamports to winner", winner_amount);
            }
            
            // Transfer fee to fee wallet
            let transfer_fee_ctx = CpiContext::new(
                system_program_info,
                Transfer {
                    from: match_escrow_info,
                    to: fee_wallet_info,
                },
            );
            transfer(transfer_fee_ctx, fee_amount)?;
            msg!("Transferred {} lamports to fee wallet", fee_amount);
            
            msg!("Payout completed for match: {}", match_escrow.match_id);
        }
        
        Ok(())
    }

    /// Refund both players (for ties or timeouts)
    pub fn refund_players(ctx: Context<RefundPlayers>) -> Result<()> {
        // Get account infos before any mutable borrows
        let match_escrow_info = ctx.accounts.match_escrow.to_account_info();
        let player1_info = ctx.accounts.player1.to_account_info();
        let player2_info = ctx.accounts.player2.to_account_info();
        let system_program_info = ctx.accounts.system_program.to_account_info();
        
        let match_escrow = &mut ctx.accounts.match_escrow;
        
        // Only allow refunds for completed matches or timeouts
        require!(
            match_escrow.status == MatchStatus::Completed || 
            match_escrow.status == MatchStatus::Escrow ||
            match_escrow.status == MatchStatus::Active,
            Guess5Error::InvalidMatchStatus
        );
        
        let refund_amount = match_escrow.entry_fee;
        
        // Refund player 1
        let transfer_player1_ctx = CpiContext::new(
            system_program_info.clone(),
            Transfer {
                from: match_escrow_info.clone(),
                to: player1_info,
            },
        );
        transfer(transfer_player1_ctx, refund_amount)?;
        
        // Refund player 2
        let transfer_player2_ctx = CpiContext::new(
            system_program_info,
            Transfer {
                from: match_escrow_info,
                to: player2_info,
            },
        );
        transfer(transfer_player2_ctx, refund_amount)?;
        
        match_escrow.status = MatchStatus::Refunded;
        msg!("Refunded {} lamports to each player", refund_amount);
        
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(match_id: String)]
pub struct InitializeMatch<'info> {
    #[account(
        init,
        payer = player1,
        space = 8 + MatchEscrow::INIT_SPACE,
        seeds = [b"match_escrow", match_id.as_bytes()],
        bump
    )]
    pub match_escrow: Account<'info, MatchEscrow>,
    
    #[account(mut)]
    pub player1: Signer<'info>,
    
    /// CHECK: Fee wallet for collecting platform fees
    #[account(mut)]
    pub fee_wallet: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinMatch<'info> {
    #[account(mut)]
    pub match_escrow: Account<'info, MatchEscrow>,
    
    pub player2: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LockEntryFee<'info> {
    #[account(mut)]
    pub match_escrow: Account<'info, MatchEscrow>,
    
    #[account(mut)]
    pub player: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitResult<'info> {
    #[account(mut)]
    pub match_escrow: Account<'info, MatchEscrow>,
    
    pub player: Signer<'info>,
    
    /// CHECK: Player 1 account for payout
    #[account(mut)]
    pub player1: AccountInfo<'info>,
    
    /// CHECK: Player 2 account for payout
    #[account(mut)]
    pub player2: AccountInfo<'info>,
    
    /// CHECK: Fee wallet for collecting platform fees
    #[account(mut)]
    pub fee_wallet: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundPlayers<'info> {
    #[account(mut)]
    pub match_escrow: Account<'info, MatchEscrow>,
    
    /// CHECK: Player 1 account for refund
    #[account(mut)]
    pub player1: AccountInfo<'info>,
    
    /// CHECK: Player 2 account for refund
    #[account(mut)]
    pub player2: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct MatchEscrow {
    #[max_len(50)]
    pub match_id: String,
    pub player1: Pubkey,
    pub player2: Pubkey,
    pub entry_fee: u64,
    pub status: MatchStatus,
    pub player1_locked: bool,
    pub player2_locked: bool,
    pub player1_result: GameResult,
    pub player2_result: GameResult,
    pub player1_attempts: u8,
    pub player2_attempts: u8,
    pub player1_solved: bool,
    pub player2_solved: bool,
    pub winner: Option<Pubkey>,
    pub fee_wallet: Pubkey,
    pub created_at: i64,
    pub game_start_time: i64,
    pub completed_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum MatchStatus {
    Waiting,
    Escrow,
    Active,
    Completed,
    Refunded,
}

impl anchor_lang::Space for MatchStatus {
    const INIT_SPACE: usize = 1; // 1 byte for enum discriminant
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum GameResult {
    NotSubmitted,
    Win,
    Lose,
    Tie,
}

impl anchor_lang::Space for GameResult {
    const INIT_SPACE: usize = 1; // 1 byte for enum discriminant
}

impl Default for GameResult {
    fn default() -> Self {
        GameResult::NotSubmitted
    }
}

fn determine_winner(match_escrow: &MatchEscrow) -> Option<Pubkey> {
    // If both players solved, winner is the one with fewer attempts
    if match_escrow.player1_solved && match_escrow.player2_solved {
        if match_escrow.player1_attempts < match_escrow.player2_attempts {
            Some(match_escrow.player1)
        } else if match_escrow.player2_attempts < match_escrow.player1_attempts {
            Some(match_escrow.player2)
        } else {
            None // Tie
        }
    }
    // If only one player solved, they win
    else if match_escrow.player1_solved && !match_escrow.player2_solved {
        Some(match_escrow.player1)
    } else if match_escrow.player2_solved && !match_escrow.player1_solved {
        Some(match_escrow.player2)
    }
    // If neither player solved, it's a tie
    else {
        None
    }
}

#[error_code]
pub enum Guess5Error {
    #[msg("Invalid match status")]
    InvalidMatchStatus,
    #[msg("Match is already full")]
    MatchAlreadyFull,
    #[msg("Not a match participant")]
    NotMatchParticipant,
    #[msg("Incorrect entry fee amount")]
    IncorrectEntryFee,
} 