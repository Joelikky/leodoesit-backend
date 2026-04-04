const express = require('express');
const router = express.Router();
const db = require('../db');

// 1. GET: Fetch all employees with ALL their details
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT 
        u.id, u.first_name, u.last_name, u.email, u.is_active,
        e.phone_number, e.address, TO_CHAR(e.dob, 'YYYY-MM-DD') as dob, e.visa_status,
        e.role, TO_CHAR(e.start_date, 'YYYY-MM-DD') as start_date, e.invoice_num, e.contract_type,
        e.pay_rate, e.invoice_rate,
        e.c2c_name, e.c2c_email, e.c2c_phone,
        e.vendor_name, e.vendor_email, e.vendor_address, e.vendor_for, 
        TO_CHAR(e.project_start_date, 'YYYY-MM-DD') as project_start_date, e.net_terms
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

// 2. POST: Admin creates a complete new employee
router.post('/', async (req, res) => {
  const {
    first_name, last_name, email,
    phone_number, address, dob, visa_status,
    role, start_date, invoice_num, contract_type,
    pay_rate, invoice_rate,
    c2c_name, c2c_email, c2c_phone,
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
    await db.query('ROLLBACK'); // If anything fails, undo everything
    console.error("Backend Crash Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to create employee." });
  }
});

// 3. PUT: Admin Edit Route (Upgraded to update ALL details)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    first_name, last_name, email, is_active,
    phone_number, address, dob, visa_status,
    role, start_date, invoice_num, contract_type,
    pay_rate, invoice_rate,
    c2c_name, c2c_email, c2c_phone,
    vendor_name, vendor_email, vendor_address, vendor_for, project_start_date, net_terms
  } = req.body;

  try {
    await db.query('BEGIN'); // Start transaction

    // A. Update the Core User info
    const updateUsersQuery = `
      UPDATE public.users 
      SET first_name = $1, last_name = $2, email = $3, is_active = $4
      WHERE id = $5;
    `;
    await db.query(updateUsersQuery, [first_name, last_name, email, is_active, id]);

    // Helper to handle blank dates safely
    const safeDate = (dateStr) => (dateStr && dateStr.trim() !== '') ? dateStr : null;

    // B. Update the Employee Details table
    const updateDetailsQuery = `
      UPDATE public.employee_details
      SET phone_number = $1, address = $2, dob = $3, visa_status = $4,
          role = $5, start_date = $6, invoice_num = $7, contract_type = $8,
          pay_rate = $9, invoice_rate = $10,
          c2c_name = $11, c2c_email = $12, c2c_phone = $13,
          vendor_name = $14, vendor_email = $15, vendor_address = $16, vendor_for = $17, 
          project_start_date = $18, net_terms = $19
      WHERE user_id = $20;
    `;
    
    const detailsValues = [
      phone_number, address, safeDate(dob), visa_status,
      role, safeDate(start_date), invoice_num, contract_type || 'W2',
      parseFloat(pay_rate || 0), parseFloat(invoice_rate || 0),
      c2c_name, c2c_email, c2c_phone,
      vendor_name, vendor_email, vendor_address, vendor_for, safeDate(project_start_date), net_terms,
      id
    ];

    await db.query(updateDetailsQuery, detailsValues);

    await db.query('COMMIT'); // Lock it all in!
    
    // Fetch the freshly updated row so the frontend updates immediately
    const fetchQuery = `
      SELECT u.id, u.first_name, u.last_name, u.email, u.is_active,
             e.phone_number, e.address, TO_CHAR(e.dob, 'YYYY-MM-DD') as dob, e.visa_status,
             e.role, TO_CHAR(e.start_date, 'YYYY-MM-DD') as start_date, e.invoice_num, e.contract_type,
             e.pay_rate, e.invoice_rate,
             e.c2c_name, e.c2c_email, e.c2c_phone,
             e.vendor_name, e.vendor_email, e.vendor_address, e.vendor_for, 
             TO_CHAR(e.project_start_date, 'YYYY-MM-DD') as project_start_date, e.net_terms
      FROM public.users u
      LEFT JOIN public.employee_details e ON u.id = e.user_id
      WHERE u.id = $1
    `;
    const updatedUser = await db.query(fetchQuery, [id]);

    res.json({ success: true, message: "Employee fully updated!", data: updatedUser.rows[0] });

  } catch (err) {
    await db.query('ROLLBACK');
    console.error("Backend Crash Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to update employee." });
  }
});

module.exports = router;