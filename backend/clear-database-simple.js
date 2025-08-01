// Set the database URL
process.env.DATABASE_URL = 'postgresql://guess5_user:nxf1TsMfS4XwW5Ix59zMDxm8kJC7CBpD@dpg-d21t6nqdbo4c73ek2in0-a.ohio-postgres.render.com/guess5?sslmode=require';

const { Client } = require('pg');

async function clearDatabase() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Database connected');

    // Get all matches
    const result = await client.query('SELECT COUNT(*) FROM "match"');
    const count = parseInt(result.rows[0].count);
    console.log(`📊 Found ${count} total matches`);

    if (count > 0) {
      // Remove all matches
      await client.query('DELETE FROM "match"');
      console.log(`✅ Cleared ${count} matches from database`);
    } else {
      console.log('✅ Database is already empty');
    }

    console.log('🎉 Database cleanup completed!');
  } catch (error) {
    console.error('❌ Error clearing database:', error);
  } finally {
    await client.end();
    process.exit(0);
  }
}

clearDatabase(); 