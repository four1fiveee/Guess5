const { Connection, PublicKey } = require('@solana/web3.js');

async function findCorrectProgramId() {
  console.log('🔍 Finding the correct program ID...\n');
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  try {
    // Get all programs owned by the BPF loader
    const programs = await connection.getProgramAccounts(
      new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'),
      {
        filters: [
          {
            dataSize: 36 // Program accounts are typically 36 bytes
          }
        ]
      }
    );
    
    console.log(`Found ${programs.length} programs on devnet\n`);
    
    // Look for programs that might be ours
    for (let i = 0; i < Math.min(programs.length, 10); i++) {
      const program = programs[i];
      console.log(`Program ${i + 1}:`);
      console.log(`  Address: ${program.pubkey.toString()}`);
      console.log(`  Data Length: ${program.account.data.length}`);
      console.log(`  Executable: ${program.account.executable}`);
      console.log(`  Lamports: ${program.account.lamports}`);
      console.log('---');
    }
    
    console.log('\n💡 Look for a program that:');
    console.log('   - Has data length of 36 bytes');
    console.log('   - Is executable');
    console.log('   - Has reasonable lamports (not 0)');
    console.log('\nIf you see a program that looks like yours, use that address!');
    
  } catch (error) {
    console.error('❌ Error finding programs:', error.message);
  }
}

findCorrectProgramId().catch(console.error);
