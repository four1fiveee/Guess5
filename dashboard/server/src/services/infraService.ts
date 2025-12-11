import { checkRenderHealth } from '../datasources/render';
import { getMMClient, getOpsClient, getQueueDepth, testMMConnection, testOpsConnection } from '../datasources/redis';
import { measureLatency as measurePostgresLatency } from '../datasources/postgres';
import { measureLatency as measureSolanaLatency, getHealth as getSolanaHealth } from '../datasources/solana';
import { query } from '../datasources/postgres';
import { InfraHealth } from '@guess5-dashboard/shared';

export async function getInfraSummary(force: boolean = false): Promise<InfraHealth> {
  // Render health
  const renderHealth = await checkRenderHealth();

  // Redis MM
  const mmConnected = await testMMConnection();
  const mmClient = getMMClient();
  let mmQueueDepth = 0;
  if (mmConnected) {
    // Try common queue keys
    const queueKeys = ['matchmaking:queue', 'mm:queue', 'queue'];
    for (const key of queueKeys) {
      const depth = await getQueueDepth(key, mmClient);
      if (depth >= 0) {
        mmQueueDepth = depth;
        break;
      }
    }
  }

  // Redis OPS
  const opsConnected = await testOpsConnection();
  const opsClient = getOpsClient();
  let opsQueueDepth = 0;
  if (opsConnected) {
    const queueKeys = ['ops:queue', 'operations:queue', 'queue'];
    for (const key of queueKeys) {
      const depth = await getQueueDepth(key, opsClient);
      if (depth >= 0) {
        opsQueueDepth = depth;
        break;
      }
    }
  }

  // Postgres latency
  const postgresLatency = await measurePostgresLatency();
  const postgresStatus = postgresLatency >= 0 && postgresLatency < 100 ? 'healthy' : postgresLatency < 500 ? 'degraded' : 'down';

  // Solana latency
  const solanaLatency = await measureSolanaLatency();
  const solanaHealth = await getSolanaHealth();
  const solanaStatus = solanaHealth === 'healthy' && solanaLatency < 1000 ? 'healthy' : solanaLatency < 3000 ? 'degraded' : 'down';

  // Error logs (last 24h)
  let errorLogs: InfraHealth['errorLogs'] = [];
  try {
    // Try match_audit_log table first
    const errorResult = await query<{
      timestamp: Date;
      matchId: string | null;
      message: string;
      severity: string | null;
    }>(`
      SELECT 
        "createdAt" AS timestamp,
        "matchId",
        "action" AS message,
        'error' AS severity
      FROM "match_audit_log"
      WHERE "createdAt" >= NOW() - INTERVAL '24 hours'
        AND ("action" LIKE '%error%' OR "action" LIKE '%fail%' OR "action" LIKE '%Error%')
      ORDER BY "createdAt" DESC
      LIMIT 50
    `);
    errorLogs = errorResult.rows.map((row) => ({
      timestamp: new Date(row.timestamp),
      matchId: row.matchId || undefined,
      message: row.message,
      severity: row.severity || undefined,
    }));
  } catch (error) {
    // Table might not exist, ignore
  }

  return {
    render: {
      status: renderHealth.status,
      responseTime: renderHealth.responseTime,
    },
    redis: {
      mm: {
        queueDepth: mmQueueDepth,
        status: mmConnected ? 'healthy' : 'down',
      },
      ops: {
        queueDepth: opsQueueDepth,
        status: opsConnected ? 'healthy' : 'down',
      },
    },
    postgres: {
      latency: postgresLatency,
      status: postgresStatus,
    },
    solana: {
      latency: solanaLatency,
      status: solanaStatus,
    },
    errorLogs,
  };
}







