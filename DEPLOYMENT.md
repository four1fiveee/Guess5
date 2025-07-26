# Guess5 Deployment Guide

## Current Issues & Fixes

### ✅ Fixed Issues:
1. **Frontend Client-Side Exceptions**: Added fallbacks for missing environment variables
2. **Backend Database Errors**: Added in-memory fallback when database is unavailable
3. **API Connection Errors**: Created robust API utility with error handling
4. **Missing Health Checks**: Added health endpoint for deployment monitoring

## Quick Fix for Current Deployments

### For Vercel Frontend (https://guess5.vercel.app/):

1. **Set Environment Variables in Vercel Dashboard:**
   - Go to your Vercel project settings
   - Add environment variable: `NEXT_PUBLIC_API_URL`
   - Set value to your backend URL (e.g., `https://guess5.onrender.com`)
   - Add: `NEXT_PUBLIC_SOLANA_NETWORK` = `https://api.devnet.solana.com`

2. **Redeploy:**
   - Push these changes to GitHub
   - Vercel will auto-redeploy

### For Render Backend (https://guess5.onrender.com/):

1. **Set Environment Variables in Render Dashboard:**
   - Go to your Render service settings
   - Add: `NODE_ENV` = `production`
   - Add: `PORT` = `10000` (or let Render assign)
   - Optional: Add `DATABASE_URL` if you have a PostgreSQL database

2. **Redeploy:**
   - Push these changes to GitHub
   - Render will auto-redeploy

## Deployment Options

### Option 1: Vercel (Recommended for Frontend)

**Frontend Deployment:**
1. Connect your GitHub repo to Vercel
2. Set the root directory to `/frontend`
3. Set environment variables in Vercel dashboard:
   - `NEXT_PUBLIC_API_URL`: Your backend URL
   - `NEXT_PUBLIC_SOLANA_NETWORK`: `https://api.devnet.solana.com`

**Backend Deployment:**
1. Deploy backend separately to Render or Railway
2. Set environment variables:
   - `DATABASE_URL`: PostgreSQL connection string (optional)
   - `PORT`: 10000 (or let Render assign)
   - `NODE_ENV`: production

### Option 2: Render (Full Stack)

1. Connect your GitHub repo to Render
2. Use the `render.yaml` file for automatic deployment
3. Set environment variables in Render dashboard:
   - `DATABASE_URL`: PostgreSQL connection string (optional)
   - `NEXT_PUBLIC_API_URL`: Your backend URL

## Environment Variables Required

### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=https://your-backend-url.com
NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com
```

### Backend (.env)
```
DATABASE_URL=postgresql://username:password@host:port/database (optional)
PORT=4000
NODE_ENV=production
```

## Testing Your Deployment

1. **Check Status Page**: Visit `https://your-frontend-url.com/status`
2. **Test Health Endpoint**: `https://your-backend-url.com/api/match/health`
3. **Test Frontend**: Should load without console errors
4. **Test Wallet Connection**: Should connect to Phantom wallet

## Common Issues & Solutions

### Issue: "Application error: a client-side exception has occurred"
**Solution:** Set `NEXT_PUBLIC_API_URL` environment variable in Vercel

### Issue: "White /get message" on backend
**Solution:** Backend now works without database, just set `NODE_ENV=production`

### Issue: "Cannot find module" errors
**Solution:** Ensure all dependencies are in package.json and run `npm install`

### Issue: CORS errors
**Solution:** Backend CORS is configured to allow all origins (`*`)

### Issue: Environment variables not loading
**Solution:** Ensure variables are set in deployment platform dashboard

## Alternative Services

If Render/Vercel continue to have issues:

- **Railway**: Great for full-stack apps
- **Heroku**: Reliable but more expensive
- **DigitalOcean App Platform**: Good for Node.js apps
- **Supabase**: Good for database + hosting

## Quick Test Commands

```bash
# Test backend locally
cd backend && npm run dev

# Test frontend locally  
cd frontend && npm run dev

# Check if builds work
./deploy.sh
``` 