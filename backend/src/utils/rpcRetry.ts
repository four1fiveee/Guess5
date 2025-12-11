import { enhancedLogger } from './enhancedLogger';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
  shouldRetry?: (error: Error) => boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'shouldRetry'>> = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 5000,
};

/**
 * Retry an async operation with exponential backoff
 * Automatically retries on rate limit errors (429) and network errors
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = DEFAULT_OPTIONS.maxAttempts,
    baseDelayMs = DEFAULT_OPTIONS.baseDelayMs,
    maxDelayMs = DEFAULT_OPTIONS.maxDelayMs,
    onRetry,
    shouldRetry,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      // Check if we should retry this error
      const isRetryable = shouldRetry
        ? shouldRetry(err)
        : isRetryableError(err);

      if (!isRetryable || attempt === maxAttempts) {
        // Don't retry if error is not retryable or we've exhausted attempts
        throw err;
      }

      // Calculate delay with exponential backoff
      const delayMs = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1),
        maxDelayMs
      );

      // Log retry attempt
      enhancedLogger.warn('🔄 RPC retry attempt', {
        attempt,
        maxAttempts,
        delayMs,
        error: err.message,
        errorType: err.constructor.name,
        isRateLimit: err.message.includes('429') || err.message.includes('Too Many Requests'),
      });

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(attempt, err);
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error('Retry exhausted without result');
}

/**
 * Check if an error is retryable (rate limits, network errors, etc.)
 */
function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  
  // Rate limiting errors
  if (message.includes('429') || 
      message.includes('too many requests') ||
      message.includes('rate limit')) {
    return true;
  }

  // Network errors
  if (message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('etimedout')) {
    return true;
  }

  // Solana RPC errors that are often transient
  if (message.includes('rpc') && (
      message.includes('error') ||
      message.includes('failed') ||
      message.includes('unavailable'))) {
    return true;
  }

  // Don't retry on validation errors, authentication errors, etc.
  return false;
}

/**
 * Wrap a Connection method with retry logic
 */
export function wrapConnectionMethod<T extends (...args: any[]) => Promise<any>>(
  method: T,
  methodName: string
): T {
  return (async (...args: Parameters<T>) => {
    return withRetry(
      () => method(...args),
      {
        maxAttempts: 3,
        baseDelayMs: 250,
        maxDelayMs: 5000,
        onRetry: (attempt, error) => {
          enhancedLogger.warn(`🔄 Retrying ${methodName}`, {
            attempt,
            error: error.message,
            args: args.length > 0 ? 'provided' : 'none',
          });
        },
      }
    ) as ReturnType<T>;
  }) as T;
}

/**
 * Wrap accounts.fromAccountAddress calls with retry logic
 */
export async function fromAccountAddressWithRetry<T>(
  accountClass: { fromAccountAddress: (connection: any, address: any, commitment?: string) => Promise<T> },
  connection: any,
  address: any,
  commitment?: string
): Promise<T> {
  return withRetry(
    () => accountClass.fromAccountAddress(connection, address, commitment),
    {
      maxAttempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 5000,
      onRetry: (attempt, error) => {
        enhancedLogger.warn('🔄 Retrying fromAccountAddress', {
          attempt,
          address: address?.toString?.() || String(address),
          error: error.message,
        });
      },
    }
  );
}

