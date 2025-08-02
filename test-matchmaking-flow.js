#!/usr/bin/env node

// Comprehensive test script to diagnose matchmaking issues
const API_URL = 'https://guess5.onrender.com';

async function testMatchmakingFlow() {
  try {
    console.log('🔍 Diagnosing matchmaking flow...\n');
    
    // Test 1: Check health endpoint
    console.log('1️⃣ Testing health endpoint...');
    const health = await fetch(`${API_URL}/health`);
    const healthResult = await health.json();
    console.log('Health status:', healthResult.status);
    console.log('Active games:', healthResult.checks.activeGames);
    console.log('Matchmaking locks:', healthResult.checks.matchmakingLocks);
    console.log('');
    
    // Test 2: Check if we can request a match
    console.log('2️⃣ Testing match request...');
    const wallet1 = 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8';
    
    const matchRequest = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        wallet: wallet1, 
        entryFee: 0.1 
      })
    });
    
    if (!matchRequest.ok) {
      console.log('❌ Match request failed:', matchRequest.status, matchRequest.statusText);
      const errorText = await matchRequest.text();
      console.log('Error details:', errorText);
    } else {
      const matchResult = await matchRequest.json();
      console.log('✅ Match request successful:', matchResult);
    }
    console.log('');
    
    // Test 3: Check match status for the wallet
    console.log('3️⃣ Checking match status for wallet...');
    const statusRequest = await fetch(`${API_URL}/api/match/check-match/${wallet1}`);
    if (statusRequest.ok) {
      const statusResult = await statusRequest.json();
      console.log('Match status:', statusResult);
    } else {
      console.log('❌ Status check failed:', statusRequest.status);
    }
    console.log('');
    
    // Test 4: Try to get waiting players (if debug endpoint exists)
    console.log('4️⃣ Checking for waiting players...');
    try {
      const waitingRequest = await fetch(`${API_URL}/api/match/debug/waiting`);
      if (waitingRequest.ok) {
        const waitingResult = await waitingRequest.json();
        console.log('Waiting players:', waitingResult);
      } else {
        console.log('Debug endpoint not available in production');
      }
    } catch (error) {
      console.log('Debug endpoint not available');
    }
    console.log('');
    
    // Test 5: Test CORS with frontend origin
    console.log('5️⃣ Testing CORS with frontend origin...');
    const corsTest = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: 'test-wallet', 
        entryFee: 0.1 
      })
    });
    console.log('CORS test status:', corsTest.status);
    console.log('CORS headers:', Object.fromEntries(corsTest.headers.entries()));
    console.log('');
    
    console.log('✅ Matchmaking flow diagnosis completed!');
    
  } catch (error) {
    console.error('❌ Error during diagnosis:', error);
  }
}

console.log('🚀 Starting comprehensive matchmaking diagnosis...');
testMatchmakingFlow(); 