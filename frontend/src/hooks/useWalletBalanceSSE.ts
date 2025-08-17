import { useState, useEffect, useRef } from 'react';

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

  useEffect(() => {
    if (!walletAddress) {
      setBalance(null);
      setIsConnected(false);
      setError(null);
      return;
    }

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Create new SSE connection
    const sseUrl = `${process.env.NEXT_PUBLIC_API_URL}/api/match/wallet-balance/${walletAddress}`;
    console.log('🔌 Attempting SSE connection to:', sseUrl);
    
    const eventSource = new EventSource(sseUrl);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('🔌 SSE connection opened for wallet:', walletAddress);
      setIsConnected(true);
      setError(null);
    };

    eventSource.onmessage = (event) => {
      try {
        const data: BalanceUpdate = JSON.parse(event.data);
        
        switch (data.type) {
          case 'connected':
            console.log('✅ SSE connected for wallet:', data.wallet);
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
      
      // Attempt to reconnect after 5 seconds
      setTimeout(() => {
        if (walletAddress) {
          console.log('🔄 Attempting to reconnect SSE...');
          eventSource.close();
          // The useEffect will handle reconnection
        }
      }, 5000);
    };

    // Cleanup function
    return () => {
      if (eventSource) {
        console.log('🔌 Closing SSE connection for wallet:', walletAddress);
        eventSource.close();
        setIsConnected(false);
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
          `${process.env.NEXT_PUBLIC_API_URL}/api/match/wallet-balance/${walletAddress}`
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
