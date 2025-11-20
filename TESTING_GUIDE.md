# Guess5.io Comprehensive Testing Guide

## Overview
This guide provides a step-by-step testing strategy for end-to-end validation of all Guess5.io features. Use this to systematically test gameplay, payments, referrals, and all related functionality.

## Pre-Testing Setup

### Required Accounts & Wallets
1. **Primary Test Wallet (Wallet A)** - Main account on Laptop 1
2. **Secondary Test Wallet (Wallet B)** - Opponent account on Laptop 2
3. **Referral Test Wallets (Wallet C, D, E)** - Create additional Phantom wallets for referral testing
4. **Admin Access** - Ensure you have access to the admin dashboard locally

### Environment Setup
- [ ] Both laptops connected to same network or accessible via production URL
- [ ] Phantom wallet installed and configured on both laptops
- [ ] Sufficient SOL balance in all test wallets (recommend 5+ SOL per wallet)
- [ ] Admin dashboard running locally (`START DASHBOARD.bat`)
- [ ] Access to Render logs for backend debugging
- [ ] Access to Vercel deployment for frontend debugging

### Test Data Preparation
- [ ] Note down all wallet addresses for reference
- [ ] Document initial SOL balances
- [ ] Clear browser cache/cookies if testing on same device
- [ ] Use incognito/private browsing for separate sessions

---

## Phase 1: Basic Gameplay & Username Testing

### Test 1.1: Username Setup
**Objective**: Verify username functionality works correctly

**Steps**:
1. Connect Wallet A on Laptop 1
2. Navigate to home page
3. Click username field in top right
4. Enter username "TestPlayer1" (3-20 chars, alphanumeric + underscore)
5. Verify username saves and displays
6. Try to enter duplicate username (should fail)
7. Try invalid usernames:
   - Too short (< 3 chars) - should fail
   - Too long (> 20 chars) - should fail
   - Special characters - should fail
8. Edit username to "TestPlayer1Updated"
9. Verify update works

**Expected Results**:
- ✅ Username saves successfully
- ✅ Duplicate username rejected
- ✅ Invalid formats rejected
- ✅ Username updates correctly
- ✅ Username persists across page refreshes

**Pass/Fail**: ☐

---

### Test 1.2: Entry Tier Selection & Validation
**Objective**: Verify entry tiers work and username requirement enforced

**Steps**:
1. Connect Wallet A without username set
2. Navigate to lobby page
3. Verify entry tiers are greyed out/disabled
4. Verify warning message appears about needing username
5. Set username
6. Verify entry tiers become enabled
7. Test each tier ($5, $20, $50, $100):
   - Verify correct entry fee displayed
   - Verify sufficient balance check works
   - Try with insufficient balance (should disable tier)

**Expected Results**:
- ✅ Tiers disabled without username
- ✅ Warning message displayed
- ✅ Tiers enabled after username set
- ✅ Correct fees displayed
- ✅ Insufficient balance disables tiers

**Pass/Fail**: ☐

---

### Test 1.3: Matchmaking Flow
**Objective**: Verify complete matchmaking and gameplay flow

**Steps**:
1. **Laptop 1 (Wallet A)**:
   - Connect wallet, set username "PlayerA"
   - Navigate to lobby
   - Select $20 tier
   - Click "Enter Queue"
   - Verify "Searching for opponent..." message

2. **Laptop 2 (Wallet B)**:
   - Connect wallet, set username "PlayerB"
   - Navigate to lobby
   - Select $20 tier
   - Click "Enter Queue"

3. **Both Laptops**:
   - Wait for match found notification
   - Verify opponent username displays correctly
   - Verify both players see match details
   - Verify deposit transaction prompts appear
   - Sign deposit transactions on both wallets

4. **After Deposits**:
   - Verify "Waiting for opponent..." message
   - Verify match starts when both deposits confirmed
   - Verify game interface loads correctly

**Expected Results**:
- ✅ Match found notification appears
- ✅ Opponent username displays correctly
- ✅ Deposit transactions prompt correctly
- ✅ Match starts after both deposits
- ✅ Game interface loads properly

**Pass/Fail**: ☐

---

### Test 1.4: Gameplay & Results
**Objective**: Verify game mechanics and result calculation

**Steps**:
1. Complete a match (one player wins)
2. Verify:
   - Game timer works
   - Guess submission works
   - Feedback on guesses (correct/incorrect positions)
   - Win/loss detection
   - Result screen displays correctly
3. Verify winner receives:
   - Correct payout amount
   - Transaction signature displayed
   - SOL balance updated
4. Verify loser:
   - Loses entry fee
   - Sees loss message
   - Balance updated correctly

**Expected Results**:
- ✅ Game mechanics work correctly
- ✅ Winner receives correct payout
- ✅ Loser loses entry fee
- ✅ Balances update correctly
- ✅ Transaction signatures visible

**Pass/Fail**: ☐

---

## Phase 2: Payment & Bonus Testing

### Test 2.1: Platform Fee Collection
**Objective**: Verify platform fees are collected correctly

**Steps**:
1. Note initial balance of fee wallet (check admin dashboard or blockchain explorer)
2. Complete a $20 match
3. Calculate expected fee: $20 × 2 = $40 total pot × 5% = $2.00 fee
4. Verify fee wallet balance increased by ~$2.00 (in SOL equivalent)
5. Check transaction on Solscan for fee wallet
6. Repeat for different tiers ($5, $50, $100)

**Expected Results**:
- ✅ Platform fee calculated correctly (5% of total pot)
- ✅ Fee sent to correct fee wallet
- ✅ Fee visible in transaction history
- ✅ Works across all tiers

**Pass/Fail**: ☐

---

### Test 2.2: Bonus Payments
**Objective**: Verify bonus payments work for eligible tiers

**Steps**:
1. Complete a $20 match (should get $0.25 bonus)
2. Verify bonus transaction appears
3. Check bonus signature in match data
4. Verify bonus amount correct
5. Test $50 tier ($0.75 bonus)
6. Test $100 tier ($2.00 bonus)
7. Test $5 tier (no bonus)
8. Verify bonus paid to winner only
9. Check admin dashboard shows bonus data

**Expected Results**:
- ✅ Bonuses paid correctly per tier
- ✅ Bonus signatures recorded
- ✅ No bonus for $5 tier
- ✅ Bonus paid to winner only
- ✅ Admin dashboard shows bonus data

**Pass/Fail**: ☐

---

### Test 2.3: Squads Vault & Multisig
**Objective**: Verify funds held in Squads vault correctly

**Steps**:
1. Start a match
2. Note Squads vault address from match data
3. Verify vault address is valid Solana address
4. Check vault holds correct amount (total pot)
5. After match completion, verify:
   - Winner receives payout
   - Vault releases funds correctly
   - Transaction signatures recorded

**Expected Results**:
- ✅ Vault address valid
- ✅ Vault holds correct amount
- ✅ Funds release correctly after match
- ✅ Transaction signatures recorded

**Pass/Fail**: ☐

---

## Phase 3: Referral System Testing

### Test 3.1: Referral Link Creation & Tracking
**Objective**: Verify referral links work and track correctly

**Steps**:
1. **Setup Referral Chain**:
   - Wallet A refers Wallet C (L1)
   - Wallet C refers Wallet D (L2)
   - Wallet D refers Wallet E (L3)

2. **Create Referral Links**:
   - Connect Wallet A
   - Navigate to `/referrals` page
   - Copy referral link
   - Verify link format: `https://guess5.io?ref=<WalletA>`

3. **Test Referral Tracking**:
   - Open referral link in incognito window
   - Connect Wallet C
   - Verify referral tracked (check admin dashboard or database)
   - Verify Wallet A shows Wallet C as referred

**Expected Results**:
- ✅ Referral link format correct
- ✅ Referral tracked when wallet connects via link
- ✅ Referral relationship stored in database
- ✅ Shows in referrer dashboard

**Pass/Fail**: ☐

---

### Test 3.2: 20-Game Minimum Requirement
**Objective**: Verify referral eligibility requirement works

**Steps**:
1. Connect Wallet A (new wallet with 0 games)
2. Navigate to referrals page
3. Verify:
   - Referral link section greyed out
   - "Not Qualified" badge shown
   - Warning message: "You need to play at least 20 games..."
   - Shows current game count (0)
4. Play 19 games (incomplete matches count)
5. Verify still not qualified
6. Play 20th game
7. Verify:
   - Referral link becomes active
   - "Qualified" badge appears
   - Can copy/share referral link

**Expected Results**:
- ✅ Link disabled until 20 games played
- ✅ Warning message accurate
- ✅ Game count updates correctly
- ✅ Link activates after 20 games
- ✅ Badge updates correctly

**Pass/Fail**: ☐

---

### Test 3.3: Admin Exemption
**Objective**: Verify admin can exempt players from 20-game minimum

**Steps**:
1. Open admin dashboard locally
2. Navigate to Referrals → Exemptions section
3. Add Wallet A to exempt list
4. Verify Wallet A appears in exempt list
5. Connect Wallet A (with 0 games)
6. Verify:
   - Referral link active
   - "Exempt" badge shown
   - Can refer others immediately
7. Remove Wallet A from exempt list
8. Verify Wallet A must play 20 games again

**Expected Results**:
- ✅ Admin can add/remove exemptions
- ✅ Exempt list displays correctly
- ✅ Exempt players can refer immediately
- ✅ Removal works correctly

**Pass/Fail**: ☐

---

### Test 3.4: Referral Earnings Calculation
**Objective**: Verify referral earnings calculated correctly

**Setup**:
- Wallet A refers Wallet C (L1)
- Wallet C refers Wallet D (L2)
- Wallet D refers Wallet E (L3)

**Steps**:
1. **Complete Match with Referred Player**:
   - Wallet C plays $20 match with Wallet B
   - Calculate expected earnings:
     - Total pot: $40
     - Platform fee: $2.00
     - Bonus: $0.25
     - Network costs: ~$0.23
     - Net profit: $1.52
     - Referral pool: $1.52 × 25% = $0.38
     - Per player share: $0.38 / 2 = $0.19
     - Wallet A (L1): $0.19
     - Wallet C (L2): $0.19 × 25% = $0.0475
     - Wallet D (L3): $0.0475 × 25% = $0.011875

2. **Verify Earnings Recorded**:
   - Check Wallet A referral dashboard
   - Verify earnings show $0.19 (L1)
   - Check Wallet C dashboard (should show L2 earnings from Wallet D)
   - Check Wallet D dashboard (should show L3 earnings from Wallet E)

3. **Test Multi-Level Chain**:
   - Have Wallet E play a match
   - Verify earnings flow up all 3 levels correctly

**Expected Results**:
- ✅ Earnings calculated correctly
- ✅ L1 gets 100% of player's share
- ✅ L2 gets 25% of L1 amount
- ✅ L3 gets 25% of L2 amount
- ✅ Earnings displayed correctly in dashboard

**Pass/Fail**: ☐

---

### Test 3.5: Referral Dashboard Statistics
**Objective**: Verify all referral statistics display correctly

**Steps**:
1. Connect Wallet A (with referrals and earnings)
2. Navigate to `/referrals` page
3. Verify all sections display:

   **Total Referral Earnings**:
   - All-Time: Should show total from all time
   - Year-to-Date: Earnings since Jan 1
   - Quarter-to-Date: Earnings since quarter start
   - Last 7 Days: Rolling 7-day earnings

   **Current Unpaid Balance**:
   - Awaiting Payout: Should show pending amount
   - Total Paid: Should show historical paid amount

   **Referred Players**:
   - Total Referred: Count of all referred wallets
   - Active (1+ Match): Count of referred players who played

   **Earnings Breakdown by Level**:
   - L1, L2, L3 all show (even if $0.00)
   - Amounts and counts correct

4. Verify next payout date displays correctly

**Expected Results**:
- ✅ All statistics display correctly
- ✅ Time-based earnings accurate
- ✅ Player counts accurate
- ✅ Level breakdown shows all levels
- ✅ Next payout date correct

**Pass/Fail**: ☐

---

### Test 3.6: Referral Payout CSV Download
**Objective**: Verify CSV download works correctly

**Steps**:
1. Ensure Wallet A has some paid referral earnings
2. Navigate to referrals page
3. Click "Download All-Time Payouts (CSV)" button
4. Verify CSV downloads
5. Open CSV file
6. Verify columns:
   - Paid Date
   - Match ID
   - Referred Wallet
   - Level
   - Amount USD
   - Amount SOL
   - Transaction Signature
   - Payout Batch ID
   - Match Entry Fee
   - Match Status
7. Verify data matches dashboard
8. Test with wallet that has no payouts (should download empty CSV with headers)

**Expected Results**:
- ✅ CSV downloads successfully
- ✅ All columns present
- ✅ Data matches dashboard
- ✅ Empty CSV works correctly
- ✅ File name includes wallet address

**Pass/Fail**: ☐

---

### Test 3.7: Weekly Payout Batch Process
**Objective**: Verify weekly payout batch creation and execution

**Steps**:
1. **Prepare Test Data**:
   - Ensure multiple wallets have pending earnings >= $20
   - Note amounts for each wallet

2. **Admin Dashboard - Prepare Batch**:
   - Open admin dashboard
   - Navigate to Referrals → Payout Management
   - Click "Prepare Weekly Payout Batch"
   - Verify batch created with correct:
     - Total amount USD
     - Total amount SOL
     - Number of payouts
     - Status: "PREPARED"

3. **Review & Approve**:
   - Review payout list
   - Verify amounts correct
   - Click "Approve Batch"
   - Verify status changes to "REVIEWED"

4. **Send Payout**:
   - Click "Send Payout Batch"
   - Verify transaction created
   - Verify status changes to "SENT"
   - Verify transaction signature recorded

5. **Verify Payments**:
   - Check each wallet received payment
   - Verify amounts correct
   - Verify earnings marked as paid in database

**Expected Results**:
- ✅ Batch prepared correctly
- ✅ Amounts calculated correctly
- ✅ Approval workflow works
- ✅ Payout transaction sent
- ✅ Wallets receive correct amounts
- ✅ Earnings marked as paid

**Pass/Fail**: ☐

---

## Phase 4: Edge Cases & Error Handling

### Test 4.1: Self-Referral Prevention
**Objective**: Verify users cannot refer themselves

**Steps**:
1. Connect Wallet A
2. Copy referral link
3. Open link in same browser/wallet
4. Try to connect same wallet
5. Verify error message or prevention

**Expected Results**:
- ✅ Self-referral prevented
- ✅ Error message clear
- ✅ No referral relationship created

**Pass/Fail**: ☐

---

### Test 4.2: Duplicate Referral Prevention
**Objective**: Verify wallet can only be referred once

**Steps**:
1. Wallet A refers Wallet C
2. Try Wallet B refers Wallet C (same wallet)
3. Verify only first referral recorded
4. Verify Wallet C shows Wallet A as referrer

**Expected Results**:
- ✅ Only first referral recorded
- ✅ Subsequent referrals ignored
- ✅ Original referrer maintained

**Pass/Fail**: ☐

---

### Test 4.3: Match Cancellation & Refunds
**Objective**: Verify cancelled matches refund correctly

**Steps**:
1. Start a match
2. Cancel before completion (if possible)
3. Verify:
   - Both players refunded
   - Balances restored
   - Match status updated
   - No referral earnings generated

**Expected Results**:
- ✅ Refunds processed correctly
- ✅ Balances restored
- ✅ No earnings from cancelled matches

**Pass/Fail**: ☐

---

### Test 4.4: Network Errors & Retries
**Objective**: Verify system handles network issues gracefully

**Steps**:
1. Start matchmaking
2. Simulate network disconnect (disable WiFi briefly)
3. Reconnect
4. Verify:
   - System recovers gracefully
   - No duplicate transactions
   - Match state consistent

**Expected Results**:
- ✅ System handles disconnects
- ✅ No duplicate charges
- ✅ State remains consistent

**Pass/Fail**: ☐

---

## Phase 5: Admin Dashboard Testing

### Test 5.1: Match Data Export (CSV)
**Objective**: Verify admin CSV export works

**Steps**:
1. Open admin dashboard
2. Navigate to match export section
3. Export CSV with various filters:
   - Date range
   - Status filter
   - Entry fee filter
4. Verify CSV includes:
   - All match data
   - Referral information (L1, L2, L3)
   - Usernames
   - Transaction signatures
   - Bonus information
5. Verify data accuracy

**Expected Results**:
- ✅ CSV exports successfully
- ✅ Filters work correctly
- ✅ All columns present
- ✅ Data accurate

**Pass/Fail**: ☐

---

### Test 5.2: Referral Backfill
**Objective**: Verify referral backfill from CSV works

**Steps**:
1. Prepare CSV with referral data
2. Use admin backfill endpoint
3. Verify referrals imported correctly
4. Check referral relationships in database
5. Verify upline mapping rebuilt

**Expected Results**:
- ✅ Backfill imports correctly
- ✅ Relationships created
- ✅ Upline mapping correct

**Pass/Fail**: ☐

---

### Test 5.3: Anti-Abuse Detection
**Objective**: Verify anti-abuse flags work

**Steps**:
1. Trigger potential abuse scenarios:
   - Multiple rapid referrals
   - Suspicious patterns
2. Check admin dashboard for flags
3. Verify flags display correctly
4. Test flag resolution

**Expected Results**:
- ✅ Abuse detected
- ✅ Flags displayed
- ✅ Resolution works

**Pass/Fail**: ☐

---

## Phase 6: Integration & End-to-End Scenarios

### Test 6.1: Complete Referral Flow
**Objective**: Test complete referral-to-payout flow

**Steps**:
1. **Setup**:
   - Wallet A plays 20 games (or get exempted)
   - Wallet A refers Wallet C

2. **Earning**:
   - Wallet C plays multiple matches at different tiers
   - Verify earnings accumulate for Wallet A

3. **Payout**:
   - Wait for weekly payout or trigger manually
   - Verify Wallet A receives payout
   - Verify CSV includes payout

4. **Verification**:
   - Check all balances
   - Verify all transactions on blockchain
   - Verify dashboard shows correct data

**Expected Results**:
- ✅ Complete flow works end-to-end
- ✅ Earnings accumulate correctly
- ✅ Payout processed correctly
- ✅ All data consistent

**Pass/Fail**: ☐

---

### Test 6.2: Multi-Level Referral Chain
**Objective**: Test complex 3-level referral chain

**Steps**:
1. Create chain: A → C → D → E
2. Have each level play matches
3. Verify earnings flow correctly up chain
4. Verify each level receives correct amount
5. Test payout for all levels

**Expected Results**:
- ✅ Earnings flow correctly
- ✅ Amounts accurate at each level
- ✅ Payouts work for all levels

**Pass/Fail**: ☐

---

### Test 6.3: Multiple Matches & Accumulation
**Objective**: Verify earnings accumulate correctly over multiple matches

**Steps**:
1. Wallet A refers Wallet C
2. Wallet C plays 10 matches at $20 tier
3. Calculate expected total earnings
4. Verify dashboard shows correct total
5. Verify breakdown by level correct
6. Verify time-based stats update

**Expected Results**:
- ✅ Earnings accumulate correctly
- ✅ Totals accurate
- ✅ Breakdowns correct
- ✅ Time stats update

**Pass/Fail**: ☐

---

## Phase 7: UI/UX & Display Testing

### Test 7.1: Responsive Design
**Objective**: Verify UI works on different screen sizes

**Steps**:
1. Test on desktop (1920x1080)
2. Test on laptop (1366x768)
3. Test on mobile viewport (375x667)
4. Verify:
   - Layout adapts correctly
   - All elements visible
   - Buttons clickable
   - Text readable

**Expected Results**:
- ✅ Responsive on all sizes
- ✅ No layout breaks
- ✅ All features accessible

**Pass/Fail**: ☐

---

### Test 7.2: Loading States & Feedback
**Objective**: Verify loading states and user feedback

**Steps**:
1. Test various loading scenarios:
   - Matchmaking search
   - Transaction signing
   - Dashboard data loading
   - CSV download
2. Verify:
   - Loading indicators show
   - Error messages clear
   - Success messages appear
   - Timeouts handled

**Expected Results**:
- ✅ Loading states visible
- ✅ Clear error messages
- ✅ Success feedback
- ✅ Timeouts handled

**Pass/Fail**: ☐

---

## Testing Checklist Summary

### Critical Path (Must Pass)
- [ ] Username setup and validation
- [ ] Matchmaking and gameplay
- [ ] Payment processing (entry fees, payouts)
- [ ] Platform fee collection
- [ ] Bonus payments
- [ ] Referral link creation and tracking
- [ ] Referral earnings calculation
- [ ] Weekly payout batch process
- [ ] CSV downloads (both user and admin)

### Important Features
- [ ] 20-game minimum requirement
- [ ] Admin exemption system
- [ ] Referral dashboard statistics
- [ ] Multi-level referral chains
- [ ] Self-referral prevention
- [ ] Duplicate referral handling

### Edge Cases
- [ ] Match cancellation/refunds
- [ ] Network error handling
- [ ] Empty states (no referrals, no earnings)
- [ ] Large payout batches

---

## Bug Reporting Template

When you find issues, document them with:

```
**Bug ID**: [Unique identifier]
**Feature**: [Which feature]
**Severity**: [Critical/High/Medium/Low]
**Steps to Reproduce**:
1. 
2. 
3. 

**Expected Behavior**:
[What should happen]

**Actual Behavior**:
[What actually happens]

**Environment**:
- Wallet: [Address]
- Browser: [Chrome/Firefox/etc]
- Network: [Mainnet/Devnet]
- Timestamp: [When it occurred]

**Screenshots/Logs**:
[Attach relevant screenshots or error logs]
```

---

## Post-Testing Actions

After completing all tests:

1. **Document Results**: Create a summary of all test results
2. **Fix Critical Issues**: Address any critical bugs found
3. **Re-test Fixed Issues**: Verify fixes work correctly
4. **Update Documentation**: Update any docs based on findings
5. **Prepare for Production**: Ensure all critical paths pass before going live

---

## Notes

- Test on both devnet and mainnet if possible
- Keep detailed logs of all transactions
- Take screenshots of important states
- Document any unexpected behavior
- Test with realistic amounts (not just $0.01)
- Verify all blockchain transactions on Solscan
- Check database directly if needed for verification

Good luck with testing! 🚀

