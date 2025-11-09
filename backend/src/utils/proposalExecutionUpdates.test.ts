import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildProposalExecutionUpdates } from './proposalExecutionUpdates';

describe('buildProposalExecutionUpdates', () => {
  const now = new Date('2025-11-09T21:00:00Z');

  it('returns expected fields for tie refund execution', () => {
    const updates = buildProposalExecutionUpdates({
      executedAt: now,
      signature: 'abc123',
      isTieRefund: true,
      isWinnerPayout: false,
    });

    assert.equal(updates.proposalStatus, 'EXECUTED');
    assert.equal(updates.proposalTransactionId, 'abc123');
    assert.equal(updates.refundTxHash, 'abc123');
    assert.equal(updates.payoutTxHash, undefined);
    assert.equal(updates.winnerPayoutSignature, undefined);
    assert.equal(updates.proposalExecutedAt, now);
  });

  it('returns expected fields for winner payout execution', () => {
    const updates = buildProposalExecutionUpdates({
      executedAt: now,
      signature: 'winSig',
      isTieRefund: false,
      isWinnerPayout: true,
    });

    assert.equal(updates.proposalStatus, 'EXECUTED');
    assert.equal(updates.proposalTransactionId, 'winSig');
    assert.equal(updates.payoutTxHash, 'winSig');
    assert.equal(updates.winnerPayoutSignature, 'winSig');
    assert.equal(updates.refundTxHash, undefined);
  });

  it('normalizes missing signature to null', () => {
    const updates = buildProposalExecutionUpdates({
      executedAt: now,
      signature: undefined,
      isTieRefund: false,
      isWinnerPayout: false,
    });

    assert.equal(updates.proposalTransactionId, null);
    assert.equal(updates.refundTxHash, undefined);
    assert.equal(updates.payoutTxHash, undefined);
  });
});

