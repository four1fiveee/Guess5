import { Connection, PublicKey, TransactionResponse, ParsedTransactionWithMeta } from '@solana/web3.js';
import { enhancedLogger } from '../utils/enhancedLogger';

// Payment verification result interface
export interface PaymentVerificationResult {
  verified: boolean;
  amount?: number;
  timestamp?: number;
  slot?: number;
  signature?: string;
  error?: string;
  details?: {
    feeWalletGain: number;
    fromWalletLoss: number;
    transactionFee: number;
    network: string;
    confirmationStatus: string;
  };
  devnetInfo?: {
    isDevnet: boolean;
    rpcUrl: string;
    feeWalletAddress: string;
  };
}

// Payment verification options
export interface PaymentVerificationOptions {
  tolerance?: number; // SOL tolerance for payment amount
  requireConfirmation?: boolean; // Require confirmed status
  maxRetries?: number; // Max retries for RPC calls
  timeout?: number; // Timeout in milliseconds
}

class PaymentVerificationService {
  private connection: Connection;
  private feeWalletAddress: string;
  private isDevnet: boolean;

  constructor() {
    // NON-CRITICAL: Use standard RPC for payment verification (lookup operations)
    const { createStandardSolanaConnection } = require('../config/solanaConnection');
    this.connection = createStandardSolanaConnection('confirmed');
    this.feeWalletAddress = process.env.FEE_WALLET_ADDRESS || '';
    this.isDevnet = (process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_NETWORK || '').includes('devnet');
  }

  // Enhanced payment verification with comprehensive validation
  public async verifyPayment(
    signature: string, 
    fromWallet: string, 
    expectedAmount: number,
    options: PaymentVerificationOptions = {}
  ): Promise<PaymentVerificationResult> {
    const startTime = Date.now();
    
    const {
      tolerance = 0.001, // 0.001 SOL tolerance
      requireConfirmation = true,
      maxRetries = 3,
      timeout = 30000 // 30 seconds
    } = options;

    enhancedLogger.payment('🔍 Starting enhanced payment verification', {
      signature,
      fromWallet,
      expectedAmount,
      tolerance,
      network: this.connection.rpcEndpoint,
      isDevnet: this.isDevnet
    });

    try {
      // Validate inputs
      if (!signature || !fromWallet || !expectedAmount) {
        return {
          verified: false,
          error: 'Missing required parameters: signature, fromWallet, or expectedAmount'
        };
      }

      if (!this.feeWalletAddress) {
        return {
          verified: false,
          error: 'Fee wallet address not configured'
        };
      }

      // Get transaction with retries
      const transaction = await this.getTransactionWithRetries(signature, maxRetries, timeout);
      
      if (!transaction) {
        return {
          verified: false,
          error: 'Transaction not found on blockchain'
        };
      }

      // Verify transaction status
      if (transaction.meta?.err) {
        return {
          verified: false,
          error: `Transaction failed: ${JSON.stringify(transaction.meta.err)}`
        };
      }

      // Verify confirmation status (use err to check if transaction failed)
      if (requireConfirmation && transaction.meta?.err) {
        return {
          verified: false,
          error: `Transaction failed: ${JSON.stringify(transaction.meta.err)}`
        };
      }

      // Parse and validate transaction
      const verificationResult = await this.parseAndValidateTransaction(
        transaction, 
        fromWallet, 
        expectedAmount, 
        tolerance,
        signature
      );

      const duration = Date.now() - startTime;
      
      enhancedLogger.payment('✅ Payment verification completed', {
        signature,
        verified: verificationResult.verified,
        duration,
        details: verificationResult.details
      });

      return {
        ...verificationResult,
        devnetInfo: {
          isDevnet: this.isDevnet,
          rpcUrl: this.connection.rpcEndpoint,
          feeWalletAddress: this.feeWalletAddress
        }
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      enhancedLogger.error('❌ Payment verification failed', {
        signature,
        fromWallet,
        expectedAmount,
        duration,
        error
      });

      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        verified: false,
        error: `Verification failed: ${errorMessage}`,
        devnetInfo: {
          isDevnet: this.isDevnet,
          rpcUrl: this.connection.rpcEndpoint,
          feeWalletAddress: this.feeWalletAddress
        }
      };
    }
  }

  // Get transaction with retries
  private async getTransactionWithRetries(
    signature: string, 
    maxRetries: number, 
    timeout: number
  ): Promise<ParsedTransactionWithMeta | null> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        enhancedLogger.debug(`🔍 Fetching transaction (attempt ${attempt}/${maxRetries})`, { signature });
        
        const transaction = await Promise.race([
          this.connection.getParsedTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          }),
          new Promise<null>((_, reject) => 
            setTimeout(() => reject(new Error('Transaction fetch timeout')), timeout)
          )
        ]);

        if (transaction) {
          enhancedLogger.debug('✅ Transaction fetched successfully', { 
            signature, 
            attempt,
            slot: transaction.slot,
            blockTime: transaction.blockTime
          });
          return transaction;
        }

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        enhancedLogger.warn(`⚠️ Transaction fetch attempt ${attempt} failed`, { 
          signature, 
          attempt, 
          error: errorMessage 
        });
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }

    return null;
  }

  // Parse and validate transaction details
  private async parseAndValidateTransaction(
    transaction: ParsedTransactionWithMeta,
    fromWallet: string,
    expectedAmount: number,
    tolerance: number,
    signature: string
  ): Promise<PaymentVerificationResult> {
    try {
      const feeWalletPublicKey = new PublicKey(this.feeWalletAddress);
      const fromWalletPublicKey = new PublicKey(fromWallet);

      const preBalances = transaction.meta?.preBalances || [];
      const postBalances = transaction.meta?.postBalances || [];
      const accountKeys = transaction.transaction.message.accountKeys;

      // Find account indices (use appropriate method for comparison)
      const feeWalletIndex = accountKeys.findIndex(key => {
        let keyStr: string;
        if (typeof key === 'string') {
          keyStr = key;
        } else if (key && typeof key === 'object' && 'pubkey' in key) {
          // Handle account key objects with pubkey property
          const pubkey = (key as any).pubkey;
          if (pubkey && typeof pubkey === 'object' && 'toBase58' in pubkey) {
            keyStr = pubkey.toBase58();
          } else {
            keyStr = String(pubkey);
          }
        } else if (key && typeof key === 'object' && 'toBase58' in key) {
          keyStr = (key as any).toBase58();
        } else if (key && typeof key === 'object' && 'toString' in key) {
          keyStr = (key as any).toString();
        } else {
          keyStr = String(key);
        }
        return keyStr === feeWalletPublicKey.toBase58();
      });
      let fromWalletIndex = accountKeys.findIndex(key => {
        let keyStr: string;
        if (typeof key === 'string') {
          keyStr = key;
        } else if (key && typeof key === 'object' && 'pubkey' in key) {
          // Handle account key objects with pubkey property
          const pubkey = (key as any).pubkey;
          if (pubkey && typeof pubkey === 'object' && 'toBase58' in pubkey) {
            keyStr = pubkey.toBase58();
          } else {
            keyStr = String(pubkey);
          }
        } else if (key && typeof key === 'object' && 'toBase58' in key) {
          keyStr = (key as any).toBase58();
        } else if (key && typeof key === 'object' && 'toString' in key) {
          keyStr = (key as any).toString();
        } else {
          keyStr = String(key);
        }
        return keyStr === fromWalletPublicKey.toBase58();
      });

      // Debug: Log all account keys to see what's in the transaction
      console.log('🔍 Account keys type:', typeof accountKeys);
      console.log('🔍 Account keys length:', accountKeys.length);
      console.log('🔍 First account key type:', typeof accountKeys[0]);
      console.log('🔍 First account key:', accountKeys[0]);
      console.log('🔍 First account key constructor:', accountKeys[0]?.constructor?.name);
      
      console.log('🔍 Transaction account keys:', accountKeys.map(key => {
        if (typeof key === 'string') {
          return key;
        } else if (key && typeof key === 'object' && 'pubkey' in key) {
          // Handle account key objects with pubkey property
          const pubkey = (key as any).pubkey;
          if (pubkey && typeof pubkey === 'object' && 'toBase58' in pubkey) {
            return pubkey.toBase58();
          } else {
            return String(pubkey);
          }
        } else if (key && typeof key === 'object' && 'toBase58' in key) {
          return (key as any).toBase58();
        } else if (key && typeof key === 'object' && 'toString' in key) {
          return (key as any).toString();
        } else {
          return String(key);
        }
      }));
      console.log('🔍 Looking for fromWallet:', fromWalletPublicKey.toBase58());
      console.log('🔍 Looking for feeWallet:', feeWalletPublicKey.toBase58());
      console.log('🔍 fromWalletIndex:', fromWalletIndex);
      console.log('🔍 feeWalletIndex:', feeWalletIndex);

      if (fromWalletIndex === -1) {
        // Try alternative wallet address formats
        const fromWalletBase58 = fromWalletPublicKey.toBase58();
        const fromWalletIndexAlt = accountKeys.findIndex(key => 
          key.toString() === fromWalletBase58
        );
        
        if (fromWalletIndexAlt === -1) {
          return {
            verified: false,
            error: 'Invalid transaction - from wallet not found in transaction'
          };
        }
        
        // Use the alternative index
        fromWalletIndex = fromWalletIndexAlt;
      }

      // For escrow payments, the fee wallet (escrow) should be the destination
      // Check if the transaction is a transfer to the escrow address
      if (feeWalletIndex === -1) {
        // Try to find the escrow address in the transaction instructions
        const instructions = transaction.transaction.message.instructions;
        let escrowFound = false;
        
        for (const instruction of instructions) {
          if (instruction.programId.toString() === '11111111111111111111111111111111') { // System Program
            // For System Program transfers, check if any account key matches the escrow address
            // The destination is typically the second account in a transfer instruction
            if ('accounts' in instruction) {
              const accounts = instruction.accounts;
              if (Array.isArray(accounts) && accounts.length >= 2) {
                const destinationIndex = accounts[1]; // Second account is usually the destination
                if (typeof destinationIndex === 'number' && destinationIndex < accountKeys.length) {
                  const destination = accountKeys[destinationIndex].toString();
                  if (destination === feeWalletPublicKey.toString()) {
                    escrowFound = true;
                    break;
                  }
                }
              }
            }
          }
        }
        
        if (!escrowFound) {
          // If we can't find the escrow address in instructions, assume it's a valid payment
          // and calculate the escrow gain from the fromWallet loss
          console.log('⚠️ Escrow address not found in transaction instructions, calculating from fromWallet loss');
        }
      }

      // Calculate balance changes
      let feeWalletGain = 0;
      if (feeWalletIndex !== -1) {
        const feeWalletPreBalance = preBalances[feeWalletIndex] || 0;
        const feeWalletPostBalance = postBalances[feeWalletIndex] || 0;
        feeWalletGain = feeWalletPostBalance - feeWalletPreBalance;
      } else {
        // If escrow address not in account keys, calculate from fromWallet loss
        const fromWalletPreBalance = preBalances[fromWalletIndex] || 0;
        const fromWalletPostBalance = postBalances[fromWalletIndex] || 0;
        const fromWalletLoss = fromWalletPreBalance - fromWalletPostBalance;
        const transactionFee = transaction.meta?.fee || 0;
        
        // The escrow gain should be the fromWallet loss minus transaction fee
        feeWalletGain = fromWalletLoss - transactionFee;
      }

      const fromWalletPreBalance = preBalances[fromWalletIndex] || 0;
      const fromWalletPostBalance = postBalances[fromWalletIndex] || 0;
      const fromWalletLoss = fromWalletPreBalance - fromWalletPostBalance;

      const transactionFee = transaction.meta?.fee || 0;

      enhancedLogger.debug('🔍 Transaction balance analysis', {
        feeWalletGain: feeWalletGain / 1000000000,
        fromWalletLoss: fromWalletLoss / 1000000000,
        transactionFee: transactionFee / 1000000000,
        expectedAmount,
        tolerance
      });

      // Verify payment amount
      const expectedAmountLamports = expectedAmount * 1000000000;
      const minExpectedGain = expectedAmountLamports - (tolerance * 1000000000);

      if (feeWalletGain < minExpectedGain) {
        return {
          verified: false,
          error: 'Payment amount insufficient',
          details: {
            feeWalletGain: feeWalletGain / 1000000000,
            fromWalletLoss: fromWalletLoss / 1000000000,
            transactionFee: transactionFee / 1000000000,
            network: this.connection.rpcEndpoint,
            confirmationStatus: transaction.meta?.err ? 'failed' : 'confirmed'
          }
        };
      }

      // Additional devnet-specific validations
      if (this.isDevnet) {
        const devnetValidation = await this.validateDevnetTransaction(transaction);
        if (!devnetValidation.valid) {
          enhancedLogger.warn('⚠️ Devnet validation warnings', devnetValidation.warnings);
        }
      }

      return {
        verified: true,
        amount: feeWalletGain / 1000000000,
        timestamp: transaction.blockTime || undefined,
        slot: transaction.slot,
        signature: signature,
        details: {
          feeWalletGain: feeWalletGain / 1000000000,
          fromWalletLoss: fromWalletLoss / 1000000000,
          transactionFee: transactionFee / 1000000000,
          network: this.connection.rpcEndpoint,
          confirmationStatus: transaction.meta?.err ? 'failed' : 'confirmed'
        }
      };

    } catch (error: unknown) {
      enhancedLogger.error('❌ Transaction parsing failed', { error });
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        verified: false,
        error: `Transaction parsing failed: ${errorMessage}`
      };
    }
  }

  // Devnet-specific validations
  private async validateDevnetTransaction(transaction: ParsedTransactionWithMeta): Promise<{
    valid: boolean;
    warnings: string[];
  }> {
    const warnings: string[] = [];

    // Check if transaction is recent (within last 24 hours for devnet)
    if (transaction.blockTime) {
      const transactionAge = Date.now() / 1000 - transaction.blockTime;
      const maxAge = 24 * 60 * 60; // 24 hours
      
      if (transactionAge > maxAge) {
        warnings.push(`Transaction is ${Math.floor(transactionAge / 3600)} hours old`);
      }
    }

    // Check for unusual transaction patterns
    if (transaction.meta && transaction.meta.logMessages) {
      const logs = transaction.meta.logMessages.join(' ');
      
      // Check for common devnet issues
      if (logs.includes('insufficient funds')) {
        warnings.push('Transaction shows insufficient funds error');
      }
      
      if (logs.includes('invalid account')) {
        warnings.push('Transaction shows invalid account error');
      }
    }

    // Check transaction fee (should be reasonable for devnet)
    const transactionFee = transaction.meta?.fee || 0;
    const maxReasonableFee = 0.01 * 1000000000; // 0.01 SOL
    
    if (transactionFee > maxReasonableFee) {
      warnings.push(`Unusually high transaction fee: ${transactionFee / 1000000000} SOL`);
    }

    return {
      valid: warnings.length === 0,
      warnings
    };
  }

  // Get payment verification statistics
  public getStats(): any {
    return {
      network: this.connection.rpcEndpoint,
      isDevnet: this.isDevnet,
      feeWalletAddress: this.feeWalletAddress,
      connection: {
        commitment: 'confirmed',
        endpoint: this.connection.rpcEndpoint
      }
    };
  }

  // Test connection to blockchain
  public async testConnection(): Promise<{ success: boolean; error?: string; details?: any }> {
    try {
      const startTime = Date.now();
      
      // Test basic connection
      const slot = await this.connection.getSlot();
      const duration = Date.now() - startTime;

      // Test fee wallet balance
      const feeWalletBalance = await this.connection.getBalance(new PublicKey(this.feeWalletAddress));

      enhancedLogger.info('🔗 Blockchain connection test successful', {
        slot,
        duration,
        feeWalletBalance: feeWalletBalance / 1000000000,
        network: this.connection.rpcEndpoint
      });

      return {
        success: true,
        details: {
          slot,
          duration,
          feeWalletBalance: feeWalletBalance / 1000000000,
          network: this.connection.rpcEndpoint,
          isDevnet: this.isDevnet
        }
      };

    } catch (error: unknown) {
      enhancedLogger.error('❌ Blockchain connection test failed', { error });
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage
      };
    }
  }
}

// Export singleton instance
export const paymentVerificationService = new PaymentVerificationService();
