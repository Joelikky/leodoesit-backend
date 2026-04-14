const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const { sendRejectionEmail } = require('../utils/mailer');

// --- MULTER LUGGAGE HANDLER SETUP ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });
// ------------------------------------

// 1. GET ROUTE: Fetch ALL timesheets (For the Admin Queue & Hub)
router.get('/', async (req, res) => {
  const { status } = req.query; 
  // 🔥 FIX 1: Grab the tenant ID so we don't leak data!
  const tenantId = req.headers['x-tenant-id']; 

  try {
    let query = `
      SELECT t.id, t.period_start, t.period_end, t.total_hours, t.status, t.screenshot_urls,
             u.first_name, u.last_name, u.tenant_id, e.pay_rate, e.invoice_rate, e.vendor_name
      FROM timesheets t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN employee_details e ON u.id = e.user_id
      WHERE u.tenant_id = $1
    `;
    let values = [tenantId];

    if (status) {
      query += ` AND t.status = $2`;
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

// 2. GET ROUTE: Fetch timesheets ONLY for the logged-in contractor
router.get('/me/:email', async (req, res) => {
  const { email } = req.params;
  try {
    const query = `
      SELECT t.*, u.first_name, u.last_name 
      FROM timesheets t
      JOIN users u ON t.user_id = u.id
      WHERE u.email = $1
      ORDER BY t.created_at DESC
      LIMIT 1;
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
    const updateQuery = `UPDATE timesheets SET status = 'APPROVED' WHERE id = $1 RETURNING *;`;
    const result = await db.query(updateQuery, [id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: "Timesheet not found" });
    res.json({ success: true, message: "Timesheet officially approved!", data: result.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: "Failed to approve timesheet." });
  }
});

// 5. PUT: Reject a timesheet and send email
router.put('/:id/reject', async (req, res) => {
  const { id } = req.params;
  const { rejection_reason } = req.body; 

  if (!rejection_reason) return res.status(400).json({ success: false, error: "A rejection reason is required." });

  try {
    const updateQuery = `UPDATE timesheets SET status = 'REJECTED', rejection_reason = $1 WHERE id = $2 RETURNING *;`;
    const result = await db.query(updateQuery, [rejection_reason, id]);

    if (result.rowCount === 0) return res.status(404).json({ success: false, error: "Timesheet not found" });

    const timesheet = result.rows[0];
    const userQuery = await db.query('SELECT first_name, last_name, email FROM users WHERE id = $1', [timesheet.user_id]);
    const user = userQuery.rows[0];

    const billingPeriod = `${new Date(timesheet.period_start).toLocaleDateString()} - ${new Date(timesheet.period_end).toLocaleDateString()}`;
    const contractorName = `${user.first_name} ${user.last_name}`;
    
    await sendRejectionEmail(user.email, contractorName, billingPeriod, rejection_reason);

    res.json({ success: true, message: "Timesheet rejected and email sent!", data: timesheet });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: "Failed to reject timesheet." });
  }
});

// 6. PUT ROUTE: Void a timesheet (Send back to Approval Queue)
router.put('/:id/void', async (req, res) => {
  const { id } = req.params;
  try {
    const updateQuery = `UPDATE timesheets SET status = 'SUBMITTED' WHERE id = $1 RETURNING *;`;
    const result = await db.query(updateQuery, [id]);
    
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: "Timesheet not found" });
    
    res.json({ success: true, message: "Timesheet voided back to the approval queue!", data: result.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: "Failed to void timesheet." });
  }
});

module.exports = router;