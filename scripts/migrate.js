/**
 * howldr ProofWorks
 * Schema migration runner
 *
 * Reads src/schema.sql and applies it against the database in DATABASE_URL.
 * Idempotent: every statement in schema.sql uses IF NOT EXISTS / CREATE OR REPLACE.
 *
 * Usage:  npm run migrate
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error('[migrate] DATABASE_URL is not set. Copy .env.example to .env and configure it.');
    process.exit(1);
  }

  const schemaPath = path.join(__dirname, '..', 'src', 'schema.sql');
  const schema     = fs.readFileSync(schemaPath, 'utf8');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log(`[migrate] Applying schema from ${schemaPath}`);
    await pool.query(schema);
    console.log('[migrate] Schema applied successfully');
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});
