import WebSocket from 'ws';
import { Server } from 'http';
import { URL } from 'url';
import { enhancedLogger } from '../utils/enhancedLogger';

// WebSocket event types
export enum WebSocketEventType {
  MATCH_CREATED = 'match_created',
  PAYMENT_RECEIVED = 'payment_received',
  GAME_STARTED = 'game_started',
  GAME_COMPLETED = 'game_completed',
  OPPONENT_GUESS = 'opponent_guess',
  OPPONENT_SOLVED = 'opponent_solved',
  MATCH_CANCELLED = 'match_cancelled',
  ERROR = 'error'
}

// WebSocket event interface
export interface WebSocketEvent {
  type: WebSocketEventType;
  matchId: string;
  data: any;
  timestamp: string;
  correlationId?: string;
}

// WebSocket connection tracking
interface WebSocketConnection {
  ws: WebSocket;
  wallet: string;
  matchId?: string;
  isAlive: boolean;
  lastPing: number;
  pingInterval?: NodeJS.Timeout;
  reconnectAttempts: number;
  lastActivity: number;
}

class WebSocketService {
  private wss: any | null = null;
  private connections: Map<string, WebSocketConnection> = new Map();
  private matchSubscriptions: Map<string, Set<string>> = new Map(); // matchId -> Set of wallet addresses
  private walletConnections: Map<string, Set<string>> = new Map(); // wallet -> Set of connection IDs

  // Initialize WebSocket server
  initialize(server: Server) {
    const { WebSocketServer } = require('ws');
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws',
      clientTracking: true
    });

    this.setupEventHandlers();
    enhancedLogger.info('🔌 WebSocket server initialized', { path: '/ws' });
  }

  private setupEventHandlers() {
    if (!this.wss) return;

         this.wss.on('connection', (ws: WebSocket, req: any) => {
      const connectionId = this.generateConnectionId();
      const wallet = this.extractWalletFromRequest(req);
      
      if (!wallet) {
        enhancedLogger.error('WebSocket connection rejected - no wallet', { connectionId });
        ws.close(1008, 'Wallet address required');
        return;
      }

      // Store connection
      this.connections.set(connectionId, {
        ws,
        wallet,
        isAlive: true,
        lastPing: Date.now(),
        reconnectAttempts: 0,
        lastActivity: Date.now()
      });

      // Track wallet connections
      if (!this.walletConnections.has(wallet)) {
        this.walletConnections.set(wallet, new Set());
      }
      this.walletConnections.get(wallet)!.add(connectionId);

      enhancedLogger.info('🔌 WebSocket client connected', { 
        connectionId, 
        wallet,
        totalConnections: this.connections.size 
      });

      // Send welcome message
      this.sendToConnection(connectionId, {
        type: WebSocketEventType.MATCH_CREATED,
        matchId: 'welcome',
        data: { message: 'Connected to Guess5 WebSocket', wallet },
        timestamp: new Date().toISOString()
      });

      // Setup connection event handlers
      ws.on('message', (data) => this.handleMessage(connectionId, data));
      ws.on('close', () => this.handleDisconnect(connectionId));
      ws.on('error', (error: any) => this.handleError(connectionId, error));
      ws.on('pong', () => this.handlePong(connectionId));

      // Start ping interval for connection health monitoring
      this.startPingInterval(connectionId);

      // Connection is already started above
    });

    // Setup ping interval for all connections
    setInterval(() => this.pingAllConnections(), 30000); // 30 seconds
  }

  private generateConnectionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  private extractWalletFromRequest(req: any): string | null {
    try {
      const url = new URL(req.url, 'http://localhost');
      return url.searchParams.get('wallet');
    } catch (error: unknown) {
      return null;
    }
  }

  private handleMessage(connectionId: string, data: any) {
    try {
      const message = JSON.parse(data.toString());
      const connection = this.connections.get(connectionId);
      
      if (!connection) return;

      enhancedLogger.debug('📨 WebSocket message received', { 
        connectionId, 
        wallet: connection.wallet,
        messageType: message.type 
      });

      switch (message.type) {
        case 'subscribe_match':
          this.subscribeToMatch(connectionId, message.matchId);
          break;
        case 'unsubscribe_match':
          this.unsubscribeFromMatch(connectionId, message.matchId);
          break;
                 case 'ping':
           this.sendToConnection(connectionId, { 
             type: WebSocketEventType.MATCH_CREATED, 
             matchId: 'ping',
             data: { type: 'pong', timestamp: Date.now() },
             timestamp: new Date().toISOString()
           });
           break;
        default:
          enhancedLogger.warn('Unknown WebSocket message type', { 
            connectionId, 
            type: message.type 
          });
      }
    } catch (error: unknown) {
      enhancedLogger.error('Error handling WebSocket message', { connectionId, error });
    }
  }

  private handleDisconnect(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    enhancedLogger.info('🔌 WebSocket client disconnected', { 
      connectionId, 
      wallet: connection.wallet,
      reconnectAttempts: connection.reconnectAttempts
    });

    // Clean up ping interval
    if (connection.pingInterval) {
      clearInterval(connection.pingInterval);
    }

    // Clean up subscriptions
    if (connection.matchId) {
      this.unsubscribeFromMatch(connectionId, connection.matchId);
    }

    // Remove from wallet connections
    const walletConnections = this.walletConnections.get(connection.wallet);
    if (walletConnections) {
      walletConnections.delete(connectionId);
      if (walletConnections.size === 0) {
        this.walletConnections.delete(connection.wallet);
      }
    }

    // Remove connection
    this.connections.delete(connectionId);
  }

  private handleError(connectionId: string, error: any) {
    enhancedLogger.error('WebSocket connection error', { connectionId, error });
    this.handleDisconnect(connectionId);
  }

  private handlePong(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.isAlive = true;
      connection.lastPing = Date.now();
    }
  }

  private startPingInterval(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    const pingInterval = setInterval(() => {
      if (connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.ping();
        connection.lastPing = Date.now();
      } else {
        clearInterval(pingInterval);
        this.handleDisconnect(connectionId);
      }
    }, 30000); // 30 seconds

    // Store interval reference for cleanup
    connection.pingInterval = pingInterval;
  }

  private pingAllConnections() {
    const now = Date.now();
    for (const [connectionId, connection] of this.connections.entries()) {
      if (now - connection.lastPing > 60000) { // 60 seconds without pong
        enhancedLogger.warn('WebSocket connection timeout', { connectionId, wallet: connection.wallet });
        connection.ws.terminate();
        this.handleDisconnect(connectionId);
      }
    }
  }

  // Subscribe to match events
  private subscribeToMatch(connectionId: string, matchId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.matchId = matchId;

    if (!this.matchSubscriptions.has(matchId)) {
      this.matchSubscriptions.set(matchId, new Set());
    }
    this.matchSubscriptions.get(matchId)!.add(connection.wallet);

    enhancedLogger.info('📡 WebSocket subscribed to match', { 
      connectionId, 
      wallet: connection.wallet, 
      matchId 
    });
  }

  // Unsubscribe from match events
  private unsubscribeFromMatch(connectionId: string, matchId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    const subscriptions = this.matchSubscriptions.get(matchId);
    if (subscriptions) {
      subscriptions.delete(connection.wallet);
      if (subscriptions.size === 0) {
        this.matchSubscriptions.delete(matchId);
      }
    }

    enhancedLogger.info('📡 WebSocket unsubscribed from match', { 
      connectionId, 
      wallet: connection.wallet, 
      matchId 
    });
  }

     // Send event to specific connection
   private sendToConnection(connectionId: string, event: WebSocketEvent) {
     const connection = this.connections.get(connectionId);
     if (!connection || connection.ws.readyState !== WebSocket.OPEN) return;

    try {
      connection.ws.send(JSON.stringify(event));
    } catch (error: unknown) {
      enhancedLogger.error('Error sending WebSocket event', { connectionId, error });
      this.handleDisconnect(connectionId);
    }
  }

  // Broadcast event to all players in a match
  public broadcastToMatch(matchId: string, event: WebSocketEvent) {
    const subscriptions = this.matchSubscriptions.get(matchId);
    if (!subscriptions) return;

    enhancedLogger.info('📡 Broadcasting WebSocket event to match', { 
      matchId, 
      eventType: event.type,
      subscribers: subscriptions.size 
    });

    for (const wallet of subscriptions) {
      const walletConnections = this.walletConnections.get(wallet);
      if (walletConnections) {
        for (const connectionId of walletConnections) {
          this.sendToConnection(connectionId, event);
        }
      }
    }
  }

  // Send event to specific wallet
  public sendToWallet(wallet: string, event: WebSocketEvent) {
    const walletConnections = this.walletConnections.get(wallet);
    if (!walletConnections) return;

    enhancedLogger.info('📡 Sending WebSocket event to wallet', { 
      wallet, 
      eventType: event.type 
    });

    for (const connectionId of walletConnections) {
      this.sendToConnection(connectionId, event);
    }
  }

  // Get connection statistics
  public getStats() {
    return {
      totalConnections: this.connections.size,
      totalMatches: this.matchSubscriptions.size,
      totalWallets: this.walletConnections.size,
      connections: Array.from(this.connections.entries()).map(([id, conn]) => ({
        id,
        wallet: conn.wallet,
        matchId: conn.matchId,
        isAlive: conn.isAlive,
        lastPing: conn.lastPing
      }))
    };
  }
}

// Export singleton instance
export const websocketService = new WebSocketService();
