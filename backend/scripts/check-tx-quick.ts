import { Connection } from '@solana/web3.js';

const sig = process.argv[2];
if (!sig) {
  console.error('Usage: npx ts-node scripts/check-tx-quick.ts <signature>');
  process.exit(1);
}

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

async function main() {
  try {
    const [status, tx] = await Promise.all([
      connection.getSignatureStatuses([sig], { searchTransactionHistory: true }),
      connection.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
    ]);

    const s = status.value[0];
    console.log(JSON.stringify({
      signature: sig,
      found: !!s || !!tx,
      confirmed: s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized',
      err: s?.err || tx?.meta?.err,
      slot: s?.slot || tx?.slot,
      blockTime: tx?.blockTime,
      fee: tx?.meta?.fee,
      success: !s?.err && !tx?.meta?.err,
      preBalances: tx?.meta?.preBalances,
      postBalances: tx?.meta?.postBalances,
      accountKeys: tx?.transaction?.message?.accountKeys?.map((k: any) => k.toString()),
    }, null, 2));
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();


