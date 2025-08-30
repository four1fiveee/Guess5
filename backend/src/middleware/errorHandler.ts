import { Request, Response, NextFunction } from 'express';
import { enhancedLogger } from '../utils/enhancedLogger';

// Enhanced error types for better frontend compatibility
export enum BackendErrorType {
  NETWORK_TIMEOUT = 'network_timeout',
  VALIDATION_ERROR = 'validation_error',
  RATE_LIMIT = 'rate_limit',
  STORAGE_ERROR = 'storage_error',
  GAME_STATE_ERROR = 'game_state_error',
  PAYMENT_ERROR = 'payment_error',
  MATCHMAKING_ERROR = 'matchmaking_error',
  UNKNOWN_ERROR = 'unknown_error'
}

export interface BackendError {
  type: BackendErrorType;
  message: string;
  details?: any;
  retryable: boolean;
  correlationId?: string;
}

// Enhanced error handler middleware
export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  const correlationId = req.headers['x-correlation-id'] as string || `req-${Date.now()}`;
  
  // Log the error with correlation ID for tracking
  enhancedLogger.error('❌ Backend error occurred:', {
    correlationId,
    error: err.message || err,
    stack: err.stack,
    url: req.url,
    method: req.method,
    userAgent: req.headers['user-agent'],
    ip: req.ip
  });

  // Enhanced error classification
  let backendError: BackendError;

  if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
    backendError = {
      type: BackendErrorType.NETWORK_TIMEOUT,
      message: 'Request timed out - please try again',
      details: { originalError: err.message },
      retryable: true,
      correlationId
    };
    res.status(408);
  } else if (err.name === 'ValidationError' || err.status === 400) {
    backendError = {
      type: BackendErrorType.VALIDATION_ERROR,
      message: err.message || 'Invalid request data',
      details: { validationErrors: err.errors },
      retryable: false,
      correlationId
    };
    res.status(400);
  } else if (err.status === 429) {
    backendError = {
      type: BackendErrorType.RATE_LIMIT,
      message: 'Too many requests - please wait a moment',
      details: { retryAfter: err.retryAfter },
      retryable: true,
      correlationId
    };
    res.status(429);
  } else if (err.name === 'RedisError' || err.message?.includes('Redis')) {
    backendError = {
      type: BackendErrorType.STORAGE_ERROR,
      message: 'Storage service temporarily unavailable',
      details: { originalError: err.message },
      retryable: true,
      correlationId
    };
    res.status(503);
  } else if (err.message?.includes('game state') || err.message?.includes('match')) {
    backendError = {
      type: BackendErrorType.GAME_STATE_ERROR,
      message: 'Game state error - please refresh and try again',
      details: { originalError: err.message },
      retryable: true,
      correlationId
    };
    res.status(409);
  } else if (err.message?.includes('payment') || err.message?.includes('transaction')) {
    backendError = {
      type: BackendErrorType.PAYMENT_ERROR,
      message: 'Payment processing error - please try again',
      details: { originalError: err.message },
      retryable: true,
      correlationId
    };
    res.status(422);
  } else if (err.message?.includes('matchmaking') || err.message?.includes('queue')) {
    backendError = {
      type: BackendErrorType.MATCHMAKING_ERROR,
      message: 'Matchmaking service temporarily unavailable',
      details: { originalError: err.message },
      retryable: true,
      correlationId
    };
    res.status(503);
  } else {
    // Default error handling
    backendError = {
      type: BackendErrorType.UNKNOWN_ERROR,
      message: 'An unexpected error occurred',
      details: { originalError: err.message },
      retryable: false,
      correlationId
    };
    res.status(500);
  }

  // Send consistent error response
  res.json({
    error: backendError.message,
    type: backendError.type,
    retryable: backendError.retryable,
    correlationId: backendError.correlationId,
    ...(process.env.NODE_ENV === 'development' && { details: backendError.details })
  });
};

// Enhanced timeout middleware for long-running operations
export const timeoutHandler = (timeoutMs: number = 30000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeoutId = setTimeout(() => {
      const error = new Error('Request timeout');
      error.name = 'TimeoutError';
      next(error);
    }, timeoutMs);

    // Clear timeout on response
    res.on('finish', () => {
      clearTimeout(timeoutId);
    });

    next();
  };
};

// Enhanced retry logic for database operations
export const withRetry = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> => {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        throw error;
      }

      // Only retry on certain error types
      if (error.name === 'TimeoutError' || 
          error.message?.includes('timeout') ||
          error.message?.includes('connection') ||
          error.message?.includes('Redis')) {
        
        const delay = baseDelay * Math.pow(2, attempt);
        enhancedLogger.warn(`⚠️ Retrying operation (attempt ${attempt + 1}/${maxRetries}) in ${delay}ms`, {
          error: error.message,
          attempt
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // Don't retry on validation or other non-retryable errors
        throw error;
      }
    }
  }

  throw lastError;
};

// Health check endpoint with detailed status
export const healthCheck = async (req: Request, res: Response) => {
  try {
    const { AppDataSource } = require('../db/index');
    const { checkRedisHealth } = require('../config/redis');
    const { websocketService } = require('../services/websocketService');

    // Check database connection
    const dbStatus = AppDataSource.isInitialized ? 'healthy' : 'unhealthy';
    
    // Check Redis connections
    const redisStatus = await checkRedisHealth();
    
    // Check WebSocket service
    const wsStats = websocketService.getStats();
    const wsStatus = wsStats.totalConnections >= 0 ? 'healthy' : 'unhealthy';

    const healthStatus = {
      timestamp: new Date().toISOString(),
      status: dbStatus === 'healthy' && redisStatus.overall === 'healthy' && wsStatus === 'healthy' ? 'healthy' : 'degraded',
      services: {
        database: dbStatus,
        redis: redisStatus,
        websocket: wsStatus
      },
      stats: {
        websocketConnections: wsStats.totalConnections,
        activeMatches: wsStats.totalMatches,
        uniqueWallets: wsStats.totalWallets
      }
    };

    const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(healthStatus);
  } catch (error) {
    enhancedLogger.error('❌ Health check failed:', error);
    res.status(503).json({
      timestamp: new Date().toISOString(),
      status: 'unhealthy',
      error: 'Health check failed'
    });
  }
}; 