/**
 * Execution DAG Logger
 * 
 * Stores execution trace files per match for debugging and audit purposes.
 * Tracks:
 * - Execution steps
 * - RPC responses
 * - Simulation logs
 * - Account lists from VaultTransaction.message
 * - Errors
 * - Success states
 */

import * as fs from 'fs';
import * as path from 'path';
import { enhancedLogger } from './enhancedLogger';

export interface ExecutionStep {
  timestamp: string;
  step: string;
  data?: any;
  error?: string;
  duration?: number;
}

export interface ExecutionDAG {
  matchId: string;
  proposalId: string;
  correlationId: string;
  startTime: string;
  endTime?: string;
  success?: boolean;
  steps: ExecutionStep[];
  rpcResponses?: any[];
  simulationLogs?: string[];
  accountLists?: any[];
  errors?: string[];
  finalState?: any;
}

class ExecutionDAGLogger {
  private logsDir: string;
  private inMemoryLogs: Map<string, ExecutionDAG> = new Map();

  constructor() {
    // Use logs directory in project root or fallback to /tmp
    this.logsDir = process.env.EXECUTION_LOGS_DIR || path.join(process.cwd(), 'logs', 'executions');
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Create a new execution DAG for a match
   */
  createDAG(matchId: string, proposalId: string, correlationId: string): ExecutionDAG {
    const dag: ExecutionDAG = {
      matchId,
      proposalId,
      correlationId,
      startTime: new Date().toISOString(),
      steps: [],
    };

    this.inMemoryLogs.set(correlationId, dag);
    return dag;
  }

  /**
   * Add a step to the execution DAG
   */
  addStep(correlationId: string, step: string, data?: any, error?: string, duration?: number): void {
    const dag = this.inMemoryLogs.get(correlationId);
    if (!dag) {
      enhancedLogger.warn('⚠️ Execution DAG not found for correlationId', { correlationId, step });
      return;
    }

    dag.steps.push({
      timestamp: new Date().toISOString(),
      step,
      data,
      error,
      duration,
    });

    // Log to console as well
    if (error) {
      enhancedLogger.error(`❌ Execution step failed: ${step}`, {
        correlationId,
        matchId: dag.matchId,
        proposalId: dag.proposalId,
        error,
        data,
      });
    } else {
      enhancedLogger.info(`✅ Execution step: ${step}`, {
        correlationId,
        matchId: dag.matchId,
        proposalId: dag.proposalId,
        duration,
        data: data ? JSON.stringify(data).substring(0, 200) : undefined,
      });
    }
  }

  /**
   * Add RPC response
   */
  addRPCResponse(correlationId: string, response: any): void {
    const dag = this.inMemoryLogs.get(correlationId);
    if (!dag) {
      return;
    }

    if (!dag.rpcResponses) {
      dag.rpcResponses = [];
    }
    dag.rpcResponses.push({
      timestamp: new Date().toISOString(),
      response,
    });
  }

  /**
   * Add simulation logs
   */
  addSimulationLogs(correlationId: string, logs: string[]): void {
    const dag = this.inMemoryLogs.get(correlationId);
    if (!dag) {
      return;
    }

    if (!dag.simulationLogs) {
      dag.simulationLogs = [];
    }
    dag.simulationLogs.push(...logs);
  }

  /**
   * Add account lists from VaultTransaction.message
   */
  addAccountLists(correlationId: string, accounts: any[]): void {
    const dag = this.inMemoryLogs.get(correlationId);
    if (!dag) {
      return;
    }

    if (!dag.accountLists) {
      dag.accountLists = [];
    }
    dag.accountLists.push({
      timestamp: new Date().toISOString(),
      accounts,
    });
  }

  /**
   * Add error
   */
  addError(correlationId: string, error: string): void {
    const dag = this.inMemoryLogs.get(correlationId);
    if (!dag) {
      return;
    }

    if (!dag.errors) {
      dag.errors = [];
    }
    dag.errors.push({
      timestamp: new Date().toISOString(),
      error,
    });
  }

  /**
   * Finalize execution DAG and save to file
   */
  async finalize(correlationId: string, success: boolean, finalState?: any): Promise<void> {
    const dag = this.inMemoryLogs.get(correlationId);
    if (!dag) {
      enhancedLogger.warn('⚠️ Execution DAG not found for finalization', { correlationId });
      return;
    }

    dag.endTime = new Date().toISOString();
    dag.success = success;
    dag.finalState = finalState;

    // Save to file
    const filename = `execution_${dag.matchId}_${dag.proposalId}_${Date.now()}.json`;
    const filepath = path.join(this.logsDir, filename);

    try {
      fs.writeFileSync(filepath, JSON.stringify(dag, null, 2), 'utf8');
      enhancedLogger.info('✅ Execution DAG saved to file', {
        correlationId,
        matchId: dag.matchId,
        proposalId: dag.proposalId,
        filename,
        filepath,
        success,
        stepCount: dag.steps.length,
      });
    } catch (error: any) {
      enhancedLogger.error('❌ Failed to save execution DAG to file', {
        correlationId,
        matchId: dag.matchId,
        proposalId: dag.proposalId,
        error: error?.message || String(error),
      });
    }

    // Keep in memory for a short time (5 minutes) then remove
    setTimeout(() => {
      this.inMemoryLogs.delete(correlationId);
    }, 5 * 60 * 1000);
  }

  /**
   * Get execution DAG by correlation ID
   */
  getDAG(correlationId: string): ExecutionDAG | undefined {
    return this.inMemoryLogs.get(correlationId);
  }

  /**
   * Get all execution DAGs for a match
   */
  getDAGsForMatch(matchId: string): ExecutionDAG[] {
    return Array.from(this.inMemoryLogs.values()).filter(dag => dag.matchId === matchId);
  }
}

export const executionDAGLogger = new ExecutionDAGLogger();

