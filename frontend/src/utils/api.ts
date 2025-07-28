import axios from 'axios'

// Get API URL from environment
export const getApiUrl = () => {
  return process.env.NEXT_PUBLIC_API_URL;
}

// Create axios instance with proper configuration
export const apiClient = axios.create({
  baseURL: getApiUrl(),
  timeout: 30000, // Increased from 10000 to 30000 (30 seconds)
  headers: {
    'Content-Type': 'application/json',
  },
})

// Test backend connectivity
export const testBackendConnection = async () => {
  try {
    console.log('🔍 Testing backend connection...');
    const response = await axios.get(`${getApiUrl()}/health`, { 
      timeout: 15000, // Increased from 5000 to 15000 (15 seconds)
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    console.log('✅ Backend health check successful:', response.data);
    return true;
  } catch (error) {
    console.error('❌ Backend health check failed:', error);
    return false;
  }
}

// API functions with error handling
export const requestMatch = async (entryFee: number, wallet: string) => {
  try {
    console.log('🌐 Making API request to:', getApiUrl());
    console.log('📤 Request payload:', { entryFee, wallet });
    
    // Test backend connection first
    const isBackendHealthy = await testBackendConnection();
    if (!isBackendHealthy) {
      throw new Error('Backend server is not responding. Please check if the server is running.');
    }
    
    const response = await apiClient.post('/api/match/request-match', {
      entryFee,
      wallet,
    })
    
    console.log('✅ API response:', response.data);
    return response.data
  } catch (error: any) {
    console.error('❌ API Error details:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        baseURL: error.config?.baseURL
      }
    });
    
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Backend server is not responding. Please check if the server is running.');
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('Request timed out. The server may be overloaded or not responding.');
    } else if (error.response?.status === 404) {
      throw new Error('API endpoint not found. Please check the backend configuration.');
    } else if (error.response?.status >= 500) {
      throw new Error('Backend server error. Please try again later.');
    } else {
      throw new Error(`Failed to connect to server: ${error.message}`);
    }
  }
}

export const submitResult = async (matchId: string, wallet: string, result: any) => {
  try {
    const response = await apiClient.post('/api/match/submit-result', {
      matchId,
      wallet,
      result,
    })
    return response.data
  } catch (error) {
    console.error('API Error:', error)
    throw new Error('Failed to submit result.')
  }
}

export const getMatchStatus = async (matchId: string) => {
  try {
    const response = await apiClient.get(`/api/match/status/${matchId}`)
    return response.data
  } catch (error) {
    console.error('API Error:', error)
    throw new Error('Failed to get match status.')
  }
} 