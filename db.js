const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on('error', (err, client) => {
  console.error('Idle database connection was closed by Supabase:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};