const { Pool } = require('pg');
const { DATABASE_URL } = require('./config');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL && DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tests (
      id SERIAL PRIMARY KEY,
      code VARCHAR(6) UNIQUE NOT NULL,
      title TEXT NOT NULL,
      created_by BIGINT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      questions JSONB NOT NULL,
      text_a JSONB,
      text_b JSONB
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attempts (
      id SERIAL PRIMARY KEY,
      test_id INTEGER REFERENCES tests(id),
      telegram_user_id BIGINT NOT NULL,
      full_name TEXT NOT NULL,
      toifa_target TEXT NOT NULL,
      attempt_number INTEGER NOT NULL,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ,
      status TEXT DEFAULT 'in_progress',
      score INTEGER,
      answers JSONB DEFAULT '{}'::jsonb
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_attempts_test_user ON attempts(test_id, telegram_user_id);
  `);
}

module.exports = { pool, initDb };
