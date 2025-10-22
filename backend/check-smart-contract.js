const { Connection, PublicKey } = require('@solana/web3.js');

async function checkSmartContract() {
  try {
    console.log('🔍 Checking if smart contract is deployed...');
    
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const programId = new PublicKey('ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4');
    
    console.log('Program ID:', programId.toString());
    
    const accountInfo = await connection.getAccountInfo(programId);
    
    if (accountInfo) {
      console.log('✅ Smart contract is deployed');
      console.log('Account owner:', accountInfo.owner.toString());
      console.log('Account data length:', accountInfo.data.length);
      console.log('Account executable:', accountInfo.executable);
    } else {
      console.log('❌ Smart contract is NOT deployed');
      console.log('The program ID does not exist on devnet');
    }
  } catch (error) {
    console.error('❌ Error checking program:', error.message);
  }
}

checkSmartContract();
