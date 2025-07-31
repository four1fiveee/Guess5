#!/usr/bin/env node

// Test script to verify matchmaking fix
// This simulates what happens when a second laptop finds an existing match

const API_URL = 'https://guess5.onrender.com';

async function testMatchmakingResponse() {
  try {
    console.log('🧪 Testing matchmaking response...');
    
    // Simulate the second laptop finding an existing match
    const response = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        wallet: 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8',
        entryFee: 0.1145
      })
    });

    const data = await response.json();
    console.log('📊 Matchmaking response:', JSON.stringify(data, null, 2));
    
    if (data.status === 'matched') {
      console.log('✅ Match found!');
      console.log('📋 Match details:');
      console.log(`   Match ID: ${data.matchId}`);
      console.log(`   Player 1: ${data.player1}`);
      console.log(`   Player 2: ${data.player2}`);
      console.log(`   Match Status: ${data.matchStatus}`);
      console.log(`   Entry Fee: ${data.entryFee}`);
      console.log(`   Escrow Address: ${data.escrowAddress}`);
      console.log(`   Message: ${data.message}`);
      
      if (data.matchStatus === 'escrow') {
        console.log('💰 Match is in escrow - should show "Lock Entry Fee" button');
      } else if (data.matchStatus === 'active') {
        console.log('🎮 Match is active - should redirect to game');
      }
    } else {
      console.log('❌ Unexpected response:', data);
    }
  } catch (error) {
    console.error('❌ Error testing matchmaking:', error);
  }
}

console.log('🚀 Testing matchmaking fix...');
testMatchmakingResponse(); 