const axios = require('axios');

/**
 * Fetches SOL price from various APIs with fallbacks
 * This runs on the backend to avoid CORS issues
 */
export async function fetchSolPrice(): Promise<number> {
  // Try CoinGecko first
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { timeout: 5000 }
    );
    
    if (response.data?.solana?.usd) {
      const price = response.data.solana.usd;
      console.log(`✅ CoinGecko SOL price: $${price}`);
      return price;
    }
  } catch (error) {
    console.log('⚠️ CoinGecko failed, trying Binance...', error instanceof Error ? error.message : String(error));
  }

  // Try Binance as fallback
  try {
    const response = await axios.get(
      'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
      { timeout: 5000 }
    );
    
    if (response.data?.price) {
      const price = parseFloat(response.data.price);
      console.log(`✅ Binance SOL price: $${price}`);
      return price;
    }
  } catch (error) {
    console.log('⚠️ Binance failed, trying Coinbase...', error instanceof Error ? error.message : String(error));
  }

  // Try Coinbase as second fallback
  try {
    const response = await axios.get(
      'https://api.coinbase.com/v2/exchange-rates?currency=SOL',
      { timeout: 5000 }
    );
    
    if (response.data?.data?.rates?.USD) {
      const price = parseFloat(response.data.data.rates.USD);
      console.log(`✅ Coinbase SOL price: $${price}`);
      return price;
    }
  } catch (error) {
    console.log('⚠️ Coinbase failed', error instanceof Error ? error.message : String(error));
  }

  // If all APIs fail, return a reasonable fallback
  console.warn('⚠️ All SOL price APIs failed, using fallback price: $180');
  return 180; // More reasonable fallback than $100
}

// Handler for the API endpoint
export const getSolPriceHandler = async (req: any, res: any) => {
  try {
    const price = await fetchSolPrice();
    res.json({ price, timestamp: Date.now() });
  } catch (error) {
    console.error('❌ Error fetching SOL price:', error);
    res.status(500).json({ error: 'Failed to fetch SOL price', fallback: 180 });
  }
};

