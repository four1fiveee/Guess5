# Migration Plan: Fix Critical Security Issues

## 🚨 IMMEDIATE PRIORITY: Fix Data Persistence

### Step 1: Migrate Game State to Redis (CRITICAL)

**Current Problem:**
```typescript
// SECURITY RISK: Game state lost on restart
const activeGames = new Map<string, {...}>();
```

**Solution: Replace with Redis storage**

**File:** `backend/src/controllers/matchController.ts`

**Changes needed:**

1. **Replace `activeGames.get()` calls:**
   ```typescript
   // OLD (insecure):
   const gameState = activeGames.get(matchId);
   
   // NEW (secure):
   const redis = getRedisMM();
   const gameStateJson = await redis.hGet(`game:${matchId}`, 'state');
   const gameState = gameStateJson ? JSON.parse(gameStateJson) : null;
   ```

2. **Replace `activeGames.set()` calls:**
   ```typescript
   // OLD (insecure):
   activeGames.set(matchId, gameState);
   
   // NEW (secure):
   const redis = getRedisMM();
   await redis.hSet(`game:${matchId}`, 'state', JSON.stringify(gameState));
   await redis.expire(`game:${matchId}`, 3600); // 1 hour TTL
   ```

3. **Replace `activeGames.delete()` calls:**
   ```typescript
   // OLD (insecure):
   activeGames.delete(matchId);
   
   // NEW (secure):
   const redis = getRedisMM();
   await redis.del(`game:${matchId}`);
   ```

### Step 2: Use Redis Matchmaking Service (CRITICAL)

**Current Problem:**
```typescript
// Using database queries instead of Redis
const waitingMatches = await matchRepository.query(`SELECT...`);
```

**Solution: Use RedisMatchmakingService**

**Changes needed:**

1. **Replace matchmaking logic:**
   ```typescript
   // OLD (database queries):
   const waitingMatches = await matchRepository.query(`SELECT...`);
   
   // NEW (Redis service):
   const result = await redisMatchmakingService.addPlayerToQueue(wallet, entryFee);
   if (result.status === 'matched') {
     // Handle matched case
   }
   ```

2. **Replace match lookup:**
   ```typescript
   // OLD (database queries):
   const match = await matchRepository.findOne({ where: { id: matchId } });
   
   // NEW (Redis service):
   const match = await redisMatchmakingService.getMatch(matchId);
   ```

### Step 3: Persist Game Results to Database (CRITICAL)

**Current Problem:**
```typescript
// Game results not saved to database immediately
const gameState = activeGames.get(matchId);
```

**Solution: Save results immediately to database**

**Changes needed:**

1. **Save player results immediately:**
   ```typescript
   // When player submits result:
   match.setPlayer1Result({
     won: result.won,
     numGuesses: result.numGuesses,
     totalTime: result.totalTime,
     guesses: result.guesses
   });
   await matchRepository.save(match);
   ```

2. **Save winner determination:**
   ```typescript
   // When game ends:
   match.winner = winner;
   match.isCompleted = true;
   await matchRepository.save(match);
   ```

## 🔧 IMPLEMENTATION STEPS

### Phase 1: Critical Security Fixes (IMMEDIATE)

1. **Create Redis helper functions:**
   ```typescript
   // backend/src/utils/redisGameState.ts
   export const getGameState = async (matchId: string) => {
     const redis = getRedisMM();
     const gameStateJson = await redis.hGet(`game:${matchId}`, 'state');
     return gameStateJson ? JSON.parse(gameStateJson) : null;
   };
   
   export const setGameState = async (matchId: string, gameState: any) => {
     const redis = getRedisMM();
     await redis.hSet(`game:${matchId}`, 'state', JSON.stringify(gameState));
     await redis.expire(`game:${matchId}`, 3600);
   };
   
   export const deleteGameState = async (matchId: string) => {
     const redis = getRedisMM();
     await redis.del(`game:${matchId}`);
   };
   ```

2. **Replace activeGames usage in matchController.ts:**
   - Replace all `activeGames.get()` calls
   - Replace all `activeGames.set()` calls  
   - Replace all `activeGames.delete()` calls

3. **Use RedisMatchmakingService:**
   - Replace database matchmaking queries
   - Use Redis for match lookup
   - Use Redis for status updates

4. **Persist results immediately:**
   - Save player results to database when submitted
   - Save winner determination to database when game ends
   - Remove dependency on in-memory state

### Phase 2: Testing & Validation

1. **Test data persistence:**
   - Restart server and verify game state preserved
   - Test with multiple server instances
   - Verify Redis data consistency

2. **Test matchmaking:**
   - Verify Redis matchmaking works correctly
   - Test concurrent matchmaking requests
   - Verify match data consistency

3. **Test game flow:**
   - Verify game state persists across requests
   - Test game completion and result saving
   - Verify winner determination works correctly

## 📋 CHECKLIST

### Critical Security Fixes:
- [ ] Replace `activeGames` Map with Redis storage
- [ ] Use `RedisMatchmakingService` for matchmaking
- [ ] Persist game results to database immediately
- [ ] Remove dependency on in-memory state

### Testing:
- [ ] Test data persistence across server restarts
- [ ] Test with multiple server instances
- [ ] Verify Redis data consistency
- [ ] Test game flow end-to-end

### Documentation:
- [ ] Update deployment instructions
- [ ] Document Redis configuration
- [ ] Update security documentation

## ⚠️ WARNING

**This migration is CRITICAL for production deployment.**
**The current in-memory storage is a major security vulnerability.**
**Do not deploy to production until these fixes are implemented and tested.**
