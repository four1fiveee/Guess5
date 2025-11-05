# Critical Fixes Needed

## 1. Vercel Root Directory Issue

**Problem:** Vercel can't find `frontend` because your git repo has files under `OneDrive/Desktop/Guess5/` prefix.

**Solution:** Update Vercel Project Settings:
1. Go to https://dashboard.vercel.com
2. Select your `guess5` project
3. Go to Settings → General
4. Set **Root Directory** to: `OneDrive/Desktop/Guess5/frontend`
5. Save and redeploy

## 2. Delete Stuck Match

The match `aebc06bb-30ef-465f-8fc1-eae608ecae39` needs to be deleted.

**Endpoint Created:** `POST /api/admin/delete-match/:matchId`

Once the route is added to your server.ts, call:
```
POST https://guess5.onrender.com/api/admin/delete-match/aebc06bb-30ef-465f-8fc1-eae608ecae39
```

## 3. Add Route to Server

Add this to your `backend/src/server.ts` file:

```typescript
import { adminDeleteMatch } from './controllers/adminController';

// Add this route registration:
app.post('/api/admin/delete-match/:matchId', adminDeleteMatch);
```




