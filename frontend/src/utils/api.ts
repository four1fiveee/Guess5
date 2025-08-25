import { errorHandler, apiCallWithRetry } from './errorHandler';

// API utility functions with ReCaptcha integration
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://guess5.onrender.com';

// Get ReCaptcha token for API requests
const getReCaptchaToken = async (action: string): Promise<string | null> => {
  try {
    console.log('🔄 Attempting to generate ReCaptcha token for action:', action);
    
    if (typeof window === 'undefined') {
      console.warn('⚠️ Window is undefined (server-side), skipping ReCaptcha');
      return null;
    }
    
    if (!window.grecaptcha) {
      console.warn('⚠️ ReCaptcha not loaded, skipping token generation');
      return null;
    }
    
    if (!window.grecaptcha.enterprise) {
      console.warn('⚠️ ReCaptcha Enterprise not available, skipping token generation');
      return null;
    }

    console.log('🔄 Calling grecaptcha.enterprise.execute...');
    const token = await window.grecaptcha.enterprise.execute(
      '6Lcq4JArAAAAAMzZI4o4TVaJANOpDBqqFtzBVqMI', 
      { action }
    );
    
    console.log(`✅ ReCaptcha token generated successfully for action: ${action}`);
    return token;
  } catch (error) {
    console.error('❌ ReCaptcha token generation failed:', error);
    console.error('❌ ReCaptcha error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined
    });
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
  
  console.log(`🌐 Making API request to: ${url}`);
  console.log(`🔍 Request details:`, { requireReCaptcha, reCaptchaAction, method: options.method });
  
  // Add ReCaptcha token if required
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (requireReCaptcha) {
    console.log('🔄 Generating ReCaptcha token...');
    const token = await getReCaptchaToken(reCaptchaAction);
    if (token) {
      headers['x-recaptcha-token'] = token;
      console.log('✅ ReCaptcha token added to headers');
    } else {
      console.warn('⚠️ ReCaptcha token generation failed, proceeding without token');
    }
  }

  const config: RequestInit = {
    ...options,
    headers,
  };

  console.log('📤 Sending request with config:', {
    url,
    method: config.method,
    headers: Object.keys(config.headers || {}),
    bodySize: config.body ? JSON.stringify(config.body).length : 0
  });

  try {
    console.log('🔄 Fetching response...');
    
    // Add timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 30000); // 30 second timeout
    
    const response = await fetch(url, {
      ...config,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    console.log(`📥 Response received: ${response.status} ${response.statusText}`);
    
    // Log additional response details for debugging
    console.log('📋 Response details:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      url: response.url
    });
    
    if (response.status === 429) {
      console.log('⚠️ Unexpected rate limit response, waiting before retry...');
      // Wait 1 second before throwing error to allow retry
      await new Promise(resolve => setTimeout(resolve, 1000));
      throw new Error('Unexpected rate limit, please try again later');
    }
    
    if (!response.ok) {
      console.error(`❌ HTTP error: ${response.status} ${response.statusText}`);
      const errorData = await response.json().catch(() => ({}));
      console.error('❌ Error response body:', errorData);
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    
    const responseData = await response.json();
    console.log('✅ API request successful, response data:', responseData);
    return responseData;
  } catch (error) {
    console.error(`❌ API request failed for ${endpoint}:`, error);
    console.error('❌ Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined
    });
    
    // Additional network diagnostics
    if (error instanceof Error) {
      console.error('🌐 Network diagnostics:', {
        errorName: error.name,
        errorMessage: error.message,
        isNetworkError: error.message.includes('network') || error.message.includes('fetch'),
        isTimeoutError: error.name === 'AbortError',
        isCorsError: error.message.includes('CORS') || error.message.includes('cors'),
        isReCaptchaError: error.message.includes('ReCaptcha') || error.message.includes('recaptcha')
      });
    }
    
    // Check if it's an abort error (timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('⏰ Request timed out after 30 seconds');
      throw new Error('Request timed out - please try again');
    }
    
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

export const submitResult = async (matchId: string, wallet: string, result: {
  won: boolean;
  numGuesses: number;
  totalTime: number;
  guesses: string[];
}) => {
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
  console.log('🔍 API: checkPlayerMatch called for wallet:', wallet);
  try {
    const result = await apiRequest(`/api/match/check-match/${wallet}`, {
      method: 'GET',
    }, false);
    console.log('🔍 API: checkPlayerMatch result:', result);
    return result;
  } catch (error) {
    console.error('🔍 API: checkPlayerMatch error:', error);
    throw error;
  }
};

export const getGameState = async (matchId: string, wallet: string) => {
  return apiRequest(`/api/match/game-state?matchId=${matchId}&wallet=${wallet}`, {
    method: 'GET',
  }, false);
};

const api = {
  requestMatch,
  submitResult,
  submitGuess,
  confirmPayment,
  getMatchStatus,
  checkPlayerMatch,
  getGameState,
};

export default api; 