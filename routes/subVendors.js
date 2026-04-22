const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all active sub-vendors (Notice we removed the "AND status = 'Active'" filter so we can see inactive ones too!)
router.get('/', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  try {
    const result = await db.query(
      "SELECT * FROM sub_vendors WHERE tenant_id = $1 ORDER BY company_name ASC", 
      [tenantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST a new sub-vendor
router.post('/', async (req, res) => {
  const { 
    tenant_id, 
    company_name, 
    billing_email,
    billing_phone,
    net_terms,
    address,
    status
  } = req.body;

  try {
    const query = `
      INSERT INTO sub_vendors (tenant_id, company_name, billing_email, billing_phone, net_terms, address, status) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
    `;
    const result = await db.query(query, [
      tenant_id, 
      company_name, 
      billing_email, 
      billing_phone,
      net_terms,
      address,
      status || 'Active'
    ]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔥 NEW: PUT route to Edit/Update an existing sub-vendor
router.put('/:id', async (req, res) => {
  const vendorId = req.params.id;
  const { 
    company_name, 
    billing_email,
    billing_phone,
    net_terms,
    address,
    status 
  } = req.body;

  try {
    const query = `
      UPDATE sub_vendors 
      SET company_name = $1, billing_email = $2, billing_phone = $3, net_terms = $4, address = $5, status = $6
      WHERE id = $7 RETURNING *;
    `;
    const result = await db.query(query, [
      company_name, 
      billing_email, 
      billing_phone, 
      net_terms, 
      address, 
      status, 
      vendorId
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Sub Vendor not found." });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;