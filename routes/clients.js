const express = require('express');
const router = express.Router();
const db = require('../db');

// GET: Only fetch clients for the active portal
router.get('/', async (req, res) => {
  const tenantId = req.headers['x-tenant-id']; 
  try {
    const result = await db.query(
      'SELECT * FROM clients WHERE tenant_id = $1 ORDER BY company_name ASC', 
      [tenantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch clients" });
  }
});

// POST: Add a new client tagged to the current company
router.post('/', async (req, res) => {
  const { company_name, billing_email, net_terms, vendor_address, tenant_id, is_active } = req.body;
  try {
    const query = `
      INSERT INTO clients (company_name, billing_email, net_terms, vendor_address, tenant_id, is_active)
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, true))
      RETURNING *;
    `;
    const result = await db.query(query, [company_name, billing_email, net_terms, vendor_address, tenant_id, is_active]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to create client." });
  }
});

// PUT: Edit an existing client
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { company_name, billing_email, net_terms, vendor_address, is_active } = req.body;
  
  try {
    const query = `
      UPDATE clients
      SET company_name = $1, billing_email = $2, net_terms = $3, vendor_address = $4, is_active = $5
      WHERE id = $6
      RETURNING *;
    `;
    const result = await db.query(query, [company_name, billing_email, net_terms, vendor_address, is_active, id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Client not found." });
    }
    
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Backend Error updating client:", err.message);
    res.status(500).json({ success: false, error: "Failed to update client." });
  }
});

module.exports = router;