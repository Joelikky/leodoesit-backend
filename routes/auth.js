const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken'); // 👈 1. Import jsonwebtoken

// POST: Universal Login - Automatically detects tenant by email!
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Search the entire database for this email and instantly find their company
    // Added LOWER() to ensure case-insensitive logins (e.g. Ashok@... vs ashok@...)
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
      WHERE LOWER(u.email) = LOWER($1) AND u.is_active = true;
    `;
    
    const result = await db.query(loginQuery, [email.trim()]);
    
    // 2. If no user is found across ANY company
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: "Account not found or inactive." });
    }

    const user = result.rows[0];

    // 3. Check the password
    // ⚠️ SECURITY NOTE: For production, NEVER compare passwords with '==='. 
    // You should use bcrypt here: const isMatch = await bcrypt.compare(password, user.password);
    if (user.password !== password) {
      return res.status(401).json({ success: false, error: "Incorrect password." });
    }

    // 4. Security: Delete the password from the memory object!
    delete user.password;

    // 5. 🔑 Generate a real JWT Token
    // Falls back to a string default if you haven't added JWT_SECRET to your Vercel Env variables yet
    const jwtSecret = process.env.JWT_SECRET || 'fallback_secret_for_local_dev';
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        tenant_id: user.tenant_id,
        role: user.employee_role || user.role 
      }, 
      jwtSecret, 
      { expiresIn: '24h' } // Token lasts 24 hours
    );

    // 6. 🔥 CRITICAL FIX: Format the response to exactly match what React expects
    res.json({ 
      success: true, 
      message: "Login successful!", 
      token: token, // 👈 Fixed: Swapped the broken placeholder for the real token
      data: {
        id: user.id,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
        role: user.employee_role || user.role, // Fallback in case role is still in the users table
        tenant_id: user.tenant_id,
        tenant_name: user.tenant_name, // Sends 'Gandiva Insights' or 'Leodoes IT' directly to React
        tenant_prefix: user.tenant_prefix,
        pay_rate: user.pay_rate,
        invoice_rate: user.invoice_rate
      }
    });
    
  } catch (err) {
    console.error("Backend Crash Error:", err); 
    // 🔥 CRITICAL FIX: Changed 'message' to 'error' so React's alert(result.error) works
    res.status(500).json({ success: false, error: "Server error during login. Please try again." }); 
  }
});

module.exports = router;