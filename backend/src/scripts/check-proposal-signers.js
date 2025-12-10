const { Connection, PublicKey } = require('@solana/web3.js');
const { accounts } = require('@sqds/multisig');

const proposalPda = 'FFFSfatrJYCeJXtxa9s9qtdexkmfkDjbhRMFYr9e7T74';
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');

async function checkProposal() {
  try {
    const proposal = await accounts.Proposal.fromAccountAddress(
      conn,
      new PublicKey(proposalPda)
    );
    
    console.log('✅ Proposal account found on-chain');
    console.log('Proposal PDA:', proposalPda);
    console.log('Transaction Index:', proposal.transactionIndex?.toString());
    console.log('Status:', proposal.status);
    
    // Check approved signers
    const approved = proposal.approved || [];
    console.log('\n📋 Approved signers:', approved.length);
    approved.forEach((signer, i) => {
      const pubkey = signer?.key || signer?.pubkey || signer;
      const pubkeyStr = pubkey instanceof PublicKey ? pubkey.toString() : String(pubkey);
      console.log(`  [${i}] ${pubkeyStr}`);
    });
    
    // Check if there are other signer-related fields
    const signers = proposal.signers || [];
    if (signers.length > 0) {
      console.log('\n📋 Signers field:', signers.length);
      signers.forEach((signer, i) => {
        const pubkey = signer?.key || signer?.pubkey || signer;
        const pubkeyStr = pubkey instanceof PublicKey ? pubkey.toString() : String(pubkey);
        console.log(`  [${i}] ${pubkeyStr}`);
      });
    }
    
    // Check all properties
    console.log('\n🔍 All proposal properties:');
    Object.keys(proposal).forEach(key => {
      const value = proposal[key];
      if (Array.isArray(value)) {
        console.log(`  ${key}: Array(${value.length})`);
      } else if (value instanceof PublicKey) {
        console.log(`  ${key}: ${value.toString()}`);
      } else {
        console.log(`  ${key}: ${typeof value}`);
      }
    });
    
  } catch (e) {
    console.error('❌ Error checking proposal:', e.message);
    console.error(e.stack);
  }
}

checkProposal();

