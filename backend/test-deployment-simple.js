const { Connection, PublicKey } = require('@solana/web3.js');

async function testDeployment() {
  console.log('🧪 Testing Smart Contract Deployment...\n');
  
  const connection = new Connection('https://api.devnet.solana.com');
  const programId = new PublicKey('ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4');
  
  try {
    console.log('🔗 Connected to devnet');
    console.log(`📋 Program ID: ${programId.toString()}`);
    
    const programInfo = await connection.getAccountInfo(programId);
    if (programInfo) {
      console.log('✅ Smart contract deployed successfully!');
      console.log(`   Data length: ${programInfo.data.length} bytes`);
      console.log(`   Owner: ${programInfo.owner.toString()}`);
      console.log(`   Executable: ${programInfo.executable}`);
    } else {
      console.log('❌ Program not found on-chain');
    }
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
}

testDeployment();
