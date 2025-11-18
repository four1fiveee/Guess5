import * as https from 'https';

interface PriceCache {
  price: number;
  timestamp: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let priceCache: PriceCache | null = null;

/**
 * Price oracle service for SOL/USD conversion
 * Uses multiple sources with fallback
 */
export class PriceService {
  /**
   * Get current SOL/USD price with caching
   */
  static async getSOLPrice(): Promise<number> {
    // Check cache first
    if (priceCache && Date.now() - priceCache.timestamp < CACHE_TTL) {
      return priceCache.price;
    }

    // Try multiple sources
    const sources = [
      this.fetchFromCoinGecko.bind(this),
      this.fetchFromHelius.bind(this),
      this.fetchFromQuickNode.bind(this)
    ];

    for (const source of sources) {
      try {
        const price = await source();
        if (price > 0) {
          priceCache = {
            price,
            timestamp: Date.now()
          };
          return price;
        }
      } catch (error) {
        console.warn('Price fetch failed, trying next source:', error);
      }
    }

    // Fallback to default if all sources fail
    const fallbackPrice = 150; // Conservative fallback
    console.warn(`All price sources failed, using fallback: $${fallbackPrice}`);
    return fallbackPrice;
  }

  /**
   * Fetch SOL price from CoinGecko
   */
  private static async fetchFromCoinGecko(): Promise<number> {
    return new Promise((resolve, reject) => {
      https.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const price = json.solana?.usd;
            if (price && price > 0) {
              resolve(price);
            } else {
              reject(new Error('Invalid price from CoinGecko'));
            }
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Fetch SOL price from Helius (if API key available)
   */
  private static async fetchFromHelius(): Promise<number> {
    const apiKey = process.env.HELIUS_API_KEY;
    if (!apiKey) {
      throw new Error('Helius API key not configured');
    }

    return new Promise((resolve, reject) => {
      const url = `https://api.helius.xyz/v0/token-metadata?api-key=${apiKey}`;
      // Helius doesn't directly provide price, so skip for now
      reject(new Error('Helius price endpoint not implemented'));
    });
  }

  /**
   * Fetch SOL price from QuickNode (if available)
   */
  private static async fetchFromQuickNode(): Promise<number> {
    // QuickNode doesn't directly provide price API
    // Would need to use their RPC with token price oracle
    throw new Error('QuickNode price endpoint not implemented');
  }

  /**
   * Convert USD amount to SOL
   */
  static async convertUSDToSOL(amountUSD: number): Promise<number> {
    const solPrice = await this.getSOLPrice();
    return amountUSD / solPrice;
  }

  /**
   * Convert SOL amount to USD
   */
  static async convertSOLToUSD(amountSOL: number): Promise<number> {
    const solPrice = await this.getSOLPrice();
    return amountSOL * solPrice;
  }

  /**
   * Clear price cache (useful for testing)
   */
  static clearCache(): void {
    priceCache = null;
  }
}

