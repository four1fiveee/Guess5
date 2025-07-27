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
    const response = await apiClient.post('/api/match/request-match', {
      entryFee,
      wallet,
    })
    return response.data
  } catch (error) {
    console.error('API Error:', error)
    throw new Error('Failed to connect to server. Please check your connection.')
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