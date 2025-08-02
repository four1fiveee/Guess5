#!/usr/bin/env node

// Test to simulate real players using the frontend
const API_URL = 'https://guess5.onrender.com';

async function simulateRealPlayers() {
  try {
    console.log('🎮 Simulating real players using the frontend...\n');
    
    // Simulate Player 1 (from frontend)
    console.log('👤 Player 1: Opening frontend and clicking "Find Match"');
    const player1Wallet = 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8';
    
    const player1Request = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: player1Wallet, 
        entryFee: 0.1 
      })
    });
    
    const player1Result = await player1Request.json();
    console.log('Player 1 result:', player1Result);
    
    // Wait a moment to simulate real user behavior
    console.log('⏳ Waiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Simulate Player 2 (from frontend)
    console.log('👤 Player 2: Opening frontend and clicking "Find Match"');
    const player2Wallet = 'AdujK4E4Rme8sza8ZTrbX2HHGnde31NTUjRk5MErxf3A';
    
    const player2Request = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: player2Wallet, 
        entryFee: 0.1 
      })
    });
    
    const player2Result = await player2Request.json();
    console.log('Player 2 result:', player2Result);
    
    // Check if they matched
    if (player2Result.status === 'matched') {
      console.log('\n🎉 SUCCESS: Players matched!');
      console.log('Match ID:', player2Result.matchId);
      console.log('Escrow Address:', player2Result.escrowAddress);
      console.log('Entry Fee:', player2Result.entryFee);
      
      // Check match status
      console.log('\n📊 Checking match status...');
      const statusRequest = await fetch(`${API_URL}/api/match/status/${player2Result.matchId}`);
      const statusResult = await statusRequest.json();
      console.log('Match status:', statusResult);
    } else {
      console.log('\n❌ Players did not match. Status:', player2Result.status);
    }
    
    console.log('\n✅ Real player simulation completed!');
    
  } catch (error) {
    console.error('❌ Error during simulation:', error);
  }
}

console.log('🚀 Simulating real players using the frontend...');
simulateRealPlayers(); 