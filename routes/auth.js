// const express = require('express');
// const router = express.Router();
// const db = require('../db');

// // POST: Verify user credentials
// router.post('/login', async (req, res) => {
//   const { email, password } = req.body;

//   try {
//     // 1. Find the user by email (and make sure their account is active!)
//     const result = await db.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
    
//     if (result.rows.length === 0) {
//       return res.status(401).json({ success: false, error: "Invalid email or inactive account." });
//     }

//     const user = result.rows[0];

//     // 2. Check the password
//     if (user.password !== password) {
//       return res.status(401).json({ success: false, error: "Incorrect password." });
//     }

//     // 3. Security: Delete the password from the memory object before sending it to React!
//     delete user.password;

//     // 4. Give them the VIP pass
//     res.json({ success: true, message: "Login successful!", data: user });
    
//   } catch (err) {
//     console.error("Backend Crash Error:", err.message);
//     res.status(500).json({ success: false, error: "Server error during login." });
//   }
// });

// module.exports = router;



const express = require('express');
const router = express.Router();
const db = require('../db');

// POST: Verify user credentials
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Find the user AND their employee details using a JOIN
    // FIX: Aliased e.role to employee_role to prevent overwriting the system u.role

    const loginQuery = `
    SELECT u.*, 
           COALESCE(e.pay_rate, 0) AS pay_rate, 
           COALESCE(e.invoice_rate, 0) AS invoice_rate, 
           e.role AS employee_role, 
           e.employment_status
    FROM users u
    LEFT JOIN employee_details e ON u.id = e.user_id
    WHERE u.email = $1 AND u.is_active = true;
  `;
    
    const result = await db.query(loginQuery, [email]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: "Invalid email or inactive account." });
    }

    const user = result.rows[0];

    // 2. Check the password
    if (user.password !== password) {
      return res.status(401).json({ success: false, error: "Incorrect password." });
    }

    // 3. Security: Delete the password from the memory object before sending it to React!
    delete user.password;

    // 4. Give them the VIP pass with their pay rate included!
    res.json({ success: true, message: "Login successful!", data: user });
    
  } catch (err) {
    console.error("Backend Crash Error:", err.message);
    res.status(500).json({ success: false, error: "Server error during login." });
  }
});

module.exports = router;