import { Request } from 'express';

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug'
}

// Enhanced log entry interface
interface EnhancedLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  requestId?: string;
  userId?: string;
  url?: string;
  method?: string;
  ip?: string;
  data?: any;
  error?: any;
  performance?: {
    duration?: number;
    memory?: any;
  };
  context?: {
    matchId?: string;
    wallet?: string;
    action?: string;
    status?: string;
  };
}

// Enhanced Logger class for Phase 1 observability
class EnhancedLogger {
  private isDevelopment = process.env.NODE_ENV === 'development';
  private isProduction = process.env.NODE_ENV === 'production';

  private generateCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  private formatLog(level: LogLevel, message: string, data?: any, req?: Request, error?: any): EnhancedLogEntry {
    const logEntry: EnhancedLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      correlationId: this.generateCorrelationId(),
      data
    };

    if (req) {
      logEntry.url = (req as any).url;
      logEntry.method = (req as any).method;
      logEntry.ip = (req as any).ip;
      logEntry.requestId = (req as any).headers['x-request-id'] as string;
      logEntry.userId = (req as any).body?.wallet;
    }

    if (error) {
      logEntry.error = {
        message: error.message,
        stack: error.stack,
        name: error.name,
        code: error.code
      };
    }

    // Add performance metrics in production
    if (this.isProduction) {
      logEntry.performance = {
        memory: process.memoryUsage()
      };
    }

    return logEntry;
  }

  private output(level: LogLevel, message: string, data?: any, req?: Request, error?: any) {
    const logEntry = this.formatLog(level, message, data, req, error);
    
    if (this.isDevelopment) {
      // Development: Pretty console output
      const emoji = {
        [LogLevel.ERROR]: '❌',
        [LogLevel.WARN]: '⚠️',
        [LogLevel.INFO]: 'ℹ️',
        [LogLevel.DEBUG]: '🔍'
      };
      
      console.log(`${emoji[level]} [${level.toUpperCase()}] ${message}`);
      if (data) console.log('📊 Data:', data);
      if (error) console.log('🚨 Error:', error);
      if (logEntry.context) console.log('🎯 Context:', logEntry.context);
    } else {
      // Production: Structured JSON logging
      console.log(JSON.stringify(logEntry));
    }
  }

  // Enhanced logging methods with context
  error(message: string, error?: any, req?: Request, context?: any) {
    this.output(LogLevel.ERROR, message, context, req, error);
  }

  warn(message: string, data?: any, req?: Request, context?: any) {
    this.output(LogLevel.WARN, message, data, req);
  }

  info(message: string, data?: any, req?: Request, context?: any) {
    this.output(LogLevel.INFO, message, data, req);
  }

  debug(message: string, data?: any, req?: Request, context?: any) {
    if (this.isDevelopment) {
      this.output(LogLevel.DEBUG, message, data, req);
    }
  }

  // Specialized logging for matchmaking
  matchmaking(message: string, data?: any, req?: Request) {
    this.info(`🎮 MATCHMAKING: ${message}`, data, req, { action: 'matchmaking' });
  }

  // Specialized logging for payments
  payment(message: string, data?: any, req?: Request) {
    this.info(`💰 PAYMENT: ${message}`, data, req, { action: 'payment' });
  }

  // Specialized logging for atomic operations
  atomic(message: string, data?: any, req?: Request) {
    this.info(`🔒 ATOMIC: ${message}`, data, req, { action: 'atomic' });
  }

  // Specialized logging for idempotency
  idempotency(message: string, data?: any, req?: Request) {
    this.info(`🔄 IDEMPOTENCY: ${message}`, data, req, { action: 'idempotency' });
  }

  // Performance logging
  performance(operation: string, duration: number, data?: any) {
    this.info(`⚡ PERFORMANCE: ${operation} took ${duration}ms`, data, undefined, { 
      action: 'performance',
      duration 
    });
  }

  // Memory monitoring
  memory(message: string, data?: any) {
    this.warn(`🧠 MEMORY: ${message}`, data, undefined, { action: 'memory' });
  }
}

// Export singleton instance
export const enhancedLogger = new EnhancedLogger();
