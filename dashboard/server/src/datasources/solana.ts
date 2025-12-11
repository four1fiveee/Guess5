import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config';

let connection: Connection | null = null;

export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(config.solana.rpcEndpoint, 'confirmed');
  }
  return connection;
}

export async function measureLatency(): Promise<number> {
  const start = Date.now();
  try {
    const conn = getConnection();
    await conn.getSlot();
    return Date.now() - start;
  } catch (error) {
    return -1;
  }
}

export async function getHealth(): Promise<'healthy' | 'degraded' | 'down'> {
  try {
    const conn = getConnection();
    const health = await conn.getHealth();
    if (health === 'ok') {
      return 'healthy';
    }
    return 'degraded';
  } catch (error) {
    return 'down';
  }
}







