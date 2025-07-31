#!/usr/bin/env node

// Test script to verify CORS is working
const API_URL = 'https://guess5.onrender.com';

async function testCORS() {
  try {
    console.log('🧪 Testing CORS configuration...');
    
    // Test OPTIONS request (preflight)
    console.log('📤 Testing OPTIONS request...');
    const optionsResponse = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://guess5.vercel.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });
    
    console.log('📊 OPTIONS Response Status:', optionsResponse.status);
    console.log('📊 OPTIONS Response Headers:', {
      'Access-Control-Allow-Origin': optionsResponse.headers.get('Access-Control-Allow-Origin'),
      'Access-Control-Allow-Methods': optionsResponse.headers.get('Access-Control-Allow-Methods'),
      'Access-Control-Allow-Headers': optionsResponse.headers.get('Access-Control-Allow-Headers')
    });
    
    // Test actual POST request
    console.log('📤 Testing POST request...');
    const postResponse = await fetch(`${API_URL}/api/match/request-match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://guess5.vercel.app'
      },
      body: JSON.stringify({
        wallet: '7oFPm3Rat3WbJsRSAFovHk6KjQx11FgokA4TUMSypKCU',
        entryFee: 0.1153
      })
    });
    
    console.log('📊 POST Response Status:', postResponse.status);
    console.log('📊 POST Response Headers:', {
      'Access-Control-Allow-Origin': postResponse.headers.get('Access-Control-Allow-Origin'),
      'Content-Type': postResponse.headers.get('Content-Type')
    });
    
    if (postResponse.ok) {
      const data = await postResponse.json();
      console.log('✅ POST request successful:', data);
    } else {
      console.log('❌ POST request failed:', postResponse.status, postResponse.statusText);
    }
    
  } catch (error) {
    console.error('❌ CORS test failed:', error);
  }
}

console.log('🚀 Testing CORS configuration...');
testCORS(); 