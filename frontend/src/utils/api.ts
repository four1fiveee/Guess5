import { errorHandler, apiCallWithRetry } from './errorHandler';

// API utility functions with ReCaptcha integration
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://guess5.onrender.com';

// Get ReCaptcha token for API requests
const getReCaptchaToken = async (action: string): Promise<string | null> => {
  try {

    
    if (typeof window === 'undefined') {
      console.warn('⚠️ Window is undefined (server-side), skipping ReCaptcha');
      return null;
    }
    
    // Wait for ReCaptcha to be ready
    let attempts = 0;
    const maxAttempts = 10;
    
    while (!window.grecaptcha && attempts < maxAttempts) {
      console.log(`⏳ Waiting for ReCaptcha to load... (attempt ${attempts + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }
    
    if (!window.grecaptcha) {
      console.warn('⚠️ ReCaptcha not loaded after waiting, skipping token generation');
      throw new Error('ReCaptcha not loaded - please refresh the page');
    }
    
    if (!window.grecaptcha.enterprise) {
      console.warn('⚠️ ReCaptcha Enterprise not available, skipping token generation');
      throw new Error('ReCaptcha Enterprise not available - please refresh the page');
    }

    const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || '6Lcq4JArAAAAAMzZI4o4TVaJANOpDBqqFtzBVqMI';
    
    if (!siteKey || siteKey === '6Lcq4JArAAAAAMzZI4o4TVaJANOpDBqqFtzBVqMI') {
      console.warn('⚠️ Using fallback ReCaptcha site key - check environment variable configuration');
    }
    

    const token = await window.grecaptcha.enterprise.execute(siteKey, { action });
    
    if (!token || typeof token !== 'string' || token.length < 10) {
      console.error('❌ ReCaptcha returned invalid token:', token);
      throw new Error('ReCaptcha returned invalid token - please try again');
    }
    

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
  
  
  
  
  // Add ReCaptcha token if required
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (requireReCaptcha) {

    let token = null;
    let retryCount = 0;
    const maxRetries = 2;
    
    while (!token && retryCount < maxRetries) {
      try {
        token = await getReCaptchaToken(reCaptchaAction);
        if (token) {
          headers['x-recaptcha-token'] = token;
      
          break;
        } else {
          console.warn(`⚠️ ReCaptcha token generation failed (attempt ${retryCount + 1}/${maxRetries})`);
          retryCount++;
          if (retryCount < maxRetries) {
            // Wait a bit before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      } catch (error) {
        console.error(`❌ ReCaptcha token generation error (attempt ${retryCount + 1}/${maxRetries}):`, error);
        retryCount++;
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    if (!token) {
      console.error('❌ ReCaptcha token generation failed after all retries');
      throw new Error('ReCaptcha verification failed - please refresh the page and try again');
    }
  }

  const config: RequestInit = {
    ...options,
    headers,
  };



  try {

    
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
        isReCaptchaError: error.message.includes('ReCaptcha') || error.message.includes('recaptcha'),
        isCspError: error.message.includes('CSP') || error.message.includes('Content Security Policy'),
        isBlockedError: error.message.includes('blocked') || error.message.includes('forbidden')
      });
      
      // Log CSP-specific errors
      if (error.message.includes('CSP') || error.message.includes('Content Security Policy') || error.message.includes('blocked')) {
        console.error('🚫 CSP/Blocking Error detected - this might be the root cause of silent failures');
        console.error('🚫 Error details:', {
          url,
          method: config.method,
          headers: Object.keys(config.headers || {}),
          error: error.message
        });
      }
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
  console.log('🎯 submitResult called with:', { matchId, wallet, result });
  console.log('🎯 API_BASE_URL:', API_BASE_URL);
  console.log('🎯 Full URL will be:', `${API_BASE_URL}/api/match/submit-result`);
  
  try {
    const response = await apiRequest('/api/match/submit-result', {
      method: 'POST',
      body: JSON.stringify({ matchId, wallet, result }),
    }, true, 'submit_result');
    

    return response;
  } catch (error) {
    console.error('❌ submitResult failed:', error);
    console.error('❌ submitResult error details:', {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
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
  
  try {
    const result = await apiRequest(`/api/match/check-match/${wallet}`, {
      method: 'GET',
    }, false);

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