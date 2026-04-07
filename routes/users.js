const express = require('express');
const router = express.Router();
const db = require('../db');

// 1. GET: Fetch employees ONLY for the active portal
router.get('/', async (req, res) => {
  // Capture the tenant_id from the request headers
  const tenantId = req.headers['x-tenant-id']; 

  if (!tenantId) {
    return res.status(400).json({ success: false, error: "Tenant ID is required." });
  }

  try {
    const query = `
      SELECT 
        u.id, u.first_name, u.last_name, u.email, u.is_active, u.tenant_id,
        e.phone_number, e.address, TO_CHAR(e.dob, 'YYYY-MM-DD') as dob, e.visa_status,
        e.role, TO_CHAR(e.start_date, 'YYYY-MM-DD') as start_date, e.invoice_num, e.contract_type,
        e.pay_rate, e.invoice_rate,
        e.c2c_name, e.c2c_email, e.c2c_phone,
        e.vendor_name, e.vendor_email, e.vendor_address, e.vendor_for, 
        TO_CHAR(e.project_start_date, 'YYYY-MM-DD') as project_start_date, e.net_terms,
        e.i9_completed, e.w4_completed, e.everify_completed, e.bank_details_completed
      FROM public.users u
      LEFT JOIN public.employee_details e ON u.id = e.user_id
      WHERE u.tenant_id = $1  -- 🔥 THIS IS THE SEPARATION WALL
      ORDER BY u.first_name ASC
    `;
    const result = await db.query(query, [tenantId]);
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (err) {
    console.error("Error fetching users:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch employees" });
  }
});

// 2. POST: Create a new employee linked to the specific portal
router.post('/', async (req, res) => {
  const {
    first_name, last_name, email,
    tenant_id, // Capture tenant_id from the frontend form
    phone_number, address, dob, visa_status,
    role, start_date, invoice_num, contract_type,
    pay_rate, invoice_rate,
    c2c_name, c2c_email, c2c_phone,
    vendor_name, vendor_email, vendor_address, vendor_for, project_start_date, net_terms,
    i9_completed, w4_completed, everify_completed, bank_details_completed
  } = req.body;

  try {
    await db.query('BEGIN');

    // Create the core login and link it to the company (tenant_id)
    const userQuery = `
      INSERT INTO public.users (first_name, last_name, email, tenant_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id, first_name, last_name, email, is_active, tenant_id;
    `;
    const userResult = await db.query(userQuery, [first_name, last_name, email, tenant_id]);
    const newUser = userResult.rows[0];

    // Create the HR details and link them as well
    const detailsQuery = `
      INSERT INTO public.employee_details (
        user_id, tenant_id, phone_number, address, dob, visa_status,
        role, start_date, invoice_num, contract_type,
        pay_rate, invoice_rate,
        c2c_name, c2c_email, c2c_phone,
        vendor_name, vendor_email, vendor_address, vendor_for, project_start_date, net_terms,
        i9_completed, w4_completed, everify_completed, bank_details_completed
      ) VALUES (
<<<<<<< HEAD
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
=======
        $1, $2, $3, $4, $5, 
        $6, $7, $8, $9, 
        $10, $11, 
        $12, $13, $14, 
        $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24
>>>>>>> 39e0febc973c2f52a7150cc786f4c0456c1c3847
      )
    `;
    
    const safeDate = (dateStr) => (dateStr && dateStr.trim() !== '') ? dateStr : null;

    const detailsValues = [
      newUser.id, tenant_id, phone_number, address, safeDate(dob), visa_status,
      role, safeDate(start_date), invoice_num, contract_type || 'W2',
      parseFloat(pay_rate || 0), parseFloat(invoice_rate || 0),
      c2c_name, c2c_email, c2c_phone,
      vendor_name, vendor_email, vendor_address, vendor_for, safeDate(project_start_date), net_terms,
      i9_completed || false, w4_completed || false, everify_completed || false, bank_details_completed || false
    ];

    await db.query(detailsQuery, detailsValues);
    await db.query('COMMIT');
    res.status(201).json({ success: true, data: newUser });

  } catch (err) {
    await db.query('ROLLBACK');
    console.error("Backend Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to create employee." });
  }
});
module.exports = router;