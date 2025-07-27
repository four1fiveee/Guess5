import axios from 'axios'

// Get API URL from environment
export const getApiUrl = () => {
  return process.env.NEXT_PUBLIC_API_URL;
}

// Create axios instance with proper configuration
export const apiClient = axios.create({
  baseURL: getApiUrl(),
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// API functions with error handling
export const requestMatch = async (entryFee: number, wallet: string) => {
  try {
    console.log('🌐 Making API request to:', getApiUrl());
    console.log('📤 Request payload:', { entryFee, wallet });
    
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