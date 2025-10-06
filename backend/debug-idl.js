const fs = require('fs');

// Load the IDL
const idlPath = './smart-contract/target/idl/guess5_escrow_corrected.json';
const IDL = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

console.log('🔍 Debugging IDL structure...');
console.log('📋 IDL sections:', Object.keys(IDL));

// Check if types section exists
if (IDL.types) {
  console.log('✅ Types section found with', IDL.types.length, 'types');
  
  // Find MatchResult type
  const matchResultType = IDL.types.find(type => type.name === 'MatchResult');
  if (matchResultType) {
    console.log('✅ MatchResult type found:', JSON.stringify(matchResultType, null, 2));
  } else {
    console.log('❌ MatchResult type not found');
    console.log('📋 Available types:', IDL.types.map(t => t.name));
  }
} else {
  console.log('❌ No types section found');
}

// Check instructions section
if (IDL.instructions) {
  console.log('✅ Instructions section found with', IDL.instructions.length, 'instructions');
  
  // Find settle_match instruction
  const settleMatchInstruction = IDL.instructions.find(ix => ix.name === 'settle_match');
  if (settleMatchInstruction) {
    console.log('✅ settle_match instruction found');
    console.log('📋 settle_match args:', JSON.stringify(settleMatchInstruction.args, null, 2));
  } else {
    console.log('❌ settle_match instruction not found');
    console.log('📋 Available instructions:', IDL.instructions.map(ix => ix.name));
  }
} else {
  console.log('❌ No instructions section found');
}

// Check if there are any circular references or issues
console.log('🔍 Checking for potential issues...');

// Look for any references to MatchResult in the entire IDL
const idlString = JSON.stringify(IDL);
const matchResultReferences = (idlString.match(/MatchResult/g) || []).length;
console.log('📊 Total MatchResult references:', matchResultReferences);

// Check if MatchResult is defined before it's used
const typesIndex = idlString.indexOf('"types"');
const instructionsIndex = idlString.indexOf('"instructions"');
const matchResultDefIndex = idlString.indexOf('"name":"MatchResult"');
const matchResultUseIndex = idlString.indexOf('"name":"MatchResult"', matchResultDefIndex + 1);

console.log('📊 Section order analysis:');
console.log('  - types section at index:', typesIndex);
console.log('  - instructions section at index:', instructionsIndex);
console.log('  - MatchResult definition at index:', matchResultDefIndex);
console.log('  - MatchResult usage at index:', matchResultUseIndex);

if (typesIndex < instructionsIndex) {
  console.log('✅ Types section comes before instructions section');
} else {
  console.log('❌ Instructions section comes before types section');
}

if (matchResultDefIndex < matchResultUseIndex) {
  console.log('✅ MatchResult is defined before it\'s used');
} else {
  console.log('❌ MatchResult is used before it\'s defined');
}



