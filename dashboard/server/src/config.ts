import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_MM_HOST: z.string(),
  REDIS_MM_PORT: z.string().transform(Number),
  REDIS_MM_PASSWORD: z.string(),
  REDIS_MM_USER: z.string().default('default'),
  REDIS_MM_TLS: z.string().transform((val) => val === 'true'),
  REDIS_OPS_HOST: z.string(),
  REDIS_OPS_PORT: z.string().transform(Number),
  REDIS_OPS_PASSWORD: z.string(),
  REDIS_OPS_USER: z.string().default('default'),
  REDIS_OPS_TLS: z.string().transform((val) => val === 'true'),
  RENDER_SERVICE_URL: z.string().url().default('https://guess5.onrender.com'),
  RENDER_HEALTH_PATH: z.string().default('/health'),
  RENDER_API_TOKEN: z.string().optional(),
  SOLANA_NETWORK: z.string().url().default('https://api.devnet.solana.com'),
  SOL_PRICE_FEED_URL: z.string().url().optional(),
  SERVER_PORT: z.string().transform(Number).default('4000'),
});

const env = envSchema.parse(process.env);

export const config = {
  postgres: {
    url: env.DATABASE_URL,
  },
  redis: {
    mm: {
      host: env.REDIS_MM_HOST,
      port: env.REDIS_MM_PORT,
      password: env.REDIS_MM_PASSWORD,
      username: env.REDIS_MM_USER,
      tls: env.REDIS_MM_TLS,
    },
    ops: {
      host: env.REDIS_OPS_HOST,
      port: env.REDIS_OPS_PORT,
      password: env.REDIS_OPS_PASSWORD,
      username: env.REDIS_OPS_USER,
      tls: env.REDIS_OPS_TLS,
    },
  },
  render: {
    serviceUrl: env.RENDER_SERVICE_URL,
    healthPath: env.RENDER_HEALTH_PATH,
    apiToken: env.RENDER_API_TOKEN,
  },
  solana: {
    rpcEndpoint: env.SOLANA_NETWORK,
  },
  pricing: {
    feedUrl: env.SOL_PRICE_FEED_URL,
  },
  server: {
    port: env.SERVER_PORT,
  },
  cache: {
    ttl: 30000, // 30 seconds
  },
  windows: {
    '24h': '24 hours',
    '7d': '7 days',
    '30d': '30 days',
  } as const,
};

export type Config = typeof config;

