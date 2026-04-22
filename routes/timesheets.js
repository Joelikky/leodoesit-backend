const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const { sendRejectionEmail } = require('../utils/mailer');

// 🔥 NEW: Import our S3 tools
const { uploadTimesheetToS3, generateSignedUrl } = require('../utils/s3Service');

// 🔥 CHANGED: Memory Storage holds the file in RAM instead of saving to disk!
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// 1. GET ROUTE: Fetch ALL timesheets (For the Admin Queue & Hub)
router.get('/', async (req, res) => {
  const { status } = req.query; 
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
    let timesheets = result.rows;

    // 🔥 NEW: Convert secure S3 keys into temporary viewing URLs for the frontend
    for (let ts of timesheets) {
        if (ts.screenshot_urls && ts.screenshot_urls.length > 0) {
            ts.screenshot_urls = await Promise.all(ts.screenshot_urls.map(async (key) => {
                if (key.startsWith('http')) return key; // Keeps your old localhost tests working
                return await generateSignedUrl(key);
            }));
        }
    }

    res.json({ success: true, count: timesheets.length, data: timesheets });
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
      ORDER BY t.created_at DESC;
    `;
    const result = await db.query(query, [email]);
    let timesheets = result.rows;

    // 🔥 NEW: Convert secure S3 keys into temporary viewing URLs for the frontend
    for (let ts of timesheets) {
        if (ts.screenshot_urls && ts.screenshot_urls.length > 0) {
            ts.screenshot_urls = await Promise.all(ts.screenshot_urls.map(async (key) => {
                if (key.startsWith('http')) return key;
                return await generateSignedUrl(key);
            }));
        }
    }

    res.json({ success: true, data: timesheets }); 
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: "Failed to fetch your timesheets." });
  }
});

// 3. POST ROUTE: Submit a new timesheet WITH screenshots
router.post('/', upload.array('screenshots', 5), async (req, res) => {
  const { user_id, period_start, period_end, total_hours } = req.body;
  
  try {
    const screenshot_keys = [];

    // 🔥 CHANGED: Upload each image directly to AWS S3 from RAM
    if (req.files && req.files.length > 0) {
        for (const file of req.files) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const fileName = `${uniqueSuffix}${path.extname(file.originalname)}`;
            
            const s3Key = await uploadTimesheetToS3(file.buffer, fileName, file.mimetype);
            if (s3Key) {
                screenshot_keys.push(s3Key);
            }
        }
    }

    const query = `
      INSERT INTO timesheets (user_id, period_start, period_end, total_hours, status, screenshot_urls)
      VALUES ($1, $2, $3, $4, 'SUBMITTED', $5)
      RETURNING *;
    `;
    const values = [user_id, period_start, period_end, total_hours, screenshot_keys];
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