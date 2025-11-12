# Dashboard Build Plan

Remember this is never meant to be pushed beyond local. 

## 1. Local Workspace Layout & Tooling

- Declare a pnpm workspace under `dashboard/` (`package.json` with `private: true`, workspaces `client`, `server`, `shared`).
- Scaffold `dashboard/client/` via Vite (React + TS). Install `@tanstack/react-query`, `react-router-dom`, `chakra-ui` (or MUI), `recharts`, `axios`, `clsx`, `date-fns`.
- Initialize `dashboard/server/` with TypeScript (`ts-node-dev`), install `express`, `cors`, `dotenv`, `pg`, `ioredis`, `node-fetch`, `@solana/web3.js`, `zod`, `pino`, `pino-pretty`.
- Create `dashboard/shared/` library exporting TypeScript types consumed by both client/server (use project references).
- Add root scripts: `pnpm install`, `pnpm dev` (concurrently run client + server), `pnpm lint`, `pnpm format`.
- Produce `.gitignore` that blocks the entire `dashboard/` directory from Git, plus per-package ignores (node_modules, dist).

## 2. Environment & Config Management

- Create `dashboard/.env.example` (copied to `.env.local`) with variables: `POSTGRES_URL`, `REDIS_MM_URL`, `REDIS_OPS_URL`, `RENDER_SERVICE_URL`, `RENDER_HEALTH_PATH`, `RENDER_API_TOKEN`, `SOLANA_RPC_ENDPOINT`, optional `SOL_PRICE_FEED_URL`.
- Implement `server/src/config.ts` validating env via `zod`; derive Redis connection params (host, port, tls), parse Postgres URL, time windows, cache TTL.
- Update `dashboard/README.md` documenting setup, environment values, and warning never to commit folder.

## 3. Backend Metrics Service

- Structure server code: `src/index.ts`, `src/routes/*.ts`, `src/services/*.ts`, `src/datasources/*.ts`, `src/utils/*.ts`.
- Setup Express app with CORS restricted to `http://localhost:5173`, JSON responses, `pino` logging, health endpoint (`/api/health`).
- Datasources:
- `datasources/postgres.ts`: initialize `pg.Pool`, expose helper `query<T>(text, params)` and timeframe builder (`buildWindowClause(window: TimeWindow)`).
- `datasources/redis.ts`: instantiate two ioredis clients (MM + OPS) using TLS; helper `getQueueDepth(key)`.
- `datasources/render.ts`: fetch `${RENDER_SERVICE_URL}${RENDER_HEALTH_PATH}`; optional Render API request if token set to read deploy status.
- `datasources/solana.ts`: create `Connection` and measure latency via timed `getSlot()` call; fetch performance samples for richer stats if available.
- `datasources/pricing.ts`: fetch SOL/USD price (leverage existing backend `/price` endpoint or public API; allow override).
- Cache layer `services/cache.ts` caching endpoint payloads for 30s; allow `?force=true` to bypass.
- Metrics services returning typed DTOs:
- `gameOpsService`: active wallets (distinct players in matches updated within last 10 minutes), active games (status `active`), average payout time (difference between `proposalExecutedAt` and `gameEndTime`), recent matches feed (last 10 with status, tier, payout flag), outcome percentages per window, average matchmaking time (match creation -> payment completion).
- `financeService`: vault fee balance (query backend or compute from transactions table), totals per tier for entry fees, platform fee (derived from `entryFee * 2 * feeBps`), bonuses (join bonus table), net revenue (fee - bonus). Provide both per tier and aggregate for 24h/7d/30d.
- `growthService`: unique wallet counts (distinct players), new wallets (first seen within window), matches per user average (count / distinct) for each timeframe.
- `infraService`: Render health status, Redis queue depth (MM + ops), Postgres latency (round-trip `SELECT 1`), Solana RPC latency metric, error logs last 24h (query `match_audit_log` or `logs` fallback).
- Define routes `/api/ops/summary`, `/api/finance/summary`, `/api/growth/summary`, `/api/infra/summary`. Implement schema validation for responses using shared types.

## 4. SQL & Aggregation Logic

- Build helper SQL strings in `server/src/sql/*.ts`:
- `recentMatchesSql(limit)` selecting id, players, entryFee, status, outcome, durations.
- `outcomeBreakdownSql(window)` using `COUNT(*) FILTER` for win/loss/tie/refund categories.
- `averagePayoutSql(window)` comparing payout completion timestamps vs game end; handle null payouts by excluding.
- `entryFeeStatsSql(window)` grouping by `entryFee`, summing gross pot (`entryFee * 2`), fee, bonus (left join on bonus payouts table), computing net.
- `uniqueWalletsSql(window)` flattening player1/player2 via `UNION ALL`.
- `newWalletsSql(window)` leveraging earliest match per wallet.
- `matchesPerUserSql(window)` computing ratio.
- Parameterize interval strings (`'24 hours'`, `'7 days'`, `'30 days'`); store in `const WINDOWS: Record<TimeWindow,string>`.
- Gracefully handle missing data (return zeros) to avoid placeholders.

## 5. Frontend Application Structure

- Implement layout using Chakra UI (Theme provider, custom colors matching Guess5 palette). Components: `AppShell`, `Sidebar`, `TopBar`, `AutoTileCarousel`, `KpiCard`, `MetricTrend`, `OutcomePie`, `TierComparisonTable`, `StatusBadge`.
- Configure React Router with routes: `/` (overview), `/ops`, `/finance`, `/growth`, `/infra`.
- Overview page: auto-rotating tiles summarizing each section (active wallets/games, net revenue 24h, unique wallets 24h, infra status). Each tile clickable to route to detail page.
- Game Ops page: KPI grid (active wallets, active games, avg payout time, avg matchmaking time). Include charts for outcome percentages (toggle windows) and line chart for payout time trend (if available). Table listing 10 latest matches with details.
- Financial page: SOL/USD toggle using price fetch; show per-tier cards (Starter, Competitive, Veteran, VIP) plus total summary. Display stacked bar chart of fees vs bonuses per window, and table for vault fee balance and revenue.
- Growth page: Cards for unique wallets (24h/7d/30d), new wallets 24h, matches per user. Trendline chart showing daily unique wallets for last 30 days (API endpoint to support optional historical data).
- Infrastructure page: Status grid (Render, Redis MM, Redis OPS, Postgres, Solana RPC) with color-coded badges; sparkline for Redis queue length; table of last 24h error logs (timestamp, matchId, message).
- Data fetching with React Query: centralized `useSummary(endpoint, options)` hook with `refetchInterval: 30000`. Provide manual refresh button that calls `refetch({ throwOnError: false })` with `?force=true`.
- Provide loading skeletons and error states (detailed message + retry).

## 6. Administrative Tools (Local Only)

- Add an operator utilities panel (accessible from sidebar) dedicated to manual interventions that must remain local.
- First tool: Match deletion helper where operator pastes one or many match IDs (textarea with per-line IDs). The UI shows lookup results (status, players, createdAt) by calling backend admin endpoint; include confirmation modal explaining irreversible local action.
- Backend endpoint should call existing deletion script logic (`backend/scripts/deleteMatch.js`) via `child_process` or re-implemented service call; log every deletion attempt locally (no remote logging) and return structured success/failure per ID.
- Display copyable CLI fallback command (`node backend/scripts/deleteMatch.js --match <id>`) so operator can run manually if needed.
- Document clearly inside the UI and README that these controls are strictly local and never to be exposed publicly.

## 7. Shared Types & Utilities

- Define `TimeWindow = '24h' | '7d' | '30d'`, `MetricValue`, `WindowedMetric<T>`, `GameOpsSummary`, `FinanceSummary`, `FinanceTierBreakdown`, `GrowthSummary`, `InfraSummary` in `shared/src/types.ts`.
- Export utility functions (formatting SOL/USD, percentage, duration) in `shared/src/utils.ts`; re-export from client for consistency.
- Configure path aliases (`@dashboard/shared`) in both TS configs using `paths` mapping to referenced build output.

## 8. Quality & Developer Experience

- ESLint config at root extending `@typescript-eslint/recommended` and `eslint-config-prettier` for client + server.
- Prettier config `.prettierrc.cjs` with standard formatting.
- Add `pnpm lint` script executing lint for both packages via `pnpm -r lint`.
- Include instructions in README for running `pnpm dev`, explaining ports (`client:5173`, `server:4000`).
- Document caching behavior and troubleshooting tips (e.g., Render API token, missing Solana latency).

## 9. Optional Enhancements

- Persist API cache snapshots to disk for faster warm start.
- Implement CSV/PDF export for finance reports.

### To-dos

- [ ] Set up local-only pnpm workspace structure (client/server/shared) with tooling locked to dashboard folder.
- [ ] Add env/config management (`.env.example`, config loader) and document local-only usage.
- [ ] Build backend metrics/API services (datasources, caching, summary routes, match deletion endpoint).
- [ ] Implement SQL helpers and aggregation logic for metrics windows.
- [ ] Create frontend UI (overview + sections + admin utilities) with React Query polling.
- [ ] Define shared types/utilities and wire up build tooling.
- [ ] Configure lint/format tooling and write README emphasizing “never push dashboard”.
- [ ] Evaluate/implement optional enhancements once core dashboard is stable.


