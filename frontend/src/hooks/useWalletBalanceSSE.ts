import { useState, useEffect, useRef } from 'react';
import { config } from '../config/environment';

interface BalanceUpdate {
  type: 'balance_update' | 'connected' | 'error';
  wallet: string;
  balance?: number;
  message?: string;
  timestamp: string;
}

export const useWalletBalanceSSE = (walletAddress: string | null) => {
  const [balance, setBalance] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  useEffect(() => {
    if (!walletAddress) {
      setBalance(null);
      setIsConnected(false);
      setError(null);
      return;
    }

    // Close existing connection and clear any pending reconnection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttemptsRef.current = 0;

    // Create new SSE connection
    const sseUrl = `${config.API_URL}/api/match/wallet-balance/${walletAddress}`;
    
    // Debug logging
    console.log('🔍 SSE Debug:', {
      API_URL: config.API_URL,
      sseUrl: sseUrl,
      walletAddress: walletAddress
    });

    
    const eventSource = new EventSource(sseUrl);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
  
      setIsConnected(true);
      setError(null);
      reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection
    };

    eventSource.onmessage = (event) => {
      try {
        const data: BalanceUpdate = JSON.parse(event.data);
        
        switch (data.type) {
          case 'connected':
        
            break;
            
          case 'balance_update':
            console.log('💰 Balance update received:', data.balance, 'SOL');
            setBalance(data.balance || null);
            setError(null);
            break;
            
          case 'error':
            console.error('❌ SSE error:', data.message);
            setError(data.message || 'Failed to fetch balance');
            break;
        }
      } catch (error) {
        console.error('❌ Error parsing SSE message:', error);
        setError('Failed to parse balance update');
      }
    };

    eventSource.onerror = (error) => {
      console.error('❌ SSE connection error:', error);
      console.error('❌ EventSource readyState:', eventSource.readyState);
      setIsConnected(false);
      setError('Connection lost - balance updates may be delayed');
      
      // Implement exponential backoff for reconnection
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000); // Max 30 seconds
        reconnectAttemptsRef.current++;
        
        console.log(`🔄 Attempting to reconnect SSE in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          if (walletAddress) {
            console.log('🔄 Reconnecting SSE...');
            eventSource.close();
            // The useEffect will handle reconnection
          }
        }, delay);
      } else {
        console.error('❌ Max SSE reconnection attempts reached');
        setError('Unable to maintain connection - please refresh the page');
      }
    };

    // Cleanup function
    return () => {
      if (eventSource) {
    
        eventSource.close();
        setIsConnected(false);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [walletAddress]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return {
    balance,
    isConnected,
    error,
    // Fallback to manual refresh if SSE fails
    refreshBalance: async () => {
      if (!walletAddress) return;
      
      try {
        const response = await fetch(
          `${config.API_URL}/api/match/wallet-balance/${walletAddress}`
        );
        if (response.ok) {
          const reader = response.body?.getReader();
          if (reader) {
            const { value } = await reader.read();
            const text = new TextDecoder().decode(value);
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data: BalanceUpdate = JSON.parse(line.slice(6));
                if (data.type === 'balance_update' && data.balance !== undefined) {
                  setBalance(data.balance);
                  break;
                }
              }
            }
            reader.releaseLock();
          }
        }
      } catch (error) {
        console.error('❌ Manual balance refresh failed:', error);
        setError('Failed to refresh balance');
      }
    }
  };
};
