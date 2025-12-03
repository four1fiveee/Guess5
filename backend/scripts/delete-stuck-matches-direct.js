// Delete stuck matches directly using Render database connection
// This script uses the DATABASE_URL from environment or you can pass it as an argument
const { Pool } = require('pg');

const matchIds = [
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

async function deleteStuckMatches() {
  // Get DATABASE_URL from environment or command line
  const databaseUrl = process.env.DATABASE_URL || process.argv[2];
  
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL is required');
    console.error('Usage: DATABASE_URL="postgresql://..." node delete-stuck-matches-direct.js');
    console.error('   OR: node delete-stuck-matches-direct.js "postgresql://..."');
    process.exit(1);
  }

  console.log('🔗 Connecting to database...');
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    const client = await pool.connect();
    console.log('✅ Database connection established\n');
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < matchIds.length; i++) {
      const matchId = matchIds[i];
      process.stdout.write(`[${i + 1}/${matchIds.length}] Deleting ${matchId.substring(0, 8)}... `);
      
      try {
        const result = await client.query('DELETE FROM "match" WHERE id = $1', [matchId]);
        if (result.rowCount > 0) {
          console.log('✅');
          successCount++;
        } else {
          console.log('⚠️ (not found)');
        }
      } catch (error) {
        console.log(`❌ (${error.message})`);
        failCount++;
      }
    }
    
    client.release();
    await pool.end();
    
    console.log(`\n✅ Deleted: ${successCount}`);
    console.log(`⚠️ Not found: ${matchIds.length - successCount - failCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`📊 Total: ${matchIds.length}`);
    
  } catch (error) {
    console.error('❌ Database error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

deleteStuckMatches();

