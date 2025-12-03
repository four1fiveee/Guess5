// Simple delete - just by ID, no complex WHERE clause
const { Pool } = require('pg');

const DATABASE_URL = "postgresql://guess5_user:nxf1TsMfS4XwW5Ix59zMDxm8kJC7CBpD@dpg-d21t6nqdbo4c73ek2in0-a.ohio-postgres.render.com/guess5?sslmode=require";

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

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 60000, // 60 seconds
});

async function deleteMatches() {
  console.log('🔗 Connecting...');
  const client = await pool.connect();
  console.log('✅ Connected\n');
  
  try {
    await client.query('BEGIN');
    let deleted = 0;
    
    for (let i = 0; i < matchIds.length; i++) {
      const matchId = matchIds[i];
      try {
        process.stdout.write(`[${i + 1}/${matchIds.length}] ${matchId.substring(0, 8)}... `);
        const result = await Promise.race([
          client.query('DELETE FROM "match" WHERE id = $1', [matchId]),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))
        ]);
        if (result.rowCount > 0) {
          console.log('✅');
          deleted++;
        } else {
          console.log('⚠️');
        }
      } catch (error) {
        console.log(`❌ ${error.message}`);
      }
    }
    
    await client.query('COMMIT');
    console.log(`\n✅ Total deleted: ${deleted}/${matchIds.length}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction failed:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

deleteMatches().catch(console.error);

