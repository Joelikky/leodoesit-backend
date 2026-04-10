const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');

const { generateInvoicePDF } = require('../utils/pdfGenerator');
const { sendInvoiceEmail, sendBalanceReminderEmail } = require('../utils/mailer');

// 1. GET ROUTE: Fetch all invoices FOR THE LOGGED-IN PORTAL ONLY
router.get('/', async (req, res) => {
  const tenantId = req.headers['x-tenant-id']; 
  try {
    const query = `
      SELECT 
        i.id, i.invoice_number, i.status, i.due_date, i.emailed_at,
        COALESCE(i.amount_paid, 0) AS amount_paid, -- NEW FIELD
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

// 2. POST ROUTE: Generate a new invoice & PDF
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
    
    const pdfFileName = `Invoice_TS_${timesheet_id}.pdf`;
    const pdfPath = path.join(__dirname, '..', 'invoices', pdfFileName); 

    await generateInvoicePDF({
        companyName: data.domain_prefix === 'gandiva' ? 'Gandiva Insights' : 'Leo Does IT Inc.',
        invoiceNumber: invoiceNumber, invoiceDate: formatDate(today), netTerms: termsString,
        dueDate: formatDate(dueDateObj), clientName: data.client_name, clientAddress: data.client_address || '',
        vendorFor: data.vendor_for || 'N/A', contractorName: `${data.first_name} ${data.last_name}`,
        role: data.role || 'IT Consultant', hours: hours, billingRate: rate,
        billingPeriod: `${new Date(data.period_start).toLocaleDateString('en-US')} - ${new Date(data.period_end).toLocaleDateString('en-US')}`
    }, pdfPath);

    const insertQuery = `
    INSERT INTO invoices (client_id, timesheet_id, invoice_number, hours_billed, hourly_rate_applied, status, due_date, amount_paid)
    VALUES ($1, $2, $3, $4, $5, 'UNPAID', CURRENT_DATE + INTERVAL '${termsDays} days', 0)
    RETURNING *;
    `;
    const insertResult = await db.query(insertQuery, [client_id, timesheet_id, invoiceNumber, hours, rate]);
    await db.query(`UPDATE timesheets SET status = 'INVOICED' WHERE id = $1;`, [timesheet_id]);

    res.status(201).json({ success: true, message: "Invoice saved!", data: insertResult.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to create invoice." });
  }
});

// 3. PUT ROUTE: Handles Full & Partial Payments!
router.put('/:id/pay', async (req, res) => {
  const { id } = req.params;
  const { payment_amount } = req.body; // How much the user typed in the frontend box!
  
  try {
    // Get the current invoice details
    const invResult = await db.query(`SELECT COALESCE(amount_invoiced, (hours_billed * hourly_rate_applied)) AS total, COALESCE(amount_paid, 0) as paid FROM invoices WHERE id = $1`, [id]);
    if (invResult.rowCount === 0) return res.status(404).json({ success: false, error: "Invoice not found" });

    const totalInvoiced = parseFloat(invResult.rows[0].total);
    const currentPaid = parseFloat(invResult.rows[0].paid);
    
    // Calculate the new total paid amount
    const newlyAddedPayment = parseFloat(payment_amount || totalInvoiced); // If they didn't type a partial amount, assume full payment
    const newTotalPaid = currentPaid + newlyAddedPayment;

    // Smart Status Logic
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
    res.status(500).json({ success: false, error: "Failed to update payment." });
  }
});

// 4. DELETE ROUTE: Void an invoice
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const invResult = await db.query('SELECT timesheet_id FROM invoices WHERE id = $1', [id]);
    if (invResult.rows.length > 0) {
      await db.query("UPDATE timesheets SET status = 'APPROVED' WHERE id = $1", [invResult.rows[0].timesheet_id]);
    }
    await db.query('DELETE FROM invoices WHERE id = $1', [id]);
    res.json({ success: true, message: 'Invoice voided successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to void invoice." });
  }
});

// 5. POST ROUTE: Trigger the Mailer Utility (Original Invoice PDF)
router.post('/:id/send', async (req, res) => {
  const invoiceId = req.params.id;
  try {
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
      if (!data.billing_email) return res.status(400).json({ success: false, error: "No billing email found." });

      const pdfPath = path.join(__dirname, '..', 'invoices', `Invoice_TS_${data.timesheet_id}.pdf`);
      const monthYear = new Date(data.period_start).toLocaleString('en-US', { month: 'long', year: 'numeric' });
      
      const emailSent = await sendInvoiceEmail(data.domain_prefix, data.billing_email, `${data.first_name} ${data.last_name}`, monthYear, pdfPath, data.invoice_number);

      if (emailSent) {
        await db.query(`UPDATE invoices SET emailed_at = CURRENT_TIMESTAMP WHERE id = $1`, [invoiceId]);
        res.json({ success: true, message: `Email sent!` });
      } else {
        res.status(500).json({ success: false, error: "Failed to send email." });
      }
  } catch (error) {
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
  
        const emailSent = await sendBalanceReminderEmail(data.domain_prefix, data.billing_email, `${data.first_name} ${data.last_name}`, data.invoice_number, balanceDue);
  
        if (emailSent) {
          res.json({ success: true, message: `Reminder sent to ${data.billing_email}!` });
        } else {
          res.status(500).json({ success: false, error: "Failed to send reminder email." });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: "Server error." });
    }
  });

// 7. GET ROUTE: Download the PDF
router.get('/:id/download', async (req, res) => {
    const invoiceId = req.params.id;
    try {
        const query = `SELECT timesheet_id FROM invoices WHERE id = $1`;
        const result = await db.query(query, [invoiceId]);
        if (result.rowCount === 0) return res.status(404).send("Invoice not found.");
        res.download(path.join(__dirname, '..', 'invoices', `Invoice_TS_${result.rows[0].timesheet_id}.pdf`));
    } catch (error) {
        res.status(500).send("Server error downloading file.");
    }
});

module.exports = router;