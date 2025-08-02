#!/usr/bin/env node

// Test script for improved matchmaking with better cleanup
// This helps test the new rate limiting and stale match cleanup

const API_URL = 'https://guess5.onrender.com';

async function testImprovedMatchmaking(wallet1, wallet2) {
  try {
    console.log('🧪 Testing improved matchmaking...');
    console.log(`Wallet 1: ${wallet1}`);
    console.log(`Wallet 2: ${wallet2}`);
    
    // Step 1: Force cleanup for both wallets
    console.log('\n🧹 Step 1: Force cleanup for both wallets');
    
    const cleanup1 = await fetch(`${API_URL}/api/match/force-cleanup-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: wallet1 })
    });
    const cleanup1Result = await cleanup1.json();
    console.log('Cleanup 1 result:', cleanup1Result);
    
    const cleanup2 = await fetch(`${API_URL}/api/match/force-cleanup-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: wallet2 })
    });
    const cleanup2Result = await cleanup2.json();
    console.log('Cleanup 2 result:', cleanup2Result);
    
    // Step 2: Test matchmaking for wallet 1
    console.log('\n🎮 Step 2: Test matchmaking for wallet 1');
    const match1 = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        wallet: wallet1, 
        entryFee: 0.1 
      })
    });
    const match1Result = await match1.json();
    console.log('Match 1 result:', match1Result);
    
    // Step 3: Test matchmaking for wallet 2
    console.log('\n🎮 Step 3: Test matchmaking for wallet 2');
    const match2 = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        wallet: wallet2, 
        entryFee: 0.1 
      })
    });
    const match2Result = await match2.json();
    console.log('Match 2 result:', match2Result);
    
    // Step 4: Check match status
    if (match1Result.matchId) {
      console.log('\n📊 Step 4: Check match status');
      const status = await fetch(`${API_URL}/api/match/status/${match1Result.matchId}`);
      const statusResult = await status.json();
      console.log('Match status:', statusResult);
    }
    
    console.log('\n✅ Improved matchmaking test completed!');
    
  } catch (error) {
    console.error('❌ Error testing improved matchmaking:', error);
  }
}

// Test with the wallets that were having issues
const wallet1 = 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8';
const wallet2 = 'AdujK4E4Rme8sza8ZTrbX2HHGnde31NTUjRk5MErxf3A';

console.log('🚀 Testing improved matchmaking with better cleanup and rate limiting...');
testImprovedMatchmaking(wallet1, wallet2); 