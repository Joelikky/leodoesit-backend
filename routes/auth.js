const express = require('express');
const router = express.Router();
const db = require('../db');

// POST: Verify user credentials
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Find the user by email (and make sure their account is active!)
    const result = await db.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
    
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

    // 4. Give them the VIP pass
    res.json({ success: true, message: "Login successful!", data: user });
    
  } catch (err) {
    console.error("Backend Crash Error:", err.message);
    res.status(500).json({ success: false, error: "Server error during login." });
  }
});

module.exports = router;