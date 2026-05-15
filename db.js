const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  // 🔥 Added timeout configurations to prevent ECONNRESET
  idleTimeoutMillis: 30000,      // Closes idle connections after 30 seconds
  connectionTimeoutMillis: 5000, // Returns an error after 5 seconds if connection fails
});

pool.on('error', (err, client) => {
  console.error('Idle database connection was closed by Supabase:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};