# Refund Investigation: Wallet Balance Increased After Refund

## Issue
A player's wallet balance increased after a refund:
- **Original balance:** 5 SOL
- **After refund:** 5.0401 SOL
- **Increase:** 0.0401 SOL
- **Situation:** Only one player deposited, other player backed out

## Expected Behavior
When a match is cancelled and only one player paid, the refund should return exactly the amount deposited (entry fee), minus any transaction fees.

## Current Implementation

### Smart Contract (`refund_if_only_one_paid`)
```rust
// Get available balance (account for rent-exempt minimum)
let escrow_balance = ctx.accounts.game_escrow.to_account_info().lamports();
let rent_exempt_minimum = Rent::get()?.minimum_balance(8 + GameEscrow::LEN);
let available_balance = escrow_balance
    .checked_sub(rent_exempt_minimum)
    .ok_or(EscrowError::InsufficientFunds)?;

// Refund available_balance to the player who paid
```

### Analysis
1. **Escrow Account Balance:**
   - When Player A initializes: Player A pays rent (rent_exempt_minimum)
   - When Player B deposits: Player B transfers entry_fee_lamports
   - Total escrow balance = rent_exempt_minimum + entry_fee_lamports

2. **Refund Calculation:**
   - available_balance = escrow_balance - rent_exempt_minimum
   - available_balance = (rent_exempt_minimum + entry_fee_lamports) - rent_exempt_minimum
   - available_balance = entry_fee_lamports ✓

3. **Expected Result:**
   - Player should receive exactly entry_fee_lamports back
   - No extra SOL should be refunded

## Possible Causes for Balance Increase

### 1. Rent Reimbursement (UNLIKELY)
If the escrow account is closed after refund, the rent might be returned. However:
- The escrow account is NOT closed in `refund_if_only_one_paid`
- The account remains with rent_exempt_minimum balance
- Rent is NOT refunded to the player

### 2. Transaction Fee Refund (UNLIKELY)
Solana transaction fees are typically deducted, not refunded. However:
- If the player's transaction fee was somehow refunded
- This would be a Solana network behavior, not our program

### 3. Multiple Transactions (POSSIBLE)
- Player might have received SOL from another source at the same time
- Another transaction might have completed simultaneously
- Need to check transaction history

### 4. Rounding/Precision Issues (UNLIKELY)
- Lamports are integers, no rounding issues
- The calculation is exact: available_balance = entry_fee_lamports

### 5. Bonus Payment (POSSIBLE)
- If a bonus was accidentally paid during refund
- Need to check if bonus logic is triggered for cancelled matches

### 6. Escrow Account Closure (NEEDS VERIFICATION)
- If the escrow account is closed somewhere else in the code
- The rent would be returned to the account owner (initializer)
- But this shouldn't affect the refunded player

## Investigation Steps

1. **Check Transaction History:**
   - Verify the exact refund transaction signature
   - Check if multiple transactions occurred
   - Verify the refund amount in the transaction

2. **Check Escrow Account State:**
   - Verify escrow account balance before/after refund
   - Check if escrow account was closed
   - Verify rent_exempt_minimum calculation

3. **Check Backend Logic:**
   - Verify `refundSinglePlayer` function
   - Check if any additional transfers are made
   - Verify match status updates

4. **Check for Bonus Logic:**
   - Verify if bonus is paid for cancelled matches
   - Check if bonus logic is triggered incorrectly

## Recommended Fix

If the issue is confirmed:
1. **Add Logging:**
   - Log exact refund amount
   - Log escrow balance before/after
   - Log player balance before/after

2. **Verify Refund Amount:**
   - Ensure refund is exactly entry_fee_lamports
   - Do not refund rent_exempt_minimum
   - Do not refund any additional amounts

3. **Add Validation:**
   - Verify refund amount matches entry fee
   - Add checks to prevent over-refunding
   - Log warnings if amounts don't match

## Next Steps

1. Request transaction signature from user
2. Verify on-chain transaction details
3. Check if multiple transactions occurred
4. Verify escrow account state
5. Check backend logs for the refund transaction

