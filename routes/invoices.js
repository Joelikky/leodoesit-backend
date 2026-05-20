const express = require('express');
const router = express.Router();
const db = require('../db');

// IMPORTED generateSignedUrl from s3Service
const { generateInvoiceBuffer } = require('../utils/pdfGenerator');
const { uploadInvoiceToS3, generateSignedUrl } = require('../utils/s3Service');
const { sendInvoiceEmail, sendBalanceReminderEmail } = require('../utils/mailer');

// 1. GET ROUTE: Fetch all invoices FOR THE LOGGED-IN PORTAL ONLY
router.get('/', async (req, res) => {
  const tenantId = req.headers['x-tenant-id']; 
  try {
    const query = `
      SELECT 
        i.id, i.invoice_number, i.status, i.due_date, i.emailed_at, i.file_url,
        COALESCE(i.amount_paid, 0) AS amount_paid,
        c.company_name AS client_name,
        u.first_name, u.last_name, u.tenant_id,
        COALESCE(i.amount_invoiced, (i.hours_billed * i.hourly_rate_applied)) AS amount_invoiced
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      LEFT JOIN timesheets t ON i.timesheet_id = t.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE u.tenant_id = $1
      ORDER BY i.due_date DESC; 
    `;
    const result = await db.query(query, [tenantId]);
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch invoices" });
  }
});

// 2. POST ROUTE: Generate a new invoice & PDF (FIXED: Populates amount_invoiced)
router.post('/', async (req, res) => {
  const { client_id, timesheet_id, tenant_id } = req.body;

  try {
    const mathQuery = `
    SELECT t.total_hours, t.period_start, t.period_end, 
           u.id AS user_id, u.first_name, u.last_name, 
           e.invoice_rate, e.invoice_num, e.role,
           e.vendor_for, e.net_terms, e.vendor_address AS client_address,
           c.company_name AS client_name, ten.domain_prefix
    FROM timesheets t
    JOIN users u ON t.user_id = u.id
    LEFT JOIN employee_details e ON u.id = e.user_id
    JOIN clients c ON c.id = $1
    JOIN tenants ten ON u.tenant_id = ten.id
    WHERE t.id = $2;
  `;
    const mathResult = await db.query(mathQuery, [client_id, timesheet_id]);
    if (mathResult.rowCount === 0) return res.status(404).json({ success: false, error: "Timesheet not found" });

    const data = mathResult.rows[0];
    if (!data.invoice_rate) return res.status(400).json({ success: false, error: "Missing invoice_rate." });

    const hours = parseFloat(data.total_hours);
    const rate = parseFloat(data.invoice_rate); 
    const finalAmountInvoiced = hours * rate; // Calculated invoice total

    const dateObj = new Date(data.period_start); 
    const yy = dateObj.getFullYear().toString().slice(-2); 
    const mm = (dateObj.getMonth() + 1).toString().padStart(2, '0'); 
    const baseNum = data.invoice_num || '00'; 
    const uniquePin = Math.floor(1000 + Math.random() * 9000);
    const invoiceNumber = `${yy}${mm}${baseNum}-${uniquePin}`;
    
    const formatDate = (date) => {
        const d = date.getDate().toString().padStart(2, '0');
        const m = date.toLocaleString('default', { month: 'short' });
        const y = date.getFullYear();
        return `${d} ${m} ${y}`;
    };

    const today = new Date();
    const termsString = String(data.net_terms || 'Net 30');
    const termsDays = parseInt(termsString.replace(/\D/g, '')) || 30; 
    const dueDateObj = new Date();
    dueDateObj.setDate(today.getDate() + termsDays);
    
    const invoiceDate = new Date(data.period_start);
    const monthName = invoiceDate.toLocaleString('en-US', { month: 'long' }).toLowerCase();
    const year = invoiceDate.getFullYear();
    
    const cleanEmployeeName = `${data.first_name}_${data.last_name}`.replace(/\s+/g, '_').toLowerCase();
    const cleanClientName = data.client_name.replace(/\s+/g, '_').toLowerCase();

    const pdfFileName = `${cleanEmployeeName}_${monthName}_${year}_${cleanClientName}_invoice.pdf`;

    const pdfBuffer = await generateInvoiceBuffer({
        companyName: data.domain_prefix === 'gandiva' ? 'Gandiva Insights' : 'Leo Does IT Inc.',
        invoiceNumber: invoiceNumber, invoiceDate: formatDate(today), netTerms: termsString,
        dueDate: formatDate(dueDateObj), clientName: data.client_name, clientAddress: data.client_address || '',
        vendorFor: data.vendor_for || 'N/A', contractorName: `${data.first_name} ${data.last_name}`,
        role: data.role || 'IT Consultant', hours: hours, billingRate: rate,
        billingPeriod: `${new Date(data.period_start).toLocaleDateString('en-US')} - ${new Date(data.period_end).toLocaleDateString('en-US')}`
    });

    const s3Url = await uploadInvoiceToS3(pdfBuffer, pdfFileName);

    if (!s3Url) {
        return res.status(500).json({ success: false, error: "Failed to upload PDF to AWS S3." });
    }

    // FIXED: Formatted to include amount_invoiced column parameters
    const insertQuery = `
    INSERT INTO invoices (client_id, timesheet_id, invoice_number, hours_billed, hourly_rate_applied, amount_invoiced, status, due_date, amount_paid, file_url)
    VALUES ($1, $2, $3, $4, $5, $6, 'UNPAID', CURRENT_DATE + INTERVAL '${termsDays} days', 0, $7)
    RETURNING *;
    `;
    const insertResult = await db.query(insertQuery, [client_id, timesheet_id, invoiceNumber, hours, rate, finalAmountInvoiced, s3Url]);
    await db.query(`UPDATE timesheets SET status = 'INVOICED' WHERE id = $1;`, [timesheet_id]);

    res.status(201).json({ success: true, message: "Invoice saved and uploaded!", data: insertResult.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to create invoice." });
  }
});

// 3. PUT ROUTE: CRASH-PROOF PAYMENT HANDLING
router.put('/:id/pay', async (req, res) => {
  const { id } = req.params;
  const { payment_amount } = req.body; 
  
  try {
    const invResult = await db.query(`
      SELECT 
        COALESCE(amount_invoiced, (hours_billed * hourly_rate_applied)) AS total_invoiced, 
        COALESCE(amount_paid, 0) as current_paid 
      FROM invoices WHERE id = $1
    `, [id]);

    if (invResult.rowCount === 0) return res.status(404).json({ success: false, error: "Invoice not found" });

    const totalInvoiced = parseFloat(invResult.rows[0].total_invoiced || 0);
    const currentPaid = parseFloat(invResult.rows[0].current_paid || 0);
    
    let addedPayment = 0;
    if (payment_amount !== undefined && payment_amount !== null && payment_amount !== '') {
        addedPayment = parseFloat(payment_amount);
    } else {
        addedPayment = totalInvoiced - currentPaid;
    }

    const newTotalPaid = currentPaid + addedPayment;

    let newStatus = 'UNPAID';
    if (newTotalPaid >= totalInvoiced) {
        newStatus = 'PAID';
    } else if (newTotalPaid > 0) {
        newStatus = 'PARTIAL';
    }

    const updateQuery = `UPDATE invoices SET status = $1, amount_paid = $2 WHERE id = $3 RETURNING *;`;
    const result = await db.query(updateQuery, [newStatus, newTotalPaid, id]);
    
    res.json({ success: true, message: `Payment updated! Status is now ${newStatus}`, data: result.rows[0] });
  } catch (err) {
    console.error("Payment Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. PUT ROUTE: VOID INVOICE
router.put('/:id/void', async (req, res) => {
  const { id } = req.params;
  try {
    const invResult = await db.query('SELECT timesheet_id FROM invoices WHERE id = $1', [id]);
    if (invResult.rows.length > 0) {
      await db.query("UPDATE timesheets SET status = 'APPROVED' WHERE id = $1", [invResult.rows[0].timesheet_id]);
    }
    
    const updateQuery = `UPDATE invoices SET status = 'VOID' WHERE id = $1 RETURNING *;`;
    const updated = await db.query(updateQuery, [id]);
    
    res.json({ success: true, message: 'Invoice voided successfully.', data: updated.rows[0] });
  } catch (err) {
    console.error("Void Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. POST ROUTE: Trigger the Mailer Utility
router.post('/:id/send', async (req, res) => {
  const invoiceId = req.params.id;
  try {
      const query = `
          SELECT i.timesheet_id, i.invoice_number, i.file_url, u.first_name, u.last_name, t.period_start, c.billing_email, ten.domain_prefix
          FROM invoices i
          JOIN timesheets t ON i.timesheet_id = t.id
          JOIN users u ON t.user_id = u.id
          JOIN clients c ON i.client_id = c.id
          JOIN tenants ten ON u.tenant_id = ten.id
          WHERE i.id = $1
      `;
      const result = await db.query(query, [invoiceId]);
      if (result.rowCount === 0) return res.status(404).json({ success: false, error: "Invoice not found." });

      const data = result.rows[0];
      
      if (!data.billing_email) {
          return res.status(400).json({ success: false, error: "The client attached to this invoice has no billing email address saved." });
      }

      let fileKey = data.file_url;
      if (fileKey && fileKey.startsWith('http')) {
          const splitParts = fileKey.split('.amazonaws.com/');
          if (splitParts.length > 1) {
              fileKey = splitParts[1];
          }
      }

      const secureUrlForEmail = await generateSignedUrl(fileKey);
      const monthYear = new Date(data.period_start).toLocaleString('en-US', { month: 'long', year: 'numeric' });
      
      const emailSent = await sendInvoiceEmail(data.domain_prefix, data.billing_email, `${data.first_name} ${data.last_name}`, monthYear, secureUrlForEmail, data.invoice_number);

      if (emailSent) {
        await db.query(`UPDATE invoices SET emailed_at = CURRENT_TIMESTAMP WHERE id = $1`, [invoiceId]);
        res.json({ success: true, message: `Email sent!` });
      } else {
        res.status(500).json({ success: false, error: "Email rejected. Check your backend terminal for details." });
      }
  } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, error: "Server error." });
  }
});

// 6. POST ROUTE: Send Partial Balance Reminder
router.post('/:id/remind', async (req, res) => {
    const invoiceId = req.params.id;
    try {
        const query = `
            SELECT i.invoice_number, i.amount_paid, u.first_name, u.last_name, c.billing_email, ten.domain_prefix,
            COALESCE(i.amount_invoiced, (i.hours_billed * i.hourly_rate_applied)) AS total
            FROM invoices i
            JOIN timesheets t ON i.timesheet_id = t.id
            JOIN users u ON t.user_id = u.id
            JOIN clients c ON i.client_id = c.id
            JOIN tenants ten ON u.tenant_id = ten.id
            WHERE i.id = $1
        `;
        const result = await db.query(query, [invoiceId]);
        if (result.rowCount === 0) return res.status(404).json({ success: false, error: "Invoice not found." });
  
        const data = result.rows[0];
        const balanceDue = parseFloat(data.total) - parseFloat(data.amount_paid);
        
        if (balanceDue <= 0) return res.status(400).json({ success: false, error: "This invoice is already fully paid!" });

        if (!data.billing_email) {
            return res.status(400).json({ success: false, error: "The client attached to this invoice has no billing email address saved." });
        }
  
        const emailSent = await sendBalanceReminderEmail(data.domain_prefix, data.billing_email, `${data.first_name} ${data.last_name}`, data.invoice_number, balanceDue);
  
        if (emailSent) {
          res.json({ success: true, message: `Reminder sent to ${data.billing_email}!` });
        } else {
          res.status(500).json({ success: false, error: "Zoho rejected the email. Check your backend terminal (where nodemon is running) to see the exact error." });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: "Server error." });
    }
  });

// 7. GET ROUTE: Securely Download/View the PDF via Signed URL
router.get('/:id/download', async (req, res) => {
    const invoiceId = req.params.id;
    try {
        const query = `SELECT file_url FROM invoices WHERE id = $1`;
        const result = await db.query(query, [invoiceId]);
        
        let fileKey = result.rows[0]?.file_url;
        
        if (!fileKey) {
            return res.status(404).send("Invoice file not found.");
        }

        if (fileKey.startsWith('http')) {
            const splitParts = fileKey.split('.amazonaws.com/');
            if (splitParts.length > 1) {
                fileKey = splitParts[1];
            }
        }

        const secureUrl = await generateSignedUrl(fileKey);

        if (!secureUrl) {
            return res.status(500).send("Server error generating secure link.");
        }

        res.redirect(secureUrl);

    } catch (error) {
        console.error("Download Error:", error);
        res.status(500).send("Server error redirecting to file.");
    }
});

module.exports = router;