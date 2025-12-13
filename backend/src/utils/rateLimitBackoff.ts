/**
 * Rate Limit Backoff Utility
 * 
 * Provides exponential backoff for RPC calls to handle 429 rate limits gracefully.
 * Used throughout the codebase for all on-chain operations.
 */

export interface BackoffOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  retryableErrors?: string[];
}

const DEFAULT_OPTIONS: Required<BackoffOptions> = {
  maxAttempts: 5,
  baseDelay: 500,
  maxDelay: 30000,
  retryableErrors: ['429', 'Too Many Requests', 'rate limit', 'Rate limit'],
};

/**
 * Check if an error is a rate limit error
 */
export function isRateLimitError(error: any): boolean {
  if (!error) return false;
  
  const errorMessage = error?.message || String(error) || '';
  const errorCode = error?.code || '';
  
  return (
    errorMessage.includes('429') ||
    errorMessage.includes('Too Many Requests') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('Rate limit') ||
    errorCode === 429 ||
    errorCode === '429'
  );
}

/**
 * Execute a function with exponential backoff for rate limit errors
 * 
 * @param fn Function to execute
 * @param options Backoff options
 * @returns Result of the function
 */
export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: BackoffOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any = null;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check if this is a retryable error
      const isRetryable = isRateLimitError(error) || 
        opts.retryableErrors?.some(pattern => 
          (error?.message || String(error)).includes(pattern)
        );

      if (!isRetryable || attempt >= opts.maxAttempts) {
        // Not retryable or last attempt - throw
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        opts.baseDelay * Math.pow(2, attempt - 1),
        opts.maxDelay
      );

      console.warn(`⚠️ Rate limit detected (attempt ${attempt}/${opts.maxAttempts}), retrying in ${delay}ms`, {
        error: error?.message || String(error),
        delay,
        attempt,
        maxAttempts: opts.maxAttempts,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError || new Error('All retry attempts exhausted');
}

/**
 * Execute a function with exponential backoff, but only for rate limit errors
 * Other errors are thrown immediately
 */
export async function withRateLimitBackoff<T>(
  fn: () => Promise<T>,
  options: BackoffOptions = {}
): Promise<T> {
  return withExponentialBackoff(fn, {
    ...options,
    retryableErrors: ['429', 'Too Many Requests', 'rate limit', 'Rate limit'],
  });
}

