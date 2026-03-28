const express = require('express');
const router = express.Router();
const db = require('../db');

// 1. GET ROUTE: Fetch all clients
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM clients ORDER BY company_name ASC');
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: "Failed to fetch clients" });
  }
});

// 2. POST ROUTE: Add a new client
router.post('/', async (req, res) => {
  const { company_name, billing_email } = req.body;
  try {
    const newQuery = `
      INSERT INTO clients (company_name, billing_email)
      VALUES ($1, $2)
      RETURNING *;
    `;
    const values = [company_name, billing_email || null];
    const result = await db.query(newQuery, values);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Backend Crash Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to create client." });
  }
});

// 3. PUT ROUTE: Edit a client (The Diamond Upgrade)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { company_name, billing_email, is_active } = req.body;

  try {
    const updateQuery = `
      UPDATE clients 
      SET company_name = $1, billing_email = $2, is_active = $3
      WHERE id = $4 
      RETURNING *;
    `;
    const values = [company_name, billing_email, is_active, id];
    const result = await db.query(updateQuery, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Client not found" });
    }
    res.json({ success: true, message: "Client updated!", data: result.rows[0] });
  } catch (err) {
    console.error("Backend Crash Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to update client." });
  }
});

module.exports = router;