const express = require('express');
const router = express.Router();
const db = require('../db');

// 1. GET: Fetch all contractors
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM users ORDER BY first_name ASC');
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (err) {
    console.error("Error fetching users:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch contractors" });
  }
});

// 2. POST: Add a new contractor (They default to active in the DB!)
router.post('/', async (req, res) => {
  const { first_name, last_name, default_hourly_rate, email } = req.body;
  try {
    const newQuery = `
      INSERT INTO users (first_name, last_name, default_hourly_rate, email)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const values = [first_name, last_name, parseFloat(default_hourly_rate), email];
    const result = await db.query(newQuery, values);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Backend Crash Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to create contractor." });
  }
});

// 3. PUT: The "Gold Standard" Edit Route (Now handles is_active!)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { first_name, last_name, email, default_hourly_rate, is_active } = req.body;

  try {
    const updateQuery = `
      UPDATE users 
      SET first_name = $1, last_name = $2, email = $3, default_hourly_rate = $4, is_active = $5
      WHERE id = $6 
      RETURNING *;
    `;
    // Notice we added is_active to the array of values saving to the database
    const values = [first_name, last_name, email, parseFloat(default_hourly_rate), is_active, id];
    const result = await db.query(updateQuery, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Contractor not found" });
    }
    res.json({ success: true, message: "Contractor updated!", data: result.rows[0] });
  } catch (err) {
    console.error("Backend Crash Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to update contractor." });
  }
});

module.exports = router;