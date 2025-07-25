use anchor_lang::prelude::*;
use std::str::FromStr;

declare_id!("AdujK4E4Rme8sza8ZTrbX2HHGnde31NTUjRk5MErxf3A");

#[program]
pub mod guess5 {
    use super::*;

    pub fn init_game(ctx: Context<InitGame>, player1: Pubkey, player2: Pubkey, entry_fee: u64) -> Result<()> {
        let game = &mut ctx.accounts.game;
        game.player1 = player1;
        game.player2 = player2;
        game.entry_fee = entry_fee;
        game.status = 0;
        game.player1_solved = false;
        game.player2_solved = false;
        game.player1_guesses = 0;
        game.player2_guesses = 0;
        game.player1_time = 0;
        game.player2_time = 0;
        Ok(())
    }

    pub fn submit_result(ctx: Context<SubmitResult>, player: Pubkey, solved: bool, num_guesses: u8, total_time: u16) -> Result<()> {
        let game = &mut ctx.accounts.game;
        if player == game.player1 {
            game.player1_solved = solved;
            game.player1_guesses = num_guesses;
            game.player1_time = total_time;
        } else if player == game.player2 {
            game.player2_solved = solved;
            game.player2_guesses = num_guesses;
            game.player2_time = total_time;
        }
        Ok(())
    }

    pub fn payout(ctx: Context<Payout>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let pot = game.entry_fee * 2;
        let fee = pot / 10; // 10%
        let winner_share = pot - fee;

        let (winner, loser) = determine_winner(game);

        if let Some(winner_key) = winner {
            // Winner gets 90%, fee wallet gets 10%
            if winner_key == game.player1 {
                **ctx.accounts.player1.try_borrow_mut_lamports()? += winner_share;
            } else {
                **ctx.accounts.player2.try_borrow_mut_lamports()? += winner_share;
            }
            **ctx.accounts.fee_wallet.try_borrow_mut_lamports()? += fee;
        } else {
            // Both lose: split 90%, fee wallet gets 10%
            let split = winner_share / 2;
            **ctx.accounts.player1.try_borrow_mut_lamports()? += split;
            **ctx.accounts.player2.try_borrow_mut_lamports()? += split;
            **ctx.accounts.fee_wallet.try_borrow_mut_lamports()? += fee;
        }
        Ok(())
    }
}

// Helper function to determine winner
fn determine_winner(game: &Game) -> (Option<Pubkey>, Option<Pubkey>) {
    if game.player1_solved && !game.player2_solved {
        (Some(game.player1), Some(game.player2))
    } else if !game.player1_solved && game.player2_solved {
        (Some(game.player2), Some(game.player1))
    } else if game.player1_solved && game.player2_solved {
        // Fewer guesses wins, then less time
        if game.player1_guesses < game.player2_guesses {
            (Some(game.player1), Some(game.player2))
        } else if game.player2_guesses < game.player1_guesses {
            (Some(game.player2), Some(game.player1))
        } else if game.player1_time < game.player2_time {
            (Some(game.player1), Some(game.player2))
        } else if game.player2_time < game.player1_time {
            (Some(game.player2), Some(game.player1))
        } else {
            (None, None) // Tie or both fail
        }
    } else {
        (None, None) // Both lose
    }
}

#[account]
pub struct Game {
    pub player1: Pubkey,
    pub player2: Pubkey,
    pub entry_fee: u64,
    pub status: u8,
    pub player1_solved: bool,
    pub player2_solved: bool,
    pub player1_guesses: u8,
    pub player2_guesses: u8,
    pub player1_time: u16,
    pub player2_time: u16,
}

#[derive(Accounts)]
pub struct InitGame<'info> {
    #[account(init, payer = payer, space = 8 + 32*2 + 8 + 1 + 1*2 + 1*2 + 2*2)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitResult<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
}

#[derive(Accounts)]
pub struct Payout<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub player1: Signer<'info>,
    #[account(mut)]
    pub player2: Signer<'info>,
    /// CHECK: This is your fee wallet
    #[account(mut)]
    pub fee_wallet: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum CustomError {
    #[msg("Invalid fee wallet address.")]
    InvalidFeeWallet,
} 