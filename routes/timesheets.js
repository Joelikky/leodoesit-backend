const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');

// --- MULTER LUGGAGE HANDLER SETUP ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Save files to our new folder
  },
  filename: function (req, file, cb) {
    // Give every file a unique name so they don't overwrite each other!
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });
// ------------------------------------

// 1. GET ROUTE: Fetch ALL timesheets (For the Admin Queue)
router.get('/', async (req, res) => {
  const { status } = req.query; 

  try {
    let query = `
      SELECT t.id, t.period_start, t.period_end, t.total_hours, t.status, t.screenshot_urls,
             u.first_name, u.last_name, u.default_hourly_rate
      FROM timesheets t
      JOIN users u ON t.user_id = u.id
    `;
    let values = [];

    if (status) {
      query += ` WHERE t.status = $1`;
      values.push(status);
    }

    query += ` ORDER BY t.created_at DESC;`;

    const result = await db.query(query, values);
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: "Failed to fetch timesheets" });
  }
});

// 2. GET ROUTE: Fetch timesheets ONLY for the logged-in contractor (For the Employee Portal)
router.get('/me/:email', async (req, res) => {
  const { email } = req.params;
  try {
    const query = `
      SELECT t.*, u.first_name, u.last_name 
      FROM timesheets t
      JOIN users u ON t.user_id = u.id
      WHERE u.email = $1
      ORDER BY t.created_at DESC
      LIMIT 1; -- We only care about their most recent submission!
    `;
    const result = await db.query(query, [email]);
    res.json({ success: true, data: result.rows[0] || null });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: "Failed to fetch your timesheet." });
  }
});

// 3. POST ROUTE: Submit a new timesheet WITH screenshots
router.post('/', upload.array('screenshots', 5), async (req, res) => {
  const { user_id, period_start, period_end, total_hours } = req.body;
  
  try {
    // Map the uploaded files to their new public URLs on your server
    const screenshot_urls = req.files ? req.files.map(file => `http://localhost:5000/uploads/${file.filename}`) : [];

    const query = `
      INSERT INTO timesheets (user_id, period_start, period_end, total_hours, status, screenshot_urls)
      VALUES ($1, $2, $3, $4, 'SUBMITTED', $5)
      RETURNING *;
    `;
    const values = [user_id, period_start, period_end, total_hours, screenshot_urls];
    const result = await db.query(query, values);
    
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Upload Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to submit timesheet." });
  }
});

// 4. PUT ROUTE: Approve a timesheet
router.put('/:id/approve', async (req, res) => {
  const { id } = req.params; 

  try {
    const updateQuery = `
      UPDATE timesheets 
      SET status = 'APPROVED' 
      WHERE id = $1 
      RETURNING *;
    `;
    const result = await db.query(updateQuery, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Timesheet not found" });
    }

    res.json({ success: true, message: "Timesheet officially approved!", data: result.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: "Failed to approve timesheet." });
  }
});

// 5. PUT ROUTE: Reject a timesheet (Unlocks the employee's portal!)
router.put('/:id/reject', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      "UPDATE timesheets SET status = 'REJECTED' WHERE id = $1 RETURNING *", 
      [id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: "Failed to reject timesheet." });
  }
});

module.exports = router;