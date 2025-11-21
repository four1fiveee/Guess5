/**
 * Check transaction signatures on-chain
 * Run: npx ts-node backend/scripts/check-tx-signatures.ts <signature1> <signature2> ...
 */

import { Connection } from '@solana/web3.js';

const signatures = process.argv.slice(2);

if (signatures.length === 0) {
  console.error('Usage: npx ts-node backend/scripts/check-tx-signatures.ts <signature1> <signature2> ...');
  process.exit(1);
}

async function checkSignature(connection: Connection, signature: string) {
  try {
    const [tx, sigStatus] = await Promise.all([
      connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      }),
      connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true
      })
    ]);

    return {
      signature,
      found: !!tx,
      confirmed: sigStatus?.value?.[0]?.confirmationStatus === 'confirmed' || sigStatus?.value?.[0]?.confirmationStatus === 'finalized',
      err: sigStatus?.value?.[0]?.err || tx?.meta?.err,
      slot: sigStatus?.value?.[0]?.slot || tx?.slot,
      blockTime: tx?.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
      fee: tx?.meta?.fee,
      success: !sigStatus?.value?.[0]?.err && !tx?.meta?.err,
    };
  } catch (error: any) {
    return {
      signature,
      found: false,
      error: error.message,
    };
  }
}

async function main() {
  const RPC = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';
  const connection = new Connection(RPC, 'confirmed');

  console.log(`\n🔍 Checking ${signatures.length} transaction signatures on ${RPC}...\n`);

  for (const sig of signatures) {
    const result = await checkSignature(connection, sig);
    console.log(JSON.stringify(result, null, 2));
    console.log('');
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});





