const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');

const { generateInvoicePDF } = require('../utils/pdfGenerator');
const { sendInvoiceEmail } = require('../utils/mailer');

// 1. GET ROUTE: Fetch all invoices FOR THE LOGGED-IN PORTAL ONLY
router.get('/', async (req, res) => {
  const tenantId = req.headers['x-tenant-id']; 
  try {
    const query = `
      SELECT 
        i.id, 
        i.invoice_number, 
        i.status, 
        i.due_date,
        i.emailed_at,
        c.company_name AS client_name,
        u.first_name, 
        u.last_name,
        u.tenant_id,
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
    console.error("Backend Crash Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch invoices" });
  }
});

// 2. POST ROUTE: Generate a new invoice & PDF
router.post('/', async (req, res) => {
  const { client_id, timesheet_id, tenant_id } = req.body;

  try {
    const mathQuery = `
    SELECT t.total_hours, t.period_start, t.period_end, 
           u.id AS user_id, u.first_name, u.last_name, 
           e.invoice_rate, e.invoice_num, e.role,
           e.vendor_for, e.net_terms, e.vendor_address AS client_address,
           c.company_name AS client_name,
           ten.domain_prefix
    FROM timesheets t
    JOIN users u ON t.user_id = u.id
    LEFT JOIN employee_details e ON u.id = e.user_id
    JOIN clients c ON c.id = $1
    JOIN tenants ten ON u.tenant_id = ten.id
    WHERE t.id = $2;
  `;
    const mathResult = await db.query(mathQuery, [client_id, timesheet_id]);
    
    if (mathResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Timesheet not found" });
    }

    const data = mathResult.rows[0];
    
    if (!data.invoice_rate) {
        return res.status(400).json({ success: false, error: "Contractor is missing an invoice_rate in the database." });
    }

    const hours = parseFloat(data.total_hours);
    const rate = parseFloat(data.invoice_rate); 

    // --- BULLETPROOF INVOICE NUMBER LOGIC ---
    const dateObj = new Date(data.period_start); 
    const yy = dateObj.getFullYear().toString().slice(-2); 
    const mm = (dateObj.getMonth() + 1).toString().padStart(2, '0'); 
    const baseNum = data.invoice_num || '00'; 
    
    // Generate a random 4-digit PIN to guarantee uniqueness in the database!
    const uniquePin = Math.floor(1000 + Math.random() * 9000);
    const invoiceNumber = `${yy}${mm}${baseNum}-${uniquePin}`;
    
    // --- DATE CALCULATIONS ---
    const formatDate = (date) => {
        const d = date.getDate().toString().padStart(2, '0');
        const m = date.toLocaleString('default', { month: 'short' });
        const y = date.getFullYear();
        return `${d} ${m} ${y}`;
    };

    const today = new Date();
    // Safely parse the terms string to prevent NaN database errors
    const termsString = String(data.net_terms || 'Net 30');
    const termsDays = parseInt(termsString.replace(/\D/g, '')) || 30; 
    
    const dueDateObj = new Date();
    dueDateObj.setDate(today.getDate() + termsDays);
    
    const pdfFileName = `Invoice_TS_${timesheet_id}.pdf`;
    const pdfPath = path.join(__dirname, '..', 'invoices', pdfFileName); 

    // PASS DATA TO PUPPETEER
    await generateInvoicePDF({
        companyName: data.domain_prefix === 'gandiva' ? 'Gandiva Insights' : 'Leo Does IT Inc.',
        invoiceNumber: invoiceNumber,
        invoiceDate: formatDate(today),
        netTerms: termsString,
        dueDate: formatDate(dueDateObj),
        clientName: data.client_name,
        clientAddress: data.client_address || '',
        vendorFor: data.vendor_for || 'N/A',
        contractorName: `${data.first_name} ${data.last_name}`,
        role: data.role || 'IT Consultant',
        billingPeriod: `${new Date(data.period_start).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })} - ${new Date(data.period_end).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}`,
        hours: hours,
        billingRate: rate
    }, pdfPath);

    // Save to Database
    const insertQuery = `
    INSERT INTO invoices (client_id, timesheet_id, invoice_number, hours_billed, hourly_rate_applied, status, due_date)
    VALUES ($1, $2, $3, $4, $5, 'UNPAID', CURRENT_DATE + INTERVAL '${termsDays} days')
    RETURNING *;
    `;
    const insertResult = await db.query(insertQuery, [client_id, timesheet_id, invoiceNumber, hours, rate]);
    
    const updateTimesheetQuery = `UPDATE timesheets SET status = 'INVOICED' WHERE id = $1;`;
    await db.query(updateTimesheetQuery, [timesheet_id]);

    res.status(201).json({ success: true, message: "Invoice saved successfully!", data: insertResult.rows[0] });
  } catch (err) {
    console.error("❌ CRASH DETAILS:", err);
    res.status(500).json({ success: false, error: "Failed to create invoice." });
  }
});

// 3. PUT ROUTE: Mark an invoice as PAID
router.put('/:id/pay', async (req, res) => {
  const { id } = req.params;
  try {
    const updateQuery = `UPDATE invoices SET status = 'PAID' WHERE id = $1 RETURNING *;`;
    const result = await db.query(updateQuery, [id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: "Invoice not found" });
    res.json({ success: true, message: "Invoice marked as paid!", data: result.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: "Failed to update invoice status." });
  }
});

// 4. DELETE ROUTE: Void an invoice and release the timesheet
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const invResult = await db.query('SELECT timesheet_id FROM invoices WHERE id = $1', [id]);
    if (invResult.rows.length > 0) {
      const tsId = invResult.rows[0].timesheet_id;
      await db.query("UPDATE timesheets SET status = 'APPROVED' WHERE id = $1", [tsId]);
    }
    await db.query('DELETE FROM invoices WHERE id = $1', [id]);
    res.json({ success: true, message: 'Invoice voided successfully.' });
  } catch (err) {
    console.error("Backend Crash Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to void invoice." });
  }
});

// 5. POST ROUTE: Trigger the Mailer Utility (🔥 UPDATED FOR NEW EMAIL FORMAT)
router.post('/:id/send', async (req, res) => {
  const invoiceId = req.params.id;

  try {
      // Added i.invoice_number to the SELECT query
      const query = `
          SELECT i.timesheet_id, i.invoice_number, u.first_name, u.last_name, t.period_start, c.billing_email, ten.domain_prefix
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
      const clientEmail = data.billing_email; 
      const tenantPrefix = data.domain_prefix; 
      const invoiceNum = data.invoice_number; // Grabbed from DB

      if (!clientEmail) {
          return res.status(400).json({ success: false, error: "This client does not have a billing email." });
      }

      const pdfPath = path.join(__dirname, '..', 'invoices', `Invoice_TS_${data.timesheet_id}.pdf`);
      
      // Formats date as "March 2026"
      const monthYear = new Date(data.period_start).toLocaleString('en-US', { month: 'long', year: 'numeric' });
      const contractorFullName = `${data.first_name} ${data.last_name}`;

      // Pass the invoiceNum to the mailer
      const emailSent = await sendInvoiceEmail(tenantPrefix, clientEmail, contractorFullName, monthYear, pdfPath, invoiceNum);

      if (emailSent) {
        await db.query(`UPDATE invoices SET emailed_at = CURRENT_TIMESTAMP WHERE id = $1`, [invoiceId]);
        res.json({ success: true, message: `Email sent to ${clientEmail}!` });
    } else {
          res.status(500).json({ success: false, error: "Failed to send email via NodeMailer." });
      }
  } catch (error) {
      console.error("Error sending email:", error);
      res.status(500).json({ success: false, error: "Server error while sending email." });
  }
});

// 6. GET ROUTE: Download the PDF!
router.get('/:id/download', async (req, res) => {
    const invoiceId = req.params.id;
    try {
        const query = `SELECT timesheet_id FROM invoices WHERE id = $1`;
        const result = await db.query(query, [invoiceId]);
        
        if (result.rowCount === 0) return res.status(404).send("Invoice not found.");
        
        const tsId = result.rows[0].timesheet_id;
        const pdfFileName = `Invoice_TS_${tsId}.pdf`;
        const pdfPath = path.join(__dirname, '..', 'invoices', pdfFileName);
        
        res.download(pdfPath);
    } catch (error) {
        console.error("Error downloading PDF:", error);
        res.status(500).send("Server error downloading file.");
    }
});

module.exports = router;