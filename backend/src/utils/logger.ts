import { Request } from 'express';

// Log levels
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug'
}

// Log entry interface
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
  requestId?: string;
  userId?: string;
  url?: string;
  method?: string;
  ip?: string;
}

// Logger class
class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development';

  private formatLog(level: LogLevel, message: string, data?: any, req?: Request): LogEntry {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data
    };

    if (req) {
      logEntry.url = (req as any).url;
      logEntry.method = (req as any).method;
      logEntry.ip = (req as any).ip;
      logEntry.requestId = (req as any).headers['x-request-id'] as string;
      logEntry.userId = (req as any).body?.wallet;
    }

    return logEntry;
  }

  private output(level: LogLevel, message: string, data?: any, req?: Request) {
    const logEntry = this.formatLog(level, message, data, req);
    
    if (this.isDevelopment) {
      // Development: Pretty print with colors
      const colors = {
        error: '\x1b[31m', // Red
        warn: '\x1b[33m',  // Yellow
        info: '\x1b[36m',  // Cyan
        debug: '\x1b[35m'  // Magenta
      };
      
      console.log(`${colors[level]}${level.toUpperCase()}\x1b[0m ${message}`, data || '');
    } else {
      // Production: JSON structured logging
      console.log(JSON.stringify(logEntry));
    }
  }

  error(message: string, data?: any, req?: Request) {
    this.output(LogLevel.ERROR, message, data, req);
  }

  warn(message: string, data?: any, req?: Request) {
    this.output(LogLevel.WARN, message, data, req);
  }

  info(message: string, data?: any, req?: Request) {
    this.output(LogLevel.INFO, message, data, req);
  }

  debug(message: string, data?: any, req?: Request) {
    if (this.isDevelopment) {
      this.output(LogLevel.DEBUG, message, data, req);
    }
  }

  // Game-specific logging methods
  gameStart(matchId: string, player1: string, player2: string, word: string) {
    this.info('Game started', { matchId, player1, player2, wordLength: word.length });
  }

  gameEnd(matchId: string, winner: string, loser: string, payout: number) {
    this.info('Game ended', { matchId, winner, loser, payout });
  }

  matchmaking(wallet: string, entryFee: number, matched: boolean) {
    this.info('Matchmaking', { wallet, entryFee, matched });
  }

  payment(matchId: string, amount: number, recipient: string) {
    this.info('Payment processed', { matchId, amount, recipient });
  }

  gameError(matchId: string, error: string, details?: any) {
    this.error('Game error', { matchId, error, details });
  }
}

// Export singleton instance
export const logger = new Logger();

// Request logging middleware
export const requestLogger = (req: Request, res: any, next: any) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('Request completed', {
      method: (req as any).method,
      url: (req as any).url,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: (req as any).headers['user-agent']
    });
  });

  next();
}; 