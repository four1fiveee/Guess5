import { useState, useEffect, useRef, useCallback } from 'react';

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

// WebSocket connection state
export interface WebSocketState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  lastEvent: WebSocketEvent | null;
}

// WebSocket hook options
export interface UseWebSocketOptions {
  wallet: string | null;
  matchId?: string;
  autoConnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

// WebSocket hook return type
export interface UseWebSocketReturn {
  state: WebSocketState;
  connect: () => void;
  disconnect: () => void;
  subscribeToMatch: (matchId: string) => void;
  unsubscribeFromMatch: (matchId: string) => void;
  sendMessage: (message: any) => void;
  addEventHandler: (eventType: WebSocketEventType, handler: (event: WebSocketEvent) => void) => void;
  removeEventHandler: (eventType: WebSocketEventType, handler: (event: WebSocketEvent) => void) => void;
}

export const useWebSocket = (options: UseWebSocketOptions): UseWebSocketReturn => {
  const {
    wallet,
    matchId,
    autoConnect = true,
    reconnectInterval = 5000,
    maxReconnectAttempts = 5
  } = options;

  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    lastEvent: null
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const eventHandlersRef = useRef<Map<WebSocketEventType, ((event: WebSocketEvent) => void)[]>>(new Map());

  // Get WebSocket URL
  const getWebSocketUrl = useCallback(() => {
    if (!wallet) return null;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = process.env.NEXT_PUBLIC_API_URL?.replace(/^https?:\/\//, '') || 'localhost:40000';
    return `${protocol}//${host}/ws?wallet=${wallet}`;
  }, [wallet]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!wallet || state.isConnected || state.isConnecting) return;

    const url = getWebSocketUrl();
    if (!url) return;

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
    
        setState(prev => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
          error: null
        }));
        reconnectAttemptsRef.current = 0;

        // Subscribe to match if provided
        if (matchId) {
          const message = {
            type: 'subscribe_match',
            matchId
          };
          ws.send(JSON.stringify(message));
          console.log('📡 Subscribed to match:', matchId);
        }
      };

      ws.onmessage = (event) => {
        try {
          const wsEvent: WebSocketEvent = JSON.parse(event.data);
          console.log('📨 WebSocket event received:', wsEvent);

          setState(prev => ({
            ...prev,
            lastEvent: wsEvent
          }));

          // Call event handlers
          const handlers = eventHandlersRef.current.get(wsEvent.type);
          if (handlers) {
            handlers.forEach(handler => handler(wsEvent));
          }
        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
    
        setState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false
        }));

        // Attempt to reconnect
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          console.log(`🔄 Attempting to reconnect (${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        } else {
          setState(prev => ({
            ...prev,
            error: 'Failed to reconnect after maximum attempts'
          }));
        }
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setState(prev => ({
          ...prev,
          error: 'WebSocket connection error',
          isConnecting: false
        }));
      };

    } catch (error) {
      console.error('❌ Error creating WebSocket connection:', error);
      setState(prev => ({
        ...prev,
        error: 'Failed to create WebSocket connection',
        isConnecting: false
      }));
    }
  }, [wallet, state.isConnected, state.isConnecting, getWebSocketUrl, matchId, reconnectInterval, maxReconnectAttempts]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setState(prev => ({
      ...prev,
      isConnected: false,
      isConnecting: false,
      error: null
    }));
  }, []);

  // Subscribe to match events
  const subscribeToMatch = useCallback((matchId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const message = {
      type: 'subscribe_match',
      matchId
    };

    wsRef.current.send(JSON.stringify(message));
    console.log('📡 Subscribed to match:', matchId);
  }, []);

  // Unsubscribe from match events
  const unsubscribeFromMatch = useCallback((matchId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const message = {
      type: 'unsubscribe_match',
      matchId
    };

    wsRef.current.send(JSON.stringify(message));
    console.log('📡 Unsubscribed from match:', matchId);
  }, []);

  // Send custom message
  const sendMessage = useCallback((message: any) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ WebSocket not connected, cannot send message');
      return;
    }

    wsRef.current.send(JSON.stringify(message));
  }, []);

  // Add event handler
  const addEventHandler = useCallback((eventType: WebSocketEventType, handler: (event: WebSocketEvent) => void) => {
    if (!eventHandlersRef.current.has(eventType)) {
      eventHandlersRef.current.set(eventType, []);
    }
    eventHandlersRef.current.get(eventType)!.push(handler);
  }, []);

  // Remove event handler
  const removeEventHandler = useCallback((eventType: WebSocketEventType, handler: (event: WebSocketEvent) => void) => {
    const handlers = eventHandlersRef.current.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }, []);

  // Auto-connect when wallet changes
  useEffect(() => {
    if (autoConnect && wallet) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [wallet, autoConnect, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    state,
    connect,
    disconnect,
    subscribeToMatch,
    unsubscribeFromMatch,
    sendMessage,
    addEventHandler,
    removeEventHandler
  };
};
