require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.NEXT_PUBLIC_DB_CONNECTION_STRING });
  await client.connect();
  const res = await client.query('SELECT script_data, audio_url, caption_data, image_urls FROM short_video_assets ORDER BY created_at DESC LIMIT 1');
  console.log(JSON.stringify(res.rows[0], null, 2));
  await client.end();
}

run().catch(console.error);
