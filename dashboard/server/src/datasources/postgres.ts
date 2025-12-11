import { Pool, QueryResult } from 'pg';
import { config } from '../config';
import { TimeWindow } from '@guess5-dashboard/shared';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.postgres.url,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return pool;
}

export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const pool = getPool();
  return pool.query<T>(text, params);
}

export function buildWindowClause(window: TimeWindow): string {
  return config.windows[window];
}

export async function testConnection(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch (error) {
    return false;
  }
}

export async function measureLatency(): Promise<number> {
  const start = Date.now();
  try {
    await query('SELECT 1');
    return Date.now() - start;
  } catch (error) {
    return -1;
  }
}







