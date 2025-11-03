import { errorHandler, apiCallWithRetry } from './errorHandler';
import { config } from '../config/environment';

// API utility functions
// Bot protection is handled by Vercel Bot Protection + backend rate limiting
const API_BASE_URL = config.API_URL;

// Simplified API request function (reCAPTCHA removed - replaced with Vercel Bot Protection)
const apiRequest = async (
  endpoint: string, 
  options: RequestInit = {}
) => {
  const url = `${API_BASE_URL}${endpoint}`;
  
  // Basic headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const requestConfig: RequestInit = {
    ...options,
    headers,
  };

  try {
    // Add timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(url, {
      ...requestConfig,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`❌ API request failed for ${endpoint}:`, error);
    
    // Check if it's an abort error (timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('⏰ Request timed out after 30 seconds');
      throw new Error('Request timed out - please try again');
    }
    
    throw error;
  }
};

// API functions (reCAPTCHA removed)
export const requestMatch = async (wallet: string, entryFee: number) => {
  return apiCallWithRetry(() => 
    apiRequest('/api/match/request-match', {
      method: 'POST',
      body: JSON.stringify({ wallet, entryFee }),
    })
  );
};

export const submitResult = async (matchId: string, wallet: string, result: any) => {
  return apiCallWithRetry(() => 
    apiRequest('/api/match/submit-result', {
      method: 'POST',
      body: JSON.stringify({ matchId, wallet, result }),
    })
  );
};

export const submitGuess = async (matchId: string, wallet: string, guess: string) => {
  return apiRequest('/api/match/submit-guess', {
    method: 'POST',
    body: JSON.stringify({ matchId, wallet, guess }),
  });
};

export const confirmPayment = async (matchId: string, wallet: string, paymentSignature: string) => {
  return apiCallWithRetry(() => 
    apiRequest('/api/match/confirm-payment', {
      method: 'POST',
      body: JSON.stringify({ matchId, wallet, paymentSignature }),
    })
  );
};

export const getMatchStatus = async (matchId: string) => {
  return apiRequest(`/api/match/status/${matchId}`, {
    method: 'GET',
  });
};

export const checkPlayerMatch = async (walletAddress: string) => {
  return apiRequest(`/api/match/check-player-match/${walletAddress}`, {
    method: 'GET',
  });
};

export const getSolPrice = async () => {
  return apiRequest('/api/match/sol-price', {
    method: 'GET',
  });
};

export const getGameState = async (matchId: string, wallet: string) => {
  return apiRequest(`/api/match/game-state?matchId=${matchId}&wallet=${wallet}`, {
    method: 'GET',
  });
};
