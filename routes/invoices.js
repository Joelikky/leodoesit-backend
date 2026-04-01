const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');

const { generateInvoicePDF } = require('../utils/pdfGenerator');
const { sendInvoiceEmail } = require('../utils/mailer');

// 1. GET ROUTE: Fetch all invoices
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT 
        i.id, 
        i.invoice_number, 
        i.status, 
        i.due_date, 
        c.company_name AS client_name,
        u.first_name, 
        u.last_name,
        COALESCE(i.amount_invoiced, (i.hours_billed * i.hourly_rate_applied)) AS amount_invoiced
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      LEFT JOIN timesheets t ON i.timesheet_id = t.id
      LEFT JOIN users u ON t.user_id = u.id
      ORDER BY i.due_date DESC; 
    `;
    const result = await db.query(query);
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (err) {
    console.error("Backend Crash Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch invoices" });
  }
});

// 2. POST ROUTE: Generate a new invoice & PDF
router.post('/', async (req, res) => {
  const { client_id, timesheet_id } = req.body;

  try {
    // 🔥 THE FIX IS HERE: We explicitly ask the database for u.billing_rate!
    const mathQuery = `
      SELECT t.total_hours, t.period_start, t.period_end, 
             u.id AS user_id, u.first_name, u.last_name, u.billing_rate,
             c.company_name AS client_name
      FROM timesheets t
      JOIN users u ON t.user_id = u.id
      JOIN clients c ON c.id = $1
      WHERE t.id = $2;
    `;
    const mathResult = await db.query(mathQuery, [client_id, timesheet_id]);
    
    if (mathResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Timesheet not found" });
    }

    const data = mathResult.rows[0];
    
    // 🔥 THE SECOND FIX: The Safety Check!
    if (!data.billing_rate) {
        return res.status(400).json({ success: false, error: "Contractor is missing a billing_rate in the database." });
    }

    const hours =parseFloat(data.total_hours);
    const rate = parseFloat(data.billing_rate);
    const invoiceNumber = `INV-${Math.floor(Date.now() / 1000)}`;

    // Generate the PDF
    const pdfFileName = `Invoice_TS_${timesheet_id}.pdf`;
    const pdfPath = path.join(__dirname, '..', 'invoices', pdfFileName); 

    await generateInvoicePDF({
        billingPeriod: `${new Date(data.period_start).toLocaleDateString()} to ${new Date(data.period_end).toLocaleDateString()}`,
        clientName: data.client_name,
        contractorName: `${data.first_name} ${data.last_name}`,
        hours: hours,
        billingRate: rate
    }, pdfPath);

    // Save to Database
// Save to Database (Letting Supabase calculate the total automatically!)
const insertQuery = `
INSERT INTO invoices (client_id, timesheet_id, invoice_number, hours_billed, hourly_rate_applied, status, due_date)
VALUES ($1, $2, $3, $4, $5, 'UNPAID', CURRENT_DATE + INTERVAL '30 days')
RETURNING *;
`;
const insertResult = await db.query(insertQuery, [client_id, timesheet_id, invoiceNumber, hours, rate]);
    
    const updateTimesheetQuery = `
      UPDATE timesheets
      SET status = 'INVOICED'
      WHERE id = $1;
    `;
    await db.query(updateTimesheetQuery, [timesheet_id]);

    res.status(201).json({ success: true, message: "Invoice saved successfully!", data: insertResult.rows[0] });
  } catch (err) {
    console.error(err.message);
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

// 5. POST ROUTE: Trigger the Mailer Utility
router.post('/:id/send', async (req, res) => {
  const invoiceId = req.params.id;

  try {
      // THE FIX: We added "c.billing_email" and joined the clients table!
      const query = `
          SELECT i.timesheet_id, u.first_name, u.last_name, t.period_start, c.billing_email
          FROM invoices i
          JOIN timesheets t ON i.timesheet_id = t.id
          JOIN users u ON t.user_id = u.id
          JOIN clients c ON i.client_id = c.id
          WHERE i.id = $1
      `;
      const result = await db.query(query, [invoiceId]);

      if (result.rowCount === 0) return res.status(404).json({ success: false, error: "Invoice not found." });

      const data = result.rows[0];
      
      // THE FIX: Now we use the client's actual email!
      const clientEmail = data.billing_email; 

      if (!clientEmail) {
          return res.status(400).json({ success: false, error: "This client does not have a billing email." });
      }

      const pdfPath = path.join(__dirname, '..', 'invoices', `Invoice_TS_${data.timesheet_id}.pdf`);
      const monthName = new Date(data.period_start).toLocaleString('default', { month: 'long' });
      const contractorFullName = `${data.first_name} ${data.last_name}`;

      const emailSent = await sendInvoiceEmail(clientEmail, contractorFullName, monthName, pdfPath);

      if (emailSent) {
          res.json({ success: true, message: `Email sent to ${clientEmail}!` });
      } else {
          res.status(500).json({ success: false, error: "Failed to send email via NodeMailer." });
      }
  } catch (error) {
      console.error("Error sending email:", error);
      res.status(500).json({ success: false, error: "Server error while sending email." });
  }
});

module.exports = router;