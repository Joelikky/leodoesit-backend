const express = require('express');
const router = express.Router();
const db = require('../db'); 

// --- GET ALL CLIENTS ---
router.get('/', async (req, res) => {
  const tenant_id = req.headers['x-tenant-id'];
  
  try {
    let query = 'SELECT * FROM public.clients';
    let params = [];
    
    if (tenant_id) {
      query += ' WHERE tenant_id = $1';
      params.push(tenant_id);
    }
    
    query += ' ORDER BY id DESC'; 
    
    const result = await db.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET Clients Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- POST: CREATE NEW CLIENT ---
router.post('/', async (req, res) => {
  const { company_name, name, billing_email, email, phone_number, net_terms, address, vendor_address, tenant_id } = req.body;
  
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
    res.status(500).json({ success: false, error: err.message }); // 🔥 Shows the actual DB error
  }
});

// --- PUT: UPDATE EXISTING CLIENT ---
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { company_name, name, billing_email, email, phone_number, net_terms, address, vendor_address, is_active } = req.body;

  try {
    // Safely handle aliases
    const finalName = company_name || name || '';
    const finalEmail = billing_email || email || '';
    const finalAddress = address || vendor_address || '';
    const activeState = is_active !== false; 

    const query = `
      UPDATE public.clients 
      SET company_name = $1, billing_email = $2, phone_number = $3, net_terms = $4, address = $5, is_active = $6
      WHERE id = $7
      RETURNING *;
    `;
    
    const values = [finalName, finalEmail, phone_number, net_terms, finalAddress, activeState, id];
    
    const result = await db.query(query, values);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("PUT Client Error:", err.message);
    res.status(500).json({ success: false, error: err.message }); // 🔥 Shows the actual DB error
  }
});

module.exports = router;