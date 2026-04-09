const express = require('express');
const router = express.Router();
const db = require('../db');

// POST: Universal Login - Automatically detects tenant by email!
router.post('/login', async (req, res) => {
  // 1. We no longer need 'portal' from the frontend!
  const { email, password } = req.body;

  try {
    // 2. Search the entire database for this email and instantly find their company
    const loginQuery = `
      SELECT u.*, 
             COALESCE(e.pay_rate, 0) AS pay_rate, 
             COALESCE(e.invoice_rate, 0) AS invoice_rate, 
             e.role AS employee_role, 
             e.employment_status,
             t.id AS tenant_id,
             t.domain_prefix AS tenant_prefix,
             t.name AS tenant_name
      FROM users u
      LEFT JOIN employee_details e ON u.id = e.user_id
      JOIN tenants t ON u.tenant_id = t.id
      WHERE u.email = $1 AND u.is_active = true;
    `;
    
    const result = await db.query(loginQuery, [email]);
    
    // 3. If no user is found across ANY company
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: "Account not found or inactive." });
    }

    const user = result.rows[0];

    // 4. Check the password
    if (user.password !== password) {
      return res.status(401).json({ success: false, error: "Incorrect password." });
    }

    // 5. Security: Delete the password from the memory object!
    delete user.password;

    // Notice we don't need to manually attach tenant info anymore because 
    // the SQL JOIN already grabbed tenant_prefix and tenant_name for us!

    res.json({ success: true, message: "Login successful!", data: user });
    
  } catch (err) {
    console.error("Backend Crash Error:", err); 
    res.status(500).json({ success: false, message: "Server error during login." }); 
  }
});

module.exports = router;