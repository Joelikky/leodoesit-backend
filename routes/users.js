const express = require('express');
const router = express.Router();
const db = require('../db');

// 1. GET: Fetch employees ONLY for the active portal
router.get('/', async (req, res) => {
  const tenantId = req.headers['x-tenant-id']; 

  if (!tenantId) {
    return res.status(400).json({ success: false, error: "Tenant ID is required." });
  }

  try {
    const query = `
      SELECT 
        u.id, u.first_name, u.last_name, u.email, u.is_active, u.tenant_id, 
        COALESCE(u.is_deleted, false) AS is_deleted, -- 🔥 NEW: Fetch the archive status
        e.phone_number, e.address, TO_CHAR(e.dob, 'YYYY-MM-DD') as dob, e.visa_status,
        e.role, TO_CHAR(e.start_date, 'YYYY-MM-DD') as start_date, e.invoice_num, e.contract_type,
        e.pay_rate, e.invoice_rate,
        e.c2c_name, e.c2c_email, e.c2c_phone,
        e.vendor_name, e.vendor_email, e.vendor_address, e.vendor_for, 
        TO_CHAR(e.project_start_date, 'YYYY-MM-DD') as project_start_date, e.net_terms,
        e.i9_completed, e.w4_completed, e.everify_completed, e.bank_details_completed
      FROM public.users u
      LEFT JOIN public.employee_details e ON u.id = e.user_id
      WHERE u.tenant_id = $1
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
    tenant_id, 
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
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 
        $21, $22, $23, $24, $25
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

// 3. PUT: Update an existing employee
router.put('/:id', async (req, res) => {
  const userId = req.params.id;
  const {
    first_name, last_name, email, is_active,
    phone_number, address, dob, visa_status,
    role, start_date, invoice_num, contract_type,
    pay_rate, invoice_rate,
    c2c_name, c2c_email, c2c_phone,
    vendor_name, vendor_email, vendor_address, 
    vendor_for, project_start_date, net_terms, 
    i9_completed, w4_completed, everify_completed, bank_details_completed
  } = req.body;

  try {
    await db.query('BEGIN');

    // 1. Update the core user table
    const userQuery = `
      UPDATE public.users 
      SET first_name = $1, last_name = $2, email = $3, is_active = $4
      WHERE id = $5;
    `;
    await db.query(userQuery, [first_name, last_name, email, is_active, userId]);

    // 2. Update the employee details table
    const detailsQuery = `
      UPDATE public.employee_details 
      SET 
        phone_number = $1, address = $2, dob = $3, visa_status = $4,
        role = $5, start_date = $6, invoice_num = $7, contract_type = $8,
        pay_rate = $9, invoice_rate = $10,
        c2c_name = $11, c2c_email = $12, c2c_phone = $13,
        vendor_name = $14, vendor_email = $15, vendor_address = $16,
        vendor_for = $17, project_start_date = $18, net_terms = $19,
        i9_completed = $20, w4_completed = $21, everify_completed = $22, bank_details_completed = $23
      WHERE user_id = $24
    `;

    // Helper to safely format empty dates
    const safeDate = (dateStr) => (dateStr && dateStr.trim() !== '') ? dateStr : null;

    const detailsValues = [
      phone_number, address, safeDate(dob), visa_status,
      role, safeDate(start_date), invoice_num, contract_type || 'W2',
      parseFloat(pay_rate || 0), parseFloat(invoice_rate || 0),
      c2c_name, c2c_email, c2c_phone,
      vendor_name, vendor_email, vendor_address, 
      vendor_for, safeDate(project_start_date), net_terms, 
      i9_completed || false, w4_completed || false, everify_completed || false, bank_details_completed || false,
      userId
    ];

    await db.query(detailsQuery, detailsValues);
    await db.query('COMMIT');
    
    // 3. Fetch the fresh data to send back to React so the UI updates instantly
    const updatedUserQuery = `
      SELECT u.id, u.first_name, u.last_name, u.email, u.is_active, u.tenant_id, COALESCE(u.is_deleted, false) AS is_deleted,
             e.* FROM public.users u
      LEFT JOIN public.employee_details e ON u.id = e.user_id
      WHERE u.id = $1
    `;
    const updatedResult = await db.query(updatedUserQuery, [userId]);

    res.json({ success: true, data: updatedResult.rows[0] });

  } catch (err) {
    await db.query('ROLLBACK');
    console.error("Update Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to update employee." });
  }
});

// 4. DELETE: SOFT DELETE (Move to Archive/Trash)
router.delete('/:id', async (req, res) => {
  const userId = req.params.id;
  try {
    // We only update the flag to hide them, we don't delete the row!
    await db.query('UPDATE public.users SET is_deleted = true WHERE id = $1', [userId]);
    res.json({ success: true, message: "Employee safely archived." });
  } catch (err) {
    console.error("Archive Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to archive employee." });
  }
});

// 5. PUT: RESTORE FROM TRASH
router.put('/:id/restore', async (req, res) => {
  const userId = req.params.id;
  try {
    // Un-hide them!
    await db.query('UPDATE public.users SET is_deleted = false WHERE id = $1', [userId]);
    res.json({ success: true, message: "Employee restored successfully!" });
  } catch (err) {
    console.error("Restore Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to restore employee." });
  }
});

// 6. DELETE: PERMANENTLY DESTROY (Only allowed from the Trash UI)
router.delete('/:id/permanent', async (req, res) => {
  const userId = req.params.id;

  try {
    await db.query('BEGIN');
    
    // First delete their HR details, then delete their core login account
    await db.query('DELETE FROM public.employee_details WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM public.users WHERE id = $1', [userId]);
    
    await db.query('COMMIT');
    res.json({ success: true, message: "Employee permanently deleted." });

  } catch (err) {
    await db.query('ROLLBACK');
    
    // SAFETY NET: If Postgres throws a "Foreign Key Violation" (code 23503)
    if (err.code === '23503') {
       return res.status(400).json({ 
         success: false, 
         error: "Cannot permanently delete this employee because they already have linked timesheets or invoices in the system." 
       });
    }
    
    console.error("Permanent Delete Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to permanently delete employee." });
  }
});

module.exports = router;