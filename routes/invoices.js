const express = require('express');
const router = express.Router();
const db = require('../db');

// 1. GET ROUTE: Fetch all invoices (CRASH-PROOF VERSION)
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
// 2. POST ROUTE: Generate a new invoice
router.post('/', async (req, res) => {
  const { client_id, timesheet_id } = req.body;

  try {
    const mathQuery = `
      SELECT t.total_hours, u.default_hourly_rate
      FROM timesheets t
      JOIN users u ON t.user_id = u.id
      WHERE t.id = $1;
    `;
    const mathResult = await db.query(mathQuery, [timesheet_id]);
    
    if (mathResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Timesheet not found" });
    }

    const hours = mathResult.rows[0].total_hours;
    const rate = mathResult.rows[0].default_hourly_rate;
    const invoiceNumber = `INV-${Math.floor(Date.now() / 1000)}`;

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
    const updateQuery = `
      UPDATE invoices 
      SET status = 'PAID' 
      WHERE id = $1 
      RETURNING *;
    `;
    const result = await db.query(updateQuery, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Invoice not found" });
    }

    res.json({ success: true, message: "Invoice marked as paid!", data: result.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: "Failed to update invoice status." });
  }
});

// DELETE ROUTE: Void an invoice and release the timesheet
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Find the timesheet attached to this invoice
    const invResult = await db.query('SELECT timesheet_id FROM invoices WHERE id = $1', [id]);
    
    if (invResult.rows.length > 0) {
      const tsId = invResult.rows[0].timesheet_id;
      // 2. Release the timesheet back to the Invoicing Hub!
      await db.query("UPDATE timesheets SET status = 'APPROVED' WHERE id = $1", [tsId]);
    }
    
    // 3. Delete the invoice forever
    await db.query('DELETE FROM invoices WHERE id = $1', [id]);
    
    res.json({ success: true, message: 'Invoice voided successfully.' });
  } catch (err) {
    console.error("Backend Crash Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to void invoice." });
  }
});

module.exports = router;