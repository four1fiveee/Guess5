import { errorHandler, apiCallWithRetry } from './errorHandler';

// API utility functions with ReCaptcha integration
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://guess5.onrender.com';

// Get ReCaptcha token for API requests
const getReCaptchaToken = async (action: string): Promise<string | null> => {
  try {
    if (typeof window === 'undefined' || !window.grecaptcha?.enterprise) {
      console.warn('ReCaptcha not available, skipping token generation');
      return null;
    }

    const token = await window.grecaptcha.enterprise.execute(
      '6Lcq4JArAAAAAMzZI4o4TVaJANOpDBqqFtzBVqMI', 
      { action }
    );
    
    console.log(`✅ ReCaptcha token generated for action: ${action}`);
    return token;
  } catch (error) {
    console.error('❌ ReCaptcha token generation failed:', error);
    return null;
  }
};

// Enhanced API request function with ReCaptcha
const apiRequest = async (
  endpoint: string, 
  options: RequestInit = {}, 
  requireReCaptcha: boolean = false,
  reCaptchaAction: string = 'api_request'
) => {
  const url = `${API_BASE_URL}${endpoint}`;
  
  // Add ReCaptcha token if required
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (requireReCaptcha) {
    const token = await getReCaptchaToken(reCaptchaAction);
    if (token) {
      headers['x-recaptcha-token'] = token;
    }
  }

  const config: RequestInit = {
    ...options,
    headers,
  };

  try {
    const response = await fetch(url, config);
    
    if (response.status === 429) {
      console.log('⚠️ Unexpected rate limit response, waiting before retry...');
      // Wait 1 second before throwing error to allow retry
      await new Promise(resolve => setTimeout(resolve, 1000));
      throw new Error('Unexpected rate limit, please try again later');
    }
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`❌ API request failed for ${endpoint}:`, error);
    throw error;
  }
};

// API functions with ReCaptcha integration
export const requestMatch = async (wallet: string, entryFee: number) => {
  return apiRequest('/api/match/request-match', {
    method: 'POST',
    body: JSON.stringify({ wallet, entryFee }),
  }, true, 'request_match');
};

export const submitResult = async (matchId: string, wallet: string, result: any) => {
  return apiRequest('/api/match/submit-result', {
    method: 'POST',
    body: JSON.stringify({ matchId, wallet, result }),
  }, true, 'submit_result');
};

export const submitGuess = async (matchId: string, wallet: string, guess: string) => {
  return apiRequest('/api/match/submit-guess', {
    method: 'POST',
    body: JSON.stringify({ matchId, wallet, guess }),
  }, true, 'submit_guess');
};

export const confirmPayment = async (matchId: string, wallet: string, paymentSignature: string) => {
  return apiRequest('/api/match/confirm-payment', {
    method: 'POST',
    body: JSON.stringify({ matchId, wallet, paymentSignature }),
  }, true, 'confirm_payment');
};

// Non-critical endpoints (no ReCaptcha required)
export const getMatchStatus = async (matchId: string) => {
  return apiRequest(`/api/match/status/${matchId}`, {
    method: 'GET',
  }, false);
};

export const checkPlayerMatch = async (wallet: string) => {
  return apiRequest(`/api/match/check-match/${wallet}`, {
    method: 'GET',
  }, false);
};

export const getGameState = async (matchId: string, wallet: string) => {
  return apiRequest(`/api/match/game-state?matchId=${matchId}&wallet=${wallet}`, {
    method: 'GET',
  }, false);
};

export default {
  requestMatch,
  submitResult,
  submitGuess,
  confirmPayment,
  getMatchStatus,
  checkPlayerMatch,
  getGameState,
}; 