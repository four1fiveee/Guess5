// Delete all stuck matches via admin API
const https = require('https');

const API_URL = 'https://guess5.onrender.com';

function deleteMatch(matchId) {
  return new Promise((resolve, reject) => {
    const url = `${API_URL}/api/admin/delete-match/${matchId}`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 second timeout
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ success: true, matchId });
        } else {
          resolve({ success: false, matchId, error: data });
        }
      });
    });

    req.on('error', (error) => {
      resolve({ success: false, matchId, error: error.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, matchId, error: 'timeout' });
    });

    req.end();
  });
}

async function deleteAllStuckMatches() {
  // Get all stuck match IDs from the query result
  const stuckMatchIds = [
    '02222c92-fa47-4d50-907a-35693a7a23f2',
    'a69c9305-ead6-4c66-b201-25762f017d8d',
    'b137c31c-28cf-4387-9dab-fb9be48ef382',
    '0050ba78-947c-489c-9d9c-ec33514064bd',
    'b404fcac-4de3-4abf-a2d7-807f73e2ec0f',
    '870fe8c3-135a-4060-bb4c-4fc1fa47a872',
    'c6b8b69c-53c6-413e-bac9-492dadbfb08b',
    '0e87fc2e-754b-4510-afd3-be9f5bc6234c',
    'da9cae73-a385-4dc6-94bc-eb0be43abec1',
    'adde07ad-9aef-43ec-82c0-0f343180fb01',
    '5e28d126-09a9-4868-aae2-c58fbb25f535',
    'fa17df2b-b37b-45b0-859f-277f8d693211',
    '05b2b5c8-3d62-4c23-ad1b-12d0987f37ac',
    'f635c5f5-9615-46f0-974b-ec8b5d15a39f',
    '47a955f5-e3b2-461b-88d0-75ae575d213b',
    'f57fad2f-2b14-4013-b2c9-79644d6301e0',
    '7e5af550-b70e-4402-b8dc-9baf9095fa1a',
    '3c36c7ab-5dbc-4e29-8c9d-297de65bcf27',
    '80aadd82-6d68-4d35-a93f-61611458131b',
    'c21ebe4d-d0be-4aeb-af35-cce8adeb676c',
  ];

  console.log(`🗑️ Deleting ${stuckMatchIds.length} stuck matches...\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < stuckMatchIds.length; i++) {
    const matchId = stuckMatchIds[i];
    process.stdout.write(`[${i + 1}/${stuckMatchIds.length}] Deleting ${matchId.substring(0, 8)}... `);
    
    const result = await deleteMatch(matchId);
    
    if (result.success) {
      console.log('✅');
      success++;
    } else {
      console.log(`❌ (${result.error || 'failed'})`);
      failed++;
    }

    // Small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log(`\n✅ Deleted: ${success}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${stuckMatchIds.length}`);
}

deleteAllStuckMatches().catch(console.error);

