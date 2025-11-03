import { enhancedLogger } from '../utils/enhancedLogger';

// Correlation ID middleware for request tracking
export const correlationIdMiddleware = (req: any, res: any, next: any) => {
  // Generate or use existing correlation ID
  const correlationId = req.headers['x-correlation-id'] as string || 
                       req.headers['x-request-id'] as string || 
                       `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Add correlation ID to request object
  (req as any).correlationId = correlationId;

  // Add correlation ID to response headers
  res.setHeader('x-correlation-id', correlationId);

  // Log request with correlation ID
  enhancedLogger.info('📨 Incoming request', {
    correlationId,
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    ip: req.ip,
    wallet: req.headers['x-wallet-address'] || 'unknown'
  });

  // Add correlation ID to response for frontend tracking
  res.on('finish', () => {
    enhancedLogger.info('📤 Response sent', {
      correlationId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      contentLength: res.get('content-length') || 'unknown'
    });
  });

  next();
};

// Enhanced logging middleware for debugging edge cases
export const requestLoggingMiddleware = (req: any, res: any, next: any) => {
  const startTime = Date.now();
  const correlationId = (req as any).correlationId;

  // Log request body for debugging (excluding sensitive data)
  const loggableBody = { ...req.body };
  if (loggableBody.signature) {
    loggableBody.signature = `${loggableBody.signature.substring(0, 8)}...`;
  }
  if (loggableBody.password) {
    loggableBody.password = '[REDACTED]';
  }

  enhancedLogger.debug('🔍 Request details', {
    correlationId,
    body: loggableBody,
    query: req.query,
    params: req.params
  });

  // Override res.json to log response data
  const originalJson = res.json;
  res.json = function(data: any) {
    enhancedLogger.debug('📤 Response data', {
      correlationId,
      statusCode: res.statusCode,
      data: typeof data === 'object' ? JSON.stringify(data).substring(0, 500) + '...' : data
    });
    return originalJson.call(this, data);
  };

  // Log timing information
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    enhancedLogger.info('⏱️ Request completed', {
      correlationId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });
  });

  next();
};

// Error tracking middleware
export const errorTrackingMiddleware = (err: any, req: any, res: any, next: any) => {
  const correlationId = (req as any).correlationId;

  enhancedLogger.error('❌ Request error', {
    correlationId,
    error: err.message || err,
    stack: err.stack,
    method: req.method,
    url: req.url,
    body: req.body,
    headers: {
      'user-agent': req.headers['user-agent'],
      'x-wallet-address': req.headers['x-wallet-address']
    }
  });

  next(err);
};
