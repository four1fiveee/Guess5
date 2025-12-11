import Redis from 'ioredis';
import { config } from '../config';

let mmClient: Redis | null = null;
let opsClient: Redis | null = null;

export function getMMClient(): Redis {
  if (!mmClient) {
    mmClient = new Redis({
      host: config.redis.mm.host,
      port: config.redis.mm.port,
      password: config.redis.mm.password,
      username: config.redis.mm.username,
      tls: config.redis.mm.tls ? {} : undefined,
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
    });
  }
  return mmClient;
}

export function getOpsClient(): Redis {
  if (!opsClient) {
    opsClient = new Redis({
      host: config.redis.ops.host,
      port: config.redis.ops.port,
      password: config.redis.ops.password,
      username: config.redis.ops.username,
      tls: config.redis.ops.tls ? {} : undefined,
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
    });
  }
  return opsClient;
}

export async function getQueueDepth(key: string, client: Redis): Promise<number> {
  try {
    const type = await client.type(key);
    if (type === 'list') {
      return await client.llen(key);
    } else if (type === 'set') {
      return await client.scard(key);
    } else if (type === 'zset') {
      return await client.zcard(key);
    }
    return 0;
  } catch (error) {
    return -1;
  }
}

export async function testMMConnection(): Promise<boolean> {
  try {
    const client = getMMClient();
    await client.ping();
    return true;
  } catch (error) {
    return false;
  }
}

export async function testOpsConnection(): Promise<boolean> {
  try {
    const client = getOpsClient();
    await client.ping();
    return true;
  } catch (error) {
    return false;
  }
}







