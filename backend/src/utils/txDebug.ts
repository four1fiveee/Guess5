/**
 * Transaction Debug Utilities - Expert Recommended Diagnostics
 * 
 * These utilities provide comprehensive logging and diagnostics for transaction
 * execution to help identify why transactions are failing.
 */

import { Connection, PublicKey } from '@solana/web3.js';

/**
 * Extract raw RPC error body from wrapped web3.js errors
 * This is CRITICAL - web3.js wraps RPC errors in multiple layers, and the
 * actual error message is only accessible via response.text()
 */
async function extractRpcError(e: any): Promise<any> {
  const info: any = {
    message: e?.message,
    toString: e?.toString?.(),
    stack: e?.stack,
    name: e?.name,
  };

  // web3.js wrapped RPC response
  const resp = e?.response || e?.cause?.response;
  if (resp) {
    try {
      info.status = resp.status;
      info.statusText = resp.statusText;

      // raw body text (MOST IMPORTANT)
      if (resp.text && typeof resp.text === 'function') {
        info.bodyText = await resp.text();
      } else if (resp.body) {
        // If body is already a string or buffer
        if (typeof resp.body === 'string') {
          info.bodyText = resp.body;
        } else if (Buffer.isBuffer(resp.body)) {
          info.bodyText = resp.body.toString('utf-8');
        } else {
          info.bodyText = String(resp.body);
        }
      }

      // attempt parse JSON
      if (info.bodyText) {
        try {
          info.bodyJson = JSON.parse(info.bodyText);
        } catch (_) {
          // Not JSON, that's okay
        }
      }
    } catch (innerErr) {
      info.bodyError = innerErr?.toString?.();
    }
  }

  // sendTransactionError fields
  if (e?.logs) info.logs = e.logs;
  if (e?.data) info.data = e.data;
  if (e?.simulationResponse) info.simulationResponse = e.simulationResponse;

  return info;
}

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

    // CRITICAL: Use sendRawTransaction directly (not _rpcRequest) to capture raw error body
    // _rpcRequest returns {result, error} which doesn't expose the HTTP response body
    // sendRawTransaction throws exceptions with response.text() accessible
    try {
      const signature = await connection.sendRawTransaction(rawTxBuffer, {
        skipPreflight: rpcOptions.skipPreflight,
        preflightCommitment: rpcOptions.preflightCommitment,
        maxRetries: rpcOptions.maxRetries,
      });

      const elapsed = Date.now() - startTime;
      console.info(`[TX SEND][${correlationId}] signature returned (${elapsed}ms): ${signature}`);

      return {
        signature,
        correlationId,
        rpcResponse: { result: signature },
      };
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    
    // CRITICAL: Extract raw RPC error body using expert's helper
    const rpcErr = await extractRpcError(err);
    
    console.error(`[TX SEND][${correlationId}] RPC ERROR (${elapsed}ms):`, JSON.stringify(rpcErr, null, 2));
    
    // Also log the raw bodyText separately for visibility
    if (rpcErr.bodyText) {
      console.error(`[TX SEND][${correlationId}] RAW RPC ERROR BODY:`, rpcErr.bodyText);
    }
    if (rpcErr.bodyJson) {
      console.error(`[TX SEND][${correlationId}] PARSED RPC ERROR JSON:`, JSON.stringify(rpcErr.bodyJson, null, 2));
    }

    return {
      signature: null,
      correlationId,
      rpcError: rpcErr,
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

