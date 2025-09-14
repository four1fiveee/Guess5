const crypto = require('crypto');

// Function to calculate Anchor instruction discriminator
function calculateDiscriminator(instructionName) {
  const namespace = "global";
  const preimage = `${namespace}:${instructionName}`;
  const hash = crypto.createHash('sha256').update(preimage).digest();
  return hash.slice(0, 8);
}

// Calculate discriminators for our instructions
const instructions = [
  'initialize',
  'create_match',
  'deposit', 
  'settle_match',
  'refund_timeout'
];

console.log('🔍 Calculating Anchor instruction discriminators...\n');

instructions.forEach(instruction => {
  const discriminator = calculateDiscriminator(instruction);
  const hexString = discriminator.toString('hex');
  const bufferArray = Array.from(discriminator);
  
  console.log(`${instruction}:`);
  console.log(`  Hex: ${hexString}`);
  console.log(`  Buffer: [${bufferArray.join(', ')}]`);
  console.log(`  Buffer.from([${bufferArray.join(', ')}])`);
  console.log('');
});

// Generate the code for our manual client
console.log('📝 Code for manual client:');
console.log('const INSTRUCTION_DISCRIMINATORS = {');

instructions.forEach(instruction => {
  const discriminator = calculateDiscriminator(instruction);
  const bufferArray = Array.from(discriminator);
  console.log(`  ${instruction}: Buffer.from([${bufferArray.join(', ')}]),`);
});

console.log('};');
