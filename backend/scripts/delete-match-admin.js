/**
 * Admin script to delete a match
 * Usage: ADMIN_USERNAME=your_username ADMIN_PASSWORD=your_password node scripts/delete-match-admin.js <matchId>
 */

require('dotenv').config({ path: '.env.local' });
const axios = require('axios');

async function deleteMatch() {
  const matchId = process.argv[2] || '15dcfba1-b4a5-4896-b563-937fa04d45f5';
  const apiUrl = process.env.API_URL || 'https://guess5.onrender.com';
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.error('❌ ADMIN_USERNAME and ADMIN_PASSWORD environment variables required');
    console.error('Usage: ADMIN_USERNAME=user ADMIN_PASSWORD=pass node scripts/delete-match-admin.js <matchId>');
    process.exit(1);
  }

  try {
    // Step 1: Login to get token
    console.log('🔐 Logging in...');
    const loginResponse = await axios.post(`${apiUrl}/api/admin/auth/login`, {
      username,
      password,
    });

    const token = loginResponse.data.token;
    if (!token) {
      throw new Error('No token received from login');
    }

    console.log('✅ Login successful');

    // Step 2: Delete match
    console.log(`🗑️  Deleting match ${matchId}...`);
    const deleteResponse = await axios.post(
      `${apiUrl}/api/admin/delete-match/${matchId}`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Match deleted successfully:', deleteResponse.data);
  } catch (error) {
    if (error.response) {
      console.error('❌ Error:', error.response.status, error.response.data);
    } else {
      console.error('❌ Error:', error.message);
    }
    process.exit(1);
  }
}

deleteMatch();

