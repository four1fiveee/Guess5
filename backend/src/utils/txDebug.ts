/**
 * Transaction Debug Utilities - Expert Recommended Diagnostics
 * 
 * These utilities provide comprehensive logging and diagnostics for transaction
 * execution to help identify why transactions are failing.
 */

import { Connection, PublicKey } from '@solana/web3.js';

export interface SendAndLogResult {
  signature: string | null;
  correlationId: string;
  rpcError?: any;
  rpcResponse?: any;
}

export interface PollTxResult {
  tx: any;
  sigStatus: any;
  correlationId: string;
}

/**
 * Send transaction with comprehensive logging and RPC response capture
 */
export async function sendAndLogRawTransaction({
  connection,
  rawTx, // Buffer or Uint8Array from transaction.serialize()
  options = {}
}: {
  connection: Connection;
  rawTx: Buffer | Uint8Array;
  options?: { maxRetries?: number; commitment?: any; skipPreflight?: boolean };
}): Promise<SendAndLogResult> {
  const correlationId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const startTime = Date.now();
  
  try {
    // Convert to Buffer if it's a Uint8Array
    const rawTxBuffer = Buffer.isBuffer(rawTx) ? rawTx : Buffer.from(rawTx);
    const rawBase64 = rawTxBuffer.toString('base64');
    console.info(`[TX SEND][${correlationId}] rawTxBase64 (len=${rawBase64.length})`);

    // IMPORTANT: use connection._rpcRequest for full response visibility
    // This captures the full RPC response including error bodies
    const rpcOptions = {
      skipPreflight: options.skipPreflight ?? true,
      preflightCommitment: options.commitment ?? 'processed',
      maxRetries: options.maxRetries ?? 3,
    };

    console.info(`[TX SEND][${correlationId}] RPC options:`, JSON.stringify(rpcOptions));

    // Use _rpcRequest to get full response visibility
    const res = await (connection as any)._rpcRequest('sendTransaction', [
      rawBase64,
      rpcOptions
    ]);

    const elapsed = Date.now() - startTime;

    // _rpcRequest returns {result, error}
    if (res?.error) {
      // Try to stringify the error, handling circular references
      let errorStr = '{}';
      try {
        errorStr = JSON.stringify(res.error, null, 2);
      } catch (stringifyErr) {
        // If JSON.stringify fails, try to extract key properties
        errorStr = JSON.stringify({
          code: res.error?.code,
          message: res.error?.message,
          data: res.error?.data,
          name: res.error?.name,
          toString: String(res.error),
        }, null, 2);
      }
      
      // Also log the full response to see what we're getting
      let responseStr = '{}';
      try {
        responseStr = JSON.stringify(res, (key, value) => {
          // Skip circular references
          if (key === 'parent' || key === 'circular') return '[Circular]';
          return value;
        }, 2);
      } catch (responseErr) {
        responseStr = String(res);
      }
      
      console.error(`[TX SEND][${correlationId}] RPC returned error (${elapsed}ms):`, errorStr);
      console.error(`[TX SEND][${correlationId}] Full RPC response:`, responseStr);
      
      return {
        signature: null,
        correlationId,
        rpcError: res.error,
        rpcResponse: res,
      };
    }

    const signature = res?.result;
    console.info(`[TX SEND][${correlationId}] signature returned (${elapsed}ms): ${signature}`);

    return {
      signature,
      correlationId,
      rpcResponse: res,
    };
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[TX SEND][${correlationId}] send failed error (${elapsed}ms):`, err?.message ?? err);
    
    // Some RPC clients embed a response in err; try to print everything
    if (err?.response) {
      try {
        const text = await err.response.text();
        console.error(`[TX SEND][${correlationId}] err.response.text: ${text}`);
      } catch (inner) {
        console.error(`[TX SEND][${correlationId}] failed to text() err.response`, inner);
      }
    }

    // Try to extract RPC error details
    let rpcError = null;
    if (err?.logs) {
      rpcError = { logs: err.logs, message: err.message };
    } else if (err?.simulationResponse) {
      rpcError = {
        simulationResponse: err.simulationResponse,
        message: err.message,
      };
    } else {
      rpcError = { message: err?.message || String(err), stack: err?.stack };
    }

    return {
      signature: null,
      correlationId,
      rpcError,
    };
  }
}

/**
 * Poll transaction status and log results
 */
export async function pollTxAndLog({
  connection,
  signature,
  correlationId,
  maxAttempts = 12,
  pollIntervalMs = 2000
}: {
  connection: Connection;
  signature: string;
  correlationId: string;
  maxAttempts?: number;
  pollIntervalMs?: number;
}): Promise<PollTxResult | null> {
  const startTime = Date.now();
  
  for (let i = 0; i < maxAttempts; i++) {
    const attemptStart = Date.now();
    try {
      const [tx, sigInfo] = await Promise.all([
        connection.getTransaction(signature, { 
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0 
        }),
        connection.getSignatureStatuses([signature], { 
          searchTransactionHistory: true 
        })
      ]);

      const attemptElapsed = Date.now() - attemptStart;
      const totalElapsed = Date.now() - startTime;

      console.info(`[TX POLL][${correlationId}][attempt=${i + 1}/${maxAttempts}][${attemptElapsed}ms]`, {
        tx: !!tx,
        sigStatus: sigInfo?.value?.[0] ? {
          err: sigInfo.value[0].err,
          confirmationStatus: sigInfo.value[0].confirmationStatus,
          slot: sigInfo.value[0].slot,
        } : null,
        totalElapsed,
      });

      if (tx || (sigInfo?.value?.[0] && sigInfo.value[0].confirmationStatus)) {
        return { 
          tx, 
          sigStatus: sigInfo.value[0],
          correlationId 
        };
      }
    } catch (err: any) {
      const attemptElapsed = Date.now() - attemptStart;
      console.error(`[TX POLL][${correlationId}][attempt=${i + 1}/${maxAttempts}][${attemptElapsed}ms] error:`, err?.message || err);
    }
    
    if (i < maxAttempts - 1) {
      await new Promise(res => setTimeout(res, pollIntervalMs));
    }
  }

  const totalElapsed = Date.now() - startTime;
  console.warn(`[TX POLL][${correlationId}] not found after ${maxAttempts} attempts (${totalElapsed}ms total)`);
  return null;
}

/**
 * Subscribe to program logs during execution attempt
 */
export function subscribeToProgramLogs({
  connection,
  programId,
  correlationId,
  durationMs = 30000
}: {
  connection: Connection;
  programId: PublicKey;
  correlationId: string;
  durationMs?: number;
}): number {
  console.info(`[PROGRAM LOGS][${correlationId}] Subscribing to logs for program ${programId.toString()}`);
  
  const listenerId = connection.onLogs(
    programId,
    (logs, ctx) => {
      console.info(`[PROGRAM LOGS][${correlationId}]`, {
        signature: logs.signature,
        err: logs.err,
        logs: logs.logs,
        slot: ctx.slot,
      });
    },
    'confirmed'
  );

  // Auto-remove listener after duration
  setTimeout(() => {
    try {
      connection.removeOnLogsListener(listenerId);
      console.info(`[PROGRAM LOGS][${correlationId}] Removed listener after ${durationMs}ms`);
    } catch (err) {
      console.warn(`[PROGRAM LOGS][${correlationId}] Failed to remove listener:`, err);
    }
  }, durationMs);

  return listenerId;
}

/**
 * Log execution step with timing
 */
export function logExecutionStep(
  correlationId: string,
  step: string,
  startTime: number,
  data?: any
): void {
  const elapsed = Date.now() - startTime;
  console.info(`[EXEC][${correlationId}] step=${step} time=${elapsed}ms`, data || '');
}

