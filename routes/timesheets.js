const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');

// IMPORT THE SECURED OCR RUNTIME ENGINE
const { extractHoursFromAttachment } = require('../utils/ocrEngine');

// IMPORTED EMAILS INCLUDING THE REMINDER
const { sendRejectionEmail, sendTimesheetSubmissionEmail, sendTimesheetApprovalEmail, sendTimesheetReminder } = require('../utils/mailer');

// Import our S3 tools
const { uploadTimesheetToS3, generateSignedUrl } = require('../utils/s3Service');

// Memory Storage holds the file in RAM instead of saving to disk!
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper function to validate UUIDv4 format before querying Postgres
const isValidUUID = (id) => {
  if (!id || id === 'undefined' || id === 'null') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
};

// 1. GET ROUTE: Fetch ALL timesheets (For the Admin Queue & Hub)
router.get('/', async (req, res) => {
  const { status } = req.query; 
  const tenantId = req.headers['x-tenant-id']; 

  // 🛡️ GUARDRAIL: Prevent Postgres UUID compilation errors
  if (!isValidUUID(tenantId)) {
    return res.status(400).json({ 
      success: false, 
      error: "Malformed or missing 'x-tenant-id' header. Expected a valid UUID." 
    });
  }

  try {
    let query = `
      SELECT t.id, t.period_start, t.period_end, t.total_hours, t.status, t.screenshot_urls, t.user_id,
             t.ocr_hours, t.ocr_mismatch,
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

    // Convert secure S3 keys into temporary viewing URLs for the frontend
    for (let ts of timesheets) {
        if (ts.screenshot_urls && ts.screenshot_urls.length > 0) {
            ts.screenshot_urls = await Promise.all(ts.screenshot_urls.map(async (key) => {
                if (key.startsWith('http')) return key; // Keeps old localhost tests working
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
  
  if (!email || email === 'undefined') {
    return res.status(400).json({ success: false, error: "Email parameter is required." });
  }

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

    // Convert secure S3 keys into temporary viewing URLs for the frontend
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

// 3. POST ROUTE: Submit a new timesheet WITH smart automated document OCR scanning
router.post('/', upload.array('screenshots', 5), async (req, res) => {
  const { user_id, period_start, period_end, total_hours } = req.body;
  const clientProvidedHours = parseFloat(total_hours || 0);
  
  // 🛡️ GUARDRAIL: Verify user_id is a valid UUID string
  if (!isValidUUID(user_id)) {
    return res.status(400).json({ success: false, error: "Invalid or missing user_id payload." });
  }
  
  try {
    let detectedOcrHours = null;
    let ocrMismatch = false;

    // AUTOMATED EXTRACTION STEP: Process raw file buffer right here out of RAM memory storage
    if (req.files && req.files.length > 0) {
      const primaryFile = req.files[0]; 
      
      console.log(`[OCR Processing Initialized] Scanning primary file attachment: ${primaryFile.originalname}`);
      detectedOcrHours = await extractHoursFromAttachment(primaryFile.buffer, primaryFile.mimetype);
      
      if (detectedOcrHours !== null) {
        console.log(`[OCR Match Complete] Successfully extracted hours value: ${detectedOcrHours}`);
        // Cross-examine contractor payload form data with parsed file insights
        if (Math.abs(clientProvidedHours - detectedOcrHours) > 0.01) {
          ocrMismatch = true;
          console.warn(`[OCR Discrepancy Found] User typed ${clientProvidedHours} but document reveals ${detectedOcrHours}`);
          
          // =========================================================================
          // 🧠 OPTION A: STRICT MODE REJECTION (UNCOMMENT IF YOU WANT TO BLOCK SUBMISSION)
          // =========================================================================
          // return res.status(400).json({
          //   success: false,
          //   error: `Verification Discrepancy! You entered ${clientProvidedHours} hours, but your uploaded timesheet document contains ${detectedOcrHours} hours. Please check your file and try again.`
          // });
        }
      } else {
        console.log(`[OCR Info] Could not isolate structural timeline keywords inside uploaded file layout template.`);
      }
    }

    const screenshot_keys = [];

    // Upload each image directly to AWS S3 from RAM
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

    // Capture ocr_hours metrics inside the database transaction logs explicitly
    const query = `
      INSERT INTO timesheets (user_id, period_start, period_end, total_hours, status, screenshot_urls, ocr_hours, ocr_mismatch)
      VALUES ($1, $2, $3, $4, 'SUBMITTED', $5, $6, $7)
      RETURNING *;
    `;
    const values = [user_id, period_start, period_end, clientProvidedHours, screenshot_keys, detectedOcrHours, ocrMismatch];
    const result = await db.query(query, values);
    
    const userQuery = await db.query(`
        SELECT u.first_name, u.last_name, u.email, ten.domain_prefix 
        FROM users u
        JOIN tenants ten ON u.tenant_id = ten.id
        WHERE u.id = $1
    `, [user_id]);
    
    if (userQuery.rowCount > 0) {
        const user = userQuery.rows[0];
        const contractorName = `${user.first_name} ${user.last_name}`;
        
        const startDate = new Date(period_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const endDate = new Date(period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const billingPeriod = `${startDate} - ${endDate}`;
        
        const isGandiva = user.domain_prefix === 'gandiva';
        const adminEmail = isGandiva ? process.env.GANDIVA_EMAIL : (process.env.ADMIN_NOTIFY_EMAIL || process.env.EMAIL_USER);

        await sendTimesheetSubmissionEmail(user.domain_prefix, user.email, adminEmail, contractorName, billingPeriod, clientProvidedHours);
    }

    // 🔥 OPTION B: RETURN WARNING ON SUCCESS (Lets submission go through but warns user)
    res.status(201).json({ 
      success: true, 
      ocrMismatchDetected: ocrMismatch,
      extractedOcrHours: detectedOcrHours,
      data: blockDataCorrection(result.rows[0]) 
    });

  } catch (err) {
    console.error("Upload Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to submit timesheet." });
  }
});

// 4. PUT ROUTE: Approve a timesheet
router.put('/:id/approve', async (req, res) => {
  const { id } = req.params; 

  if (!isValidUUID(id)) {
    return res.status(400).json({ success: false, error: "Invalid Timesheet UUID parameter." });
  }

  try {
    console.log(`🚀 CHECKPOINT 1: Route /approve hit for ID: ${id}`);
    const updateQuery = `UPDATE timesheets SET status = 'APPROVED' WHERE id = $1 RETURNING *;`;
    const result = await db.query(updateQuery, [id]);
    
    if (result.rowCount === 0) {
        console.log("❌ CHECKPOINT 1.5: Timesheet not found in DB!");
        return res.status(404).json({ success: false, error: "Timesheet not found" });
    }
    
    const timesheet = result.rows[0];

    const userQuery = await db.query(`
        SELECT u.first_name, u.last_name, u.email, ten.domain_prefix 
        FROM users u
        JOIN tenants ten ON u.tenant_id = ten.id
        WHERE u.id = $1
    `, [timesheet.user_id]);
    
    if (userQuery.rowCount > 0) {
        console.log(`👤 CHECKPOINT 2: User found! Email is ${userQuery.rows[0].email}`);
        const user = userQuery.rows[0];
        const contractorName = `${user.first_name} ${user.last_name}`;
        const startDate = new Date(timesheet.period_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const endDate = new Date(timesheet.period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const billingPeriod = `${startDate} - ${endDate}`;

        console.log("📧 CHECKPOINT 3: Attempting to send Nodemailer email...");
        await sendTimesheetApprovalEmail(user.domain_prefix, user.email, contractorName, billingPeriod, timesheet.total_hours);
        console.log("✅ CHECKPOINT 4: Nodemailer finished processing without crashing!");
    } else {
        console.log("⚠️ CHECKPOINT 2.5: WARNING! User query returned 0 rows. Skipping email.");
    }

    res.json({ success: true, message: "Timesheet officially approved!", data: blockDataCorrection(timesheet) });
  } catch (err) {
    console.error("🔥 FATAL ERROR IN APPROVE ROUTE:", err.message);
    res.status(500).json({ success: false, error: "Failed to approve timesheet." });
  }
});

// 5. PUT: Reject a timesheet and send email
router.put('/:id/reject', async (req, res) => {
  const { id } = req.params;
  const { rejection_reason } = req.body; 

  if (!isValidUUID(id)) return res.status(400).json({ success: false, error: "Invalid Timesheet UUID parameter." });
  if (!rejection_reason) return res.status(400).json({ success: false, error: "A rejection reason is required." });

  try {
    const updateQuery = `UPDATE timesheets SET status = 'REJECTED', rejection_reason = $1 WHERE id = $2 RETURNING *;`;
    const result = await db.query(updateQuery, [rejection_reason, id]);

    if (result.rowCount === 0) return res.status(404).json({ success: false, error: "Timesheet not found" });

    const timesheet = result.rows[0];
    
    const userQuery = await db.query(`
        SELECT u.first_name, u.last_name, u.email, ten.domain_prefix 
        FROM users u
        JOIN tenants ten ON u.tenant_id = ten.id
        WHERE u.id = $1
    `, [timesheet.user_id]);
    const user = userQuery.rows[0];

    const billingPeriod = `${new Date(timesheet.period_start).toLocaleDateString()} - ${new Date(timesheet.period_end).toLocaleDateString()}`;
    const contractorName = `${user.first_name} ${user.last_name}`;
    
    await sendRejectionEmail(user.domain_prefix, user.email, contractorName, billingPeriod, rejection_reason);

    res.json({ success: true, message: "Timesheet rejected and email sent!", data: blockDataCorrection(timesheet) });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: "Failed to reject timesheet." });
  }
});

// 6. PUT ROUTE: Void a timesheet (Send back to Approval Queue)
router.put('/:id/void', async (req, res) => {
  const { id } = req.params;

  if (!isValidUUID(id)) return res.status(400).json({ success: false, error: "Invalid Timesheet UUID parameter." });

  try {
    const updateQuery = `UPDATE timesheets SET status = 'SUBMITTED' WHERE id = $1 RETURNING *;`;
    const result = await db.query(updateQuery, [id]);
    
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: "Timesheet not found" });
    
    res.json({ success: true, message: "Timesheet voided back to the approval queue!", data: blockDataCorrection(result.rows[0]) });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: "Failed to void timesheet." });
  }
});

// 7. Master Status Updater
router.put('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, admin_notes } = req.body;
  const tenant_id = req.headers['x-tenant-id'];

  if (!isValidUUID(id)) return res.status(400).json({ success: false, error: "Invalid Timesheet UUID path parameter." });
  if (!isValidUUID(tenant_id)) return res.status(400).json({ success: false, error: "Missing or invalid tenant context layout header." });

  try {
    console.log(`🚀 CHECKPOINT 1: Route /status hit. ID: ${id}, Status: ${status}, Tenant: ${tenant_id}`);
    const result = await db.query(
      `UPDATE timesheets 
       SET status = $1, rejection_reason = $2, updated_at = NOW() 
       WHERE id = $3 AND user_id IN (SELECT id FROM users WHERE tenant_id = $4) 
       RETURNING *`,
      [status, admin_notes, id, tenant_id]
    );

    if (result.rows.length === 0) {
      console.log("❌ CHECKPOINT 1.5: Update failed. No rows affected. (Check tenant_id mismatch!)");
      return res.status(404).json({ success: false, error: 'Timesheet not found or unauthorized' });
    }

    const timesheet = result.rows[0];

    const userQuery = await db.query(`
        SELECT u.first_name, u.last_name, u.email, ten.domain_prefix 
        FROM users u
        JOIN tenants ten ON u.tenant_id = ten.id
        WHERE u.id = $1
    `, [timesheet.user_id]);

    if (userQuery.rowCount > 0) {
        console.log(`👤 CHECKPOINT 2: User found! Email is ${userQuery.rows[0].email}`);
        const user = userQuery.rows[0];
        const contractorName = `${user.first_name} ${user.last_name}`;
        const startDate = new Date(timesheet.period_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const endDate = new Date(timesheet.period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const billingPeriod = `${startDate} - ${endDate}`;

        if (status === 'APPROVED') {
            console.log("📧 CHECKPOINT 3: Attempting Approval Email...");
            await sendTimesheetApprovalEmail(user.domain_prefix, user.email, contractorName, billingPeriod, timesheet.total_hours);
            console.log("✅ CHECKPOINT 4: Nodemailer finished!");
        } else if (status === 'REJECTED') {
            console.log("📧 CHECKPOINT 3: Attempting Rejection Email...");
            await sendRejectionEmail(user.domain_prefix, user.email, contractorName, billingPeriod, admin_notes);
            console.log("✅ CHECKPOINT 4: Nodemailer finished!");
        }
    } else {
        console.log("⚠️ CHECKPOINT 2.5: WARNING! User query returned 0 rows. Skipping email.");
    }

    res.json({ success: true, data: blockDataCorrection(timesheet) });
  } catch (err) {
    console.error("🔥 FATAL ERROR IN STATUS ROUTE:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Manual Reminder Trigger
router.post('/remind', async (req, res) => {
    const { email, first_name, month } = req.body;
    const tenant_id = req.headers['x-tenant-id'];

    if (!isValidUUID(tenant_id)) {
        return res.status(400).json({ success: false, error: "Missing or invalid multi-tenant header context." });
    }

    try {
        const tenantResult = await db.query('SELECT domain_prefix FROM tenants WHERE id = $1', [tenant_id]);
        const domainPrefix = tenantResult.rows.length > 0 ? tenantResult.rows[0].domain_prefix : 'leodoesit';

        await sendTimesheetReminder(domainPrefix, email, first_name, month);
        
        res.json({ success: true, message: 'Manual reminder sent!' });
    } catch (err) {
        console.error('Error sending manual timesheet reminder:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Internal utility placeholder to sanitize runtime responses safely
function blockDataCorrection(row) {
  if (!row) return row;
  return row;
}

module.exports = router;