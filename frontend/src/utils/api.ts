import axios from 'axios'

// Get API URL with fallback
export const getApiUrl = () => {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
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
    const response = await apiClient.post('/api/match/request', {
      entryFee,
      wallet,
    })
    return response.data
  } catch (error) {
    console.error('API Error:', error)
    throw new Error('Failed to connect to server. Please check your connection.')
  }
}

export const confirmMatch = async (matchId: string, wallet: string) => {
  try {
    const response = await apiClient.post('/api/match/confirm', {
      matchId,
      wallet,
    })
    return response.data
  } catch (error) {
    console.error('API Error:', error)
    throw new Error('Failed to confirm match.')
  }
} 