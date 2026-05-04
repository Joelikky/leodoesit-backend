const express = require('express');
const router = express.Router();
const db = require('../db'); 

// --- GET ALL CLIENTS ---
router.get('/', async (req, res) => {
  const tenant_id = req.headers['x-tenant-id'];
  
  // 🔥 FIX 1: Strict Isolation. Reject the request if tenant_id is missing. 
  // Do NOT fall back to showing all data.
  if (!tenant_id) {
    return res.status(400).json({ success: false, error: 'Access Denied: Tenant ID is required.' });
  }

  try {
    const query = 'SELECT * FROM public.clients WHERE tenant_id = $1 ORDER BY id DESC';
    const result = await db.query(query, [tenant_id]);
    
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET Clients Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- POST: CREATE NEW CLIENT ---
router.post('/', async (req, res) => {
  // 🔥 FIX 2: Trust the header for tenant_id over the body for better security
  const tenant_id = req.headers['x-tenant-id'] || req.body.tenant_id;
  const { company_name, name, billing_email, email, phone_number, net_terms, address, vendor_address } = req.body;
  
  if (!tenant_id) {
    return res.status(400).json({ success: false, error: 'Access Denied: Tenant ID is required.' });
  }

  try {
    // Safely handle aliases in case your DB expects different names
    const finalName = company_name || name || '';
    const finalEmail = billing_email || email || '';
    const finalAddress = address || vendor_address || '';

    const query = `
      INSERT INTO public.clients (company_name, billing_email, phone_number, net_terms, address, tenant_id, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const values = [finalName, finalEmail, phone_number, net_terms, finalAddress, tenant_id, true]; 
    
    const result = await db.query(query, values);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("POST Client Error:", err.message);
    res.status(500).json({ success: false, error: err.message }); 
  }
});

// --- PUT: UPDATE EXISTING CLIENT ---
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const tenant_id = req.headers['x-tenant-id'];
  const { company_name, name, billing_email, email, phone_number, net_terms, address, vendor_address, is_active } = req.body;

  if (!tenant_id) {
    return res.status(400).json({ success: false, error: 'Access Denied: Tenant ID is required.' });
  }

  try {
    // Safely handle aliases
    const finalName = company_name || name || '';
    const finalEmail = billing_email || email || '';
    const finalAddress = address || vendor_address || '';
    const activeState = is_active !== false; 

    // 🔥 FIX 3: Add tenant_id to the WHERE clause to prevent cross-tenant overwrites
    const query = `
      UPDATE public.clients 
      SET company_name = $1, billing_email = $2, phone_number = $3, net_terms = $4, address = $5, is_active = $6
      WHERE id = $7 AND tenant_id = $8
      RETURNING *;
    `;
    
    const values = [finalName, finalEmail, phone_number, net_terms, finalAddress, activeState, id, tenant_id];
    
    const result = await db.query(query, values);
    
    // Safety check: If no rows were updated, it means the ID doesn't exist OR belongs to another tenant
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Client not found or belongs to another workspace.' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("PUT Client Error:", err.message);
    res.status(500).json({ success: false, error: err.message }); 
  }
});

module.exports = router;