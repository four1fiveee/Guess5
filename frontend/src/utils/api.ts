import { errorHandler, apiCallWithRetry } from './errorHandler';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:40000';

// API client with error handling
class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const defaultOptions: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    };

    const response = await fetch(url, defaultOptions);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw {
        response: {
          status: response.status,
          data: errorData
        }
      };
    }

    return response.json();
  }

  // Matchmaking
  async requestMatch(wallet: string, entryFee: number) {
    return apiCallWithRetry(() => 
      this.request('/api/match/request-match', {
        method: 'POST',
        body: JSON.stringify({ wallet, entryFee })
      }),
      'requestMatch'
    );
  }

  async getMatchStatus(matchId: string) {
    return apiCallWithRetry(() => 
      this.request(`/api/match/status/${matchId}`),
      'getMatchStatus'
    );
  }

  async checkPlayerMatch(wallet: string) {
    return apiCallWithRetry(() => 
      this.request(`/api/match/check-match/${wallet}`),
      'checkPlayerMatch'
    );
  }

  // Game actions
  async submitResult(matchId: string, wallet: string, result: any) {
    return apiCallWithRetry(() => 
      this.request('/api/match/submit-result', {
        method: 'POST',
        body: JSON.stringify({ matchId, wallet, result })
      }),
      'submitResult'
    );
  }

  async submitGuess(matchId: string, wallet: string, guess: string) {
    return apiCallWithRetry(() => 
      this.request('/api/match/submit-guess', {
        method: 'POST',
        body: JSON.stringify({ matchId, wallet, guess })
      }),
      'submitGuess'
    );
  }

  async getGameState(matchId: string) {
    return apiCallWithRetry(() => 
      this.request(`/api/match/game-state?matchId=${matchId}`),
      'getGameState'
    );
  }

  // Escrow and payments
  async confirmEscrow(matchId: string, wallet: string, escrowSignature: string) {
    return apiCallWithRetry(() => 
      this.request('/api/match/confirm-escrow', {
        method: 'POST',
        body: JSON.stringify({ matchId, wallet, escrowSignature })
      }),
      'confirmEscrow'
    );
  }

  async createEscrowTransaction(matchId: string, wallet: string, entryFee: number) {
    return apiCallWithRetry(() => 
      this.request('/api/match/create-escrow-transaction', {
        method: 'POST',
        body: JSON.stringify({ matchId, wallet, entryFee })
      }),
      'createEscrowTransaction'
    );
  }

  async executePayment(matchId: string, wallet: string) {
    return apiCallWithRetry(() => 
      this.request('/api/match/execute-payment', {
        method: 'POST',
        body: JSON.stringify({ matchId, wallet })
      }),
      'executePayment'
    );
  }

  // Cleanup
  async cleanupStuckMatches() {
    return apiCallWithRetry(() => 
      this.request('/api/match/cleanup-stuck-matches', {
        method: 'POST'
      }),
      'cleanupStuckMatches'
    );
  }

  // Health check
  async healthCheck() {
    return apiCallWithRetry(() => 
      this.request('/health'),
      'healthCheck'
    );
  }
}

// Export singleton instance
export const apiClient = new ApiClient(API_BASE_URL);

// Legacy functions for backward compatibility
export const requestMatch = (wallet: string, entryFee: number) => 
  apiClient.requestMatch(wallet, entryFee);

export const getMatchStatus = (matchId: string) => 
  apiClient.getMatchStatus(matchId);

export const checkPlayerMatch = (wallet: string) => 
  apiClient.checkPlayerMatch(wallet);

export const submitResult = (matchId: string, wallet: string, result: any) => 
  apiClient.submitResult(matchId, wallet, result);

export const submitGuess = (matchId: string, wallet: string, guess: string) => 
  apiClient.submitGuess(matchId, wallet, guess);

export const getGameState = (matchId: string) => 
  apiClient.getGameState(matchId);

export const confirmEscrow = (matchId: string, wallet: string, escrowSignature: string) => 
  apiClient.confirmEscrow(matchId, wallet, escrowSignature);

export const createEscrowTransaction = (matchId: string, wallet: string, entryFee: number) => 
  apiClient.createEscrowTransaction(matchId, wallet, entryFee);

export const executePayment = (matchId: string, wallet: string) => 
  apiClient.executePayment(matchId, wallet);

export const cleanupStuckMatches = () => 
  apiClient.cleanupStuckMatches();

export const healthCheck = () => 
  apiClient.healthCheck(); 