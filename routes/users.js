const express = require('express');
const router = express.Router();
const db = require('../db');

// 1. GET: Fetch all employees with their financial details joined together!
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT u.id, u.first_name, u.last_name, u.email, u.is_active,
             e.role, e.pay_rate, e.invoice_rate, e.employment_status, e.contract_type
      FROM public.users u
      LEFT JOIN public.employee_details e ON u.id = e.user_id
      ORDER BY u.first_name ASC
    `;
    const result = await db.query(query);
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (err) {
    console.error("Error fetching users:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch employees" });
  }
});

// 2. POST: Admin creates a complete new employee (The "World-Class" Transaction)
router.post('/', async (req, res) => {
  const {
    // Core User
    first_name, last_name, email,
    // Personal Info
    phone_number, address, dob, visa_status,
    // Work Details
    role, start_date, invoice_num, contract_type,
    // Financials
    pay_rate, invoice_rate,
    // C2C Specifics
    c2c_name, c2c_email, c2c_phone,
    // Vendor Details
    vendor_name, vendor_email, vendor_address, vendor_for, project_start_date, net_terms
  } = req.body;

  try {
    await db.query('BEGIN'); // Start transaction!

    // A. Create the core user login
    const userQuery = `
      INSERT INTO public.users (first_name, last_name, email)
      VALUES ($1, $2, $3)
      RETURNING id, first_name, last_name, email, is_active;
    `;
    const userResult = await db.query(userQuery, [first_name, last_name, email]);
    const newUser = userResult.rows[0];

    // B. Save all the HR & Financial data linked to that new user
    const detailsQuery = `
      INSERT INTO public.employee_details (
        user_id, phone_number, address, dob, visa_status,
        role, start_date, invoice_num, contract_type,
        pay_rate, invoice_rate,
        c2c_name, c2c_email, c2c_phone,
        vendor_name, vendor_email, vendor_address, vendor_for, project_start_date, net_terms
      ) VALUES (
        $1, $2, $3, $4, $5, 
        $6, $7, $8, $9, 
        $10, $11, 
        $12, $13, $14, 
        $15, $16, $17, $18, $19, $20
      )
    `;
    
    // Map empty string dates to null so PostgreSQL doesn't crash on blank dates
    const safeDate = (dateStr) => (dateStr && dateStr.trim() !== '') ? dateStr : null;

    const detailsValues = [
      newUser.id, phone_number, address, safeDate(dob), visa_status,
      role, safeDate(start_date), invoice_num, contract_type || 'W2',
      parseFloat(pay_rate || 0), parseFloat(invoice_rate || 0),
      c2c_name, c2c_email, c2c_phone,
      vendor_name, vendor_email, vendor_address, vendor_for, safeDate(project_start_date), net_terms
    ];

    await db.query(detailsQuery, detailsValues);

    await db.query('COMMIT'); // Lock it all in!
    res.status(201).json({ success: true, data: newUser, message: "Employee completely provisioned!" });

  } catch (err) {
    await db.query('ROLLBACK'); // If anything fails, undo everything so we don't get partial data
    console.error("Backend Crash Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to create employee." });
  }
});

// 3. PUT: Basic Admin Edit Route (Toggle Active Status / Basic Info)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { first_name, last_name, email, is_active } = req.body;

  try {
    const updateQuery = `
      UPDATE public.users 
      SET first_name = $1, last_name = $2, email = $3, is_active = $4
      WHERE id = $5 
      RETURNING *;
    `;
    const result = await db.query(updateQuery, [first_name, last_name, email, is_active, id]);

    if (result.rowCount === 0) return res.status(404).json({ success: false, error: "Employee not found" });

    res.json({ success: true, message: "Employee updated!", data: result.rows[0] });
  } catch (err) {
    console.error("Backend Crash Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to update employee." });
  }
});

module.exports = router;