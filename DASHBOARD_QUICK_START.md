# Admin Dashboard Quick Start Guide

## One-Click Launch

Simply double-click **`dashboard/START DASHBOARD.bat`** (or `LAUNCH_DASHBOARD.bat`) and the dashboard will:
1. ✅ Check for Node.js and dependencies
2. ✅ Start the development servers
3. ✅ **Automatically open your browser** at `http://localhost:5173`
4. ✅ Show helpful tips

## Bookmark Tip 💡

**Yes, you should bookmark `http://localhost:5173`** in your browser for quick access!

The dashboard launcher will remind you each time, but bookmarking it means you can:
- Access it instantly without waiting for the launcher
- Keep it in your bookmarks bar for one-click access
- Use it even if the launcher script doesn't auto-open the browser

## Stopping the Dashboard

Press **Ctrl+C** in the terminal window to stop the dashboard servers.

---

## Database Migrations - Auto-Run on Deployment ✅

**Good news:** Migrations **automatically run** when Render/Vercel deploy your backend!

### How It Works:

1. **On Render/Vercel Deployment:**
   - When your backend starts, it calls `initializeDatabase()` in `backend/src/db/index.ts`
   - This function automatically runs `AppDataSource.runMigrations()` (line 285)
   - All pending migrations are applied automatically
   - No manual commands needed! ✅

2. **The Migration Flow:**
   ```
   Server Start → initializeDatabase() → runMigrations() → ✅ Done
   ```

3. **What Gets Migrated:**
   - All migration files in `backend/src/db/migrations/`
   - Including the new referral tables migration (`014_create_referral_tables.ts`)
   - TypeORM tracks which migrations have run in the database

### Manual Migration (Only if Needed):

If you ever need to run migrations manually (e.g., local testing):

```bash
cd backend
npm run migrate
```

But **this is not needed for deployment** - Render/Vercel handle it automatically!

---

## Dependencies

The backend will automatically install `csv-parse` when Render/Vercel runs `npm install` during deployment.

All dependencies are listed in `backend/package.json` and will be installed automatically.

---

## Summary

✅ **Dashboard:** Double-click `.bat` file → Browser opens automatically → Bookmark `http://localhost:5173`  
✅ **Migrations:** Auto-run on Render/Vercel deployment - no action needed  
✅ **Dependencies:** Auto-installed on deployment - no action needed  

Everything is automated! 🚀

