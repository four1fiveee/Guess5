#!/usr/bin/env node

// Simple test script to help resolve stuck matchmaking
// Run this to clean up stuck matches for testing

const API_URL = 'https://guess5.onrender.com';

async function cleanupStuckMatches(wallet) {
  try {
    console.log(`🧹 Cleaning up stuck matches for wallet: ${wallet}`);
    
    const response = await fetch(`${API_URL}/api/match/cleanup-stuck-matches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ wallet })
    });

    const data = await response.json();
    console.log('✅ Cleanup result:', data);
    
    if (data.success) {
      console.log(`✅ Cleaned up ${data.cleanedMatches} stuck matches`);
    } else {
      console.log('❌ Cleanup failed:', data.error);
    }
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  }
}

// Test with the wallet that's stuck
const stuckWallet = 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8';

console.log('🚀 Testing stuck match cleanup...');
cleanupStuckMatches(stuckWallet); 