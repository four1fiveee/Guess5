const { Connection, PublicKey } = require('@solana/web3.js');
const { accounts } = require('@sqds/multisig');

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROPOSAL_ID = '6ywM5xUgxFmu7JkZGemwSSbTbULD3u1UaZRJZZ8xjt8z';
const VAULT_ADDRESS = 'Ba8esefN1FUHhZX2kbed3v4Zdmzk7eDtjLZfzcWPdcCE';

async function checkProposal() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const proposalPda = new PublicKey(PROPOSAL_ID);
  const vaultAddress = new PublicKey(VAULT_ADDRESS);

  try {
    // Fetch proposal account
    const proposalAccount = await accounts.Proposal.fromAccountAddress(connection, proposalPda);
    const transactionIndex = Number(proposalAccount.transactionIndex);
    
    console.log('📊 Proposal Status:');
    console.log('  Proposal ID:', PROPOSAL_ID);
    console.log('  Transaction Index:', transactionIndex);
    console.log('  Status:', proposalAccount.status);
    console.log('  Approved Signers:', proposalAccount.approvedSigners.map(s => s.toString()));
    console.log('  Approved Signers Count:', proposalAccount.approvedSigners.length);
    
    // Fetch multisig to get threshold
    const multisigAccount = await accounts.Multisig.fromAccountAddress(connection, vaultAddress);
    console.log('  Threshold:', multisigAccount.threshold);
    console.log('  Threshold Met:', proposalAccount.approvedSigners.length >= multisigAccount.threshold);
    
    // Check if executed by checking transaction status
    if (proposalAccount.status === 'Executed') {
      console.log('  ✅ Proposal is EXECUTED');
    } else if (proposalAccount.status === 'Approved') {
      console.log('  ⚠️ Proposal is APPROVED but not EXECUTED');
      console.log('  Reason: May need explicit execution call');
    } else {
      console.log('  ⚠️ Proposal status:', proposalAccount.status);
    }
    
  } catch (error) {
    console.error('❌ Error checking proposal:', error.message);
    process.exit(1);
  }
}

checkProposal();

