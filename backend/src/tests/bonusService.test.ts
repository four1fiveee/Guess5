import test from 'node:test';
import assert from 'node:assert/strict';
import { Connection, Keypair, Transaction } from '@solana/web3.js';
import {
  disburseBonusIfEligible,
  setBonusServiceDependencies,
  resetBonusServiceDependencies
} from '../services/bonusService';

test('does not trigger bonus for ties', async () => {
  resetBonusServiceDependencies();

  const winnerResult = await disburseBonusIfEligible({
    matchId: 'match-tie',
    winner: 'tie',
    entryFeeUsd: 20,
    entryFeeSol: 0.5,
    executionSignature: 'ignored',
    executionTimestamp: new Date()
  });

  assert.equal(winnerResult.triggered, false);
  assert.equal(winnerResult.reason, 'no_winner');
});

test('requires execution signature before paying bonus', async () => {
  resetBonusServiceDependencies();

  const result = await disburseBonusIfEligible({
    matchId: 'match-missing-signature',
    winner: Keypair.generate().publicKey.toBase58(),
    entryFeeUsd: 20,
    entryFeeSol: 0.5,
    solPriceAtTransaction: 40
  });

  assert.equal(result.triggered, false);
  assert.equal(result.reason, 'missing_execution_signature');
});

test('pays bonus only when execution proof and winner are provided', async () => {
  const feeKeypair = Keypair.generate();
  const winner = Keypair.generate().publicKey.toBase58();
  const sentTransactions: Transaction[] = [];

  const mockConnection = {
    sendTransaction: async (transaction: Transaction) => {
      sentTransactions.push(transaction);
      return 'bonus-signature';
    },
    confirmTransaction: async () => ({ value: { err: null } })
  } as unknown as Connection;

  setBonusServiceDependencies({
    connection: mockConnection,
    getFeeWalletKeypair: () => feeKeypair
  });

  try {
    const result = await disburseBonusIfEligible({
      matchId: 'match-success',
      winner,
      entryFeeUsd: 20,
      entryFeeSol: 0.5,
      solPriceAtTransaction: 40,
      executionSignature: 'execution-proof',
      executionTimestamp: new Date()
    });

    assert.equal(result.success, true);
    assert.equal(result.triggered, true);
    assert.equal(result.executionSignature, 'execution-proof');
    assert.equal(result.signature, 'bonus-signature');
    assert.equal(sentTransactions.length, 1);
  } finally {
    resetBonusServiceDependencies();
  }
});


