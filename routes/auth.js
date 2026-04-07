const express = require('express');
const router = express.Router();
const db = require('../db');

// POST: Verify user credentials for a specific tenant
router.post('/login', async (req, res) => {
  // 1. We now capture the 'portal' choice sent from the React dropdown
  const { email, password, portal } = req.body;

  try {
    // 2. Look up the specific company they are trying to log into
    const tenantResult = await db.query('SELECT id, name, domain_prefix FROM tenants WHERE domain_prefix = $1', [portal]);
    
    if (tenantResult.rows.length === 0) {
        return res.status(400).json({ success: false, error: "Invalid portal selected." });
    }
    const tenant = tenantResult.rows[0];

    // 3. Find the user inside THIS SPECIFIC company only (using tenant_id)
    const loginQuery = `
      SELECT u.*, 
             COALESCE(e.pay_rate, 0) AS pay_rate, 
             COALESCE(e.invoice_rate, 0) AS invoice_rate, 
             e.role AS employee_role, 
             e.employment_status
      FROM users u
      LEFT JOIN employee_details e ON u.id = e.user_id
      WHERE u.email = $1 AND u.tenant_id = $2 AND u.is_active = true;
    `;
    
    const result = await db.query(loginQuery, [email, tenant.id]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: `Account not found in the ${tenant.name} portal.` });
    }

    const user = result.rows[0];

    // 4. Check the password
    if (user.password !== password) {
      return res.status(401).json({ success: false, error: "Incorrect password." });
    }

    // 5. Security: Delete the password from the memory object!
    delete user.password;

    // 6. Attach the company details to the user so the frontend knows who is active
    user.tenant_id = tenant.id;
    user.tenant_prefix = tenant.domain_prefix;
    user.tenant_name = tenant.name;

    res.json({ success: true, message: "Login successful!", data: user });
    
  } catch (err) {
    console.error("Backend Crash Error:", err); 
    res.status(500).json({ success: false, message: "Server error during login." }); 
  }
});

module.exports = router;
