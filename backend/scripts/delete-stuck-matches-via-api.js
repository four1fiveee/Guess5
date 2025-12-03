// Script to delete stuck matches via admin API endpoint
// Usage: NEXT_PUBLIC_API_URL=https://guess5.onrender.com node delete-stuck-matches-via-api.js

// Node.js 18+ has fetch built-in, but if not available, we'll use a fallback
let fetchFn;
if (typeof fetch !== 'undefined') {
  fetchFn = fetch;
} else {
  // Fallback for older Node versions
  fetchFn = require('node-fetch');
}

const stuckMatchIds = [
  '02222c92-fa47-4d50-907a-35693a7a23f2', // Most recent - Dec 2
  'a69c9305-ead6-4c66-b201-25762f017d8d', // Nov 25
  'b137c31c-28cf-4387-9dab-fb9be48ef382', // Nov 25
  '0050ba78-947c-489c-9d9c-ec33514064bd', // Nov 24
  'b404fcac-4de3-4abf-a2d7-807f73e2ec0f', // Nov 24
  '870fe8c3-135a-4060-bb4c-4fc1fa47a872', // Nov 21
  'c6b8b69c-53c6-413e-bac9-492dadbfb08b', // Nov 21
  '0e87fc2e-754b-4510-afd3-be9f5bc6234c', // Nov 20
  'da9cae73-a385-4dc6-94bc-eb0be43abec1', // Nov 20
  'adde07ad-9aef-43ec-82c0-0f343180fb01', // Nov 20
  '5e28d126-09a9-4868-aae2-c58fbb25f535', // Nov 20
  'fa17df2b-b37b-45b0-859f-277f8d693211', // Nov 20
  '05b2b5c8-3d62-4c23-ad1b-12d0987f37ac', // Nov 20
  'f635c5f5-9615-46f0-974b-ec8b5d15a39f', // Nov 20
  '47a955f5-e3b2-461b-88d0-75ae575d213b', // Nov 20
  'f57fad2f-2b14-4013-b2c9-79644d6301e0', // Nov 20
  '7e5af550-b70e-4402-b8dc-9baf9095fa1a', // Nov 20
  '3c36c7ab-5dbc-4e29-8c9d-297de65bcf27', // Nov 16
  '80aadd82-6d68-4d35-a93f-61611458131b', // Nov 16
  'c21ebe4d-d0be-4aeb-af35-cce8adeb676c', // Nov 15
];

async function deleteMatch(matchId, apiUrl) {
  try {
    const response = await fetchFn(`${apiUrl}/api/admin/delete-match/${matchId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log(`✅ Deleted match: ${matchId}`);
      return true;
    } else {
      console.error(`❌ Failed to delete match ${matchId}:`, data.error || 'Unknown error');
      return false;
    }
  } catch (error) {
    console.error(`❌ Error deleting match ${matchId}:`, error.message);
    return false;
  }
}

async function deleteAllStuckMatches() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://guess5.onrender.com';
  
  console.log(`🗑️ Deleting ${stuckMatchIds.length} stuck matches via API: ${apiUrl}`);
  console.log('');
  
  let successCount = 0;
  let failCount = 0;
  
  for (const matchId of stuckMatchIds) {
    const success = await deleteMatch(matchId, apiUrl);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('');
  console.log(`✅ Deleted: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📊 Total: ${stuckMatchIds.length}`);
}

// Run if executed directly
if (require.main === module) {
  deleteAllStuckMatches().catch(console.error);
}

module.exports = { deleteMatch, deleteAllStuckMatches };

