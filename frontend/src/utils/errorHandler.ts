// Error types
export enum ErrorType {
  NETWORK = 'network',
  VALIDATION = 'validation',
  WALLET = 'wallet',
  GAME = 'game',
  UNKNOWN = 'unknown'
}

// Error interface
export interface AppError {
  type: ErrorType;
  message: string;
  details?: any;
  retryable?: boolean;
}

// Error handler class
export class ErrorHandler {
  private static instance: ErrorHandler;
  private errorCount = 0;
  private lastErrorTime = 0;

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  // Handle API errors
  handleApiError(error: any, context?: string): AppError {
    console.error('API Error:', { error, context });

    if (error.response) {
      // Server responded with error status
      const status = error.response.status;
      const data = error.response.data;

      if (status === 429) {
        return {
          type: ErrorType.NETWORK,
          message: 'Too many requests. Please wait a moment and try again.',
          details: data,
          retryable: true
        };
      }

      if (status === 500) {
        return {
          type: ErrorType.NETWORK,
          message: 'Server error. Please try again later.',
          details: data,
          retryable: true
        };
      }

      if (status === 400) {
        return {
          type: ErrorType.VALIDATION,
          message: data.error || 'Invalid request data.',
          details: data
        };
      }

      return {
        type: ErrorType.NETWORK,
        message: `Request failed (${status}): ${data.error || 'Unknown error'}`,
        details: data
      };
    }

    if (error.request) {
      // Network error
      return {
        type: ErrorType.NETWORK,
        message: 'Network error. Please check your connection and try again.',
        details: error.message,
        retryable: true
      };
    }

    return {
      type: ErrorType.UNKNOWN,
      message: 'An unexpected error occurred.',
      details: error.message
    };
  }

  // Handle wallet errors
  handleWalletError(error: any): AppError {
    console.error('Wallet Error:', error);

    if (error.code === 4001) {
      return {
        type: ErrorType.WALLET,
        message: 'Transaction was rejected by user.',
        details: error
      };
    }

    if (error.message?.includes('insufficient funds')) {
      return {
        type: ErrorType.WALLET,
        message: 'Insufficient SOL balance. Please add more SOL to your wallet.',
        details: error
      };
    }

    if (error.message?.includes('User rejected')) {
      return {
        type: ErrorType.WALLET,
        message: 'Transaction was cancelled.',
        details: error
      };
    }

    return {
      type: ErrorType.WALLET,
      message: 'Wallet error. Please try again.',
      details: error,
      retryable: true
    };
  }

  // Handle game errors
  handleGameError(error: any): AppError {
    console.error('Game Error:', error);

    if (error.message?.includes('match not found')) {
      return {
        type: ErrorType.GAME,
        message: 'Game not found. Please start a new match.',
        details: error
      };
    }

    if (error.message?.includes('already in progress')) {
      return {
        type: ErrorType.GAME,
        message: 'Game is already in progress.',
        details: error
      };
    }

    return {
      type: ErrorType.GAME,
      message: 'Game error. Please try again.',
      details: error,
      retryable: true
    };
  }

  // Show error to user
  showError(error: AppError): void {
    // Rate limit error display
    const now = Date.now();
    if (now - this.lastErrorTime < 2000) {
      this.errorCount++;
      if (this.errorCount > 3) {
        return; // Don't spam errors
      }
    } else {
      this.errorCount = 0;
    }
    this.lastErrorTime = now;

    // In a real app, you'd use a toast notification library
    // For now, we'll use console and alert
    console.error('User Error:', error);
    
    if (typeof window !== 'undefined') {
      alert(`${error.message}\n\nType: ${error.type}\n${error.details ? `Details: ${JSON.stringify(error.details)}` : ''}`);
    }
  }

  // Retry with exponential backoff
  async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries) {
          throw error;
        }

        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`Retry attempt ${attempt + 1}/${maxRetries} in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }
}

// Export singleton
export const errorHandler = ErrorHandler.getInstance();

// Utility function for API calls with retry
export const apiCallWithRetry = async <T>(
  apiCall: () => Promise<T>,
  context?: string
): Promise<T> => {
  try {
    return await errorHandler.retryWithBackoff(apiCall);
  } catch (error) {
    const appError = errorHandler.handleApiError(error, context);
    errorHandler.showError(appError);
    throw appError;
  }
}; 