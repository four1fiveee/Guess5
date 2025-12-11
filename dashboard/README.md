# Guess5.io Operations Dashboard

⚠️ **CRITICAL: This dashboard is LOCAL-ONLY and must NEVER be committed to Git or deployed publicly.**

## Overview

This is a local operations dashboard for monitoring and managing Guess5.io. It provides real-time metrics, financial performance tracking, user growth analytics, infrastructure health monitoring, and administrative tools.

## Features

- **Game Operations**: Active wallets, active games, payout times, matchmaking metrics, outcome breakdowns
- **Financial Performance**: Vault balances, revenue by tier, platform fees, bonuses, net revenue
- **User & Growth**: Unique wallets, new users, matches per user
- **Infrastructure Health**: Render API status, Redis queue depths, Postgres/Solana latency, error logs
- **Admin Tools**: Match deletion helper (LOCAL ONLY)

## Setup

### Prerequisites

- Node.js 18+ and pnpm installed
- Access to the Guess5 database and Redis instances
- Environment variables configured

### Installation

1. Navigate to the dashboard directory:
   ```bash
   cd dashboard
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Copy the environment template:
   ```bash
   # Create .env.local from the provided values
   # See .env.example for reference
   ```

4. Configure `.env.local` with your credentials:
   - `DATABASE_URL`: Your database connection string (from Render)
   - `REDIS_MM_HOST`, `REDIS_MM_PORT`, `REDIS_MM_PASSWORD`, `REDIS_MM_USER`, `REDIS_MM_TLS`: Matchmaking Redis instance details
   - `REDIS_OPS_HOST`, `REDIS_OPS_PORT`, `REDIS_OPS_PASSWORD`, `REDIS_OPS_USER`, `REDIS_OPS_TLS`: Operations Redis instance details
   - `RENDER_SERVICE_URL`: Your Render service URL (defaults to https://guess5.onrender.com)
   - `SOLANA_NETWORK`: Solana RPC endpoint (from Render, defaults to https://api.devnet.solana.com)

### Running

**Easiest Way (Windows):**
Just **double-click** `START DASHBOARD.bat` in the dashboard folder!

This will:
- Check for `.env.local` file
- Display critical environment variables (masked for security)
- Install dependencies if needed
- Start both API server and frontend
- Automatically open your browser to `http://localhost:5173`

**Command Line:**
```bash
pnpm start
```
or
```bash
node start-dashboard.js
```

**Manual Start:**
```bash
pnpm dev
```

This will start:
- API server on `http://localhost:4000`
- Frontend client on `http://localhost:5173`

**Run individually:**
```bash
pnpm server  # Server only
pnpm client  # Client only
```

## Usage

1. Open `http://localhost:5173` in your browser
2. Navigate through sections using the sidebar
3. Data refreshes automatically every 30 seconds
4. Use the "Refresh" button to force immediate updates

### Admin Tools

The Admin Tools page allows you to:
- Lookup matches by ID
- Delete matches (IRREVERSIBLE - use with caution)
- View deletion results

**Warning**: All admin actions are logged locally and should never be exposed publicly.

## Development

### Project Structure

```
dashboard/
├── client/          # React frontend (Vite)
├── server/          # Express API backend
├── shared/          # Shared TypeScript types
└── package.json     # Root workspace config
```

### Building

```bash
pnpm build
```

### Linting

```bash
pnpm lint
```

### Formatting

```bash
pnpm format
```

## Security Notes

- This dashboard connects directly to production databases
- Never expose the dashboard port publicly
- Keep `.env.local` secure and never commit it
- Admin tools can permanently delete data - use carefully
- All operations are logged locally for audit purposes

## Troubleshooting

### Database Connection Issues

- Verify `POSTGRES_URL` is correct and accessible
- Check SSL mode requirements (`sslmode=require`)

### Redis Connection Issues

- Verify Redis credentials and TLS settings
- Check that Redis instances are accessible from your network

### API Errors

- Check server logs in the terminal
- Verify all environment variables are set
- Ensure backend services are running

## Support

For issues or questions, refer to the main Guess5.io project documentation.

---

**Remember: This dashboard is LOCAL-ONLY. Never commit it to Git or deploy it publicly.**

