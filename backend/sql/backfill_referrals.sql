-- SQL queries for referral backfill and maintenance

-- 1. Recursive CTE to build upline mapping (up to depth 3)
WITH RECURSIVE chain AS (
  SELECT 
    referred_wallet,
    referrer_wallet,
    1 as level
  FROM referral
  WHERE referrer_wallet IS NOT NULL
    AND active = true
  
  UNION ALL
  
  SELECT 
    r.referred_wallet,
    ref.referrer_wallet,
    c.level + 1
  FROM chain c
  JOIN referral ref ON ref.referred_wallet = c.referrer_wallet
  JOIN referral r ON r.referred_wallet = c.referred_wallet
  WHERE c.level < 3 
    AND ref.referrer_wallet IS NOT NULL
    AND ref.active = true
)
INSERT INTO referral_upline (referred_wallet, level, upline_wallet, "createdAt")
SELECT DISTINCT 
  referred_wallet,
  level,
  referrer_wallet,
  now()
FROM chain
WHERE referrer_wallet IS NOT NULL
ON CONFLICT DO NOTHING;

-- 2. Update users.totalEntryFees from matches
UPDATE "user" u
SET 
  "totalEntryFees" = COALESCE((
    SELECT SUM(CASE 
      WHEN m."player1" = u."walletAddress" THEN m."entryFeeUSD"
      WHEN m."player2" = u."walletAddress" THEN m."entryFeeUSD"
      ELSE 0
    END)
    FROM "match" m
    WHERE (m."player1" = u."walletAddress" OR m."player2" = u."walletAddress")
      AND m."entryFeeUSD" IS NOT NULL
  ), 0),
  "totalEntryFeesSOL" = COALESCE((
    SELECT SUM(CASE 
      WHEN m."player1" = u."walletAddress" THEN m."entryFee"
      WHEN m."player2" = u."walletAddress" THEN m."entryFee"
      ELSE 0
    END)
    FROM "match" m
    WHERE (m."player1" = u."walletAddress" OR m."player2" = u."walletAddress")
      AND m."entryFee" IS NOT NULL
  ), 0);

-- 3. Mark referrals.eligible where referrer has played at least one match
UPDATE referral r
SET eligible = true
FROM "user" u
WHERE r.referrer_wallet = u."walletAddress"
  AND u."totalEntryFees" > 0
  AND r.eligible = false;

-- 4. Get pending small payouts (< $20)
SELECT 
  upline_wallet,
  SUM(amount_usd) as total_usd,
  COUNT(*) as match_count,
  MAX("createdAt") as last_match_time
FROM referral_earning
WHERE paid = false
  AND amount_usd IS NOT NULL
GROUP BY upline_wallet
HAVING SUM(amount_usd) < 20
ORDER BY total_usd DESC;

-- 5. Weekly payout aggregation (>= $20)
SELECT 
  upline_wallet,
  SUM(amount_usd) as total_usd,
  COUNT(*) as match_count,
  MAX("createdAt") as last_match_time
FROM referral_earning
WHERE paid = false
  AND amount_usd IS NOT NULL
GROUP BY upline_wallet
HAVING SUM(amount_usd) >= 20
ORDER BY total_usd DESC;

