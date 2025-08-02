#!/usr/bin/env node

// Test to see what the 400 CORS error is about
const API_URL = 'https://guess5.onrender.com';

async function testCorsError() {
  try {
    console.log('🔍 Testing CORS error details...\n');
    
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
    
    // Get the error response body
    const errorBody = await corsTest.text();
    console.log('Error response body:', errorBody);
    
    // Try with a valid wallet format
    console.log('\n🔍 Testing with valid wallet format...');
    const validTest = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({ 
        wallet: 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8', 
        entryFee: 0.1 
      })
    });
    
    console.log('Valid test status:', validTest.status);
    if (validTest.ok) {
      const validResult = await validTest.json();
      console.log('Valid test result:', validResult);
    } else {
      const validErrorBody = await validTest.text();
      console.log('Valid test error:', validErrorBody);
    }
    
  } catch (error) {
    console.error('❌ Error during CORS test:', error);
  }
}

console.log('🚀 Testing CORS error details...');
testCorsError(); 