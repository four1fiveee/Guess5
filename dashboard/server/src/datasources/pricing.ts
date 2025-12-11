import fetch from 'node-fetch';
import { config } from '../config';

let cachedPrice: { price: number; timestamp: number } | null = null;
const PRICE_CACHE_TTL = 60000; // 1 minute

export async function getSOLPrice(): Promise<number> {
  // Check cache
  if (cachedPrice && Date.now() - cachedPrice.timestamp < PRICE_CACHE_TTL) {
    return cachedPrice.price;
  }

  try {
    // Try backend endpoint first
    const backendUrl = `${config.render.serviceUrl}/price`;
    const response = await fetch(backendUrl, { timeout: 5000 } as any);
    if (response.ok) {
      const data = await response.json();
      const price = typeof data === 'number' ? data : data.price || data.solPrice;
      if (price && typeof price === 'number') {
        cachedPrice = { price, timestamp: Date.now() };
        return price;
      }
    }
  } catch (error) {
    // Fallback to CoinGecko or other API
  }

  // Fallback: try CoinGecko
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { timeout: 5000 } as any
    );
    if (response.ok) {
      const data = await response.json();
      const price = data.solana?.usd;
      if (price) {
        cachedPrice = { price, timestamp: Date.now() };
        return price;
      }
    }
  } catch (error) {
    // Ignore
  }

  // Return cached price if available, otherwise default
  if (cachedPrice) {
    return cachedPrice.price;
  }

  // Default fallback
  return 100; // Conservative default
}







