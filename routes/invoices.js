const express = require('express');
const router = express.Router();
const db = require('../db');

// IMPORTED UTILITIES
const { generateInvoiceBuffer } = require('../utils/pdfGenerator');
const { uploadInvoiceToS3, generateSignedUrl } = require('../utils/s3Service');
const { sendInvoiceEmail, sendBalanceReminderEmail } = require('../utils/mailer');

// ==========================================================================
// 1. GET ROUTE: Fetch all invoices
// ==========================================================================
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
        i.file_url,
        COALESCE(i.amount_paid, 0) AS amount_paid,
        c.company_name AS client_name,
        u.first_name,
        u.last_name,
        u.tenant_id,
        COALESCE(
          i.amount_invoiced,
          (i.hours_billed * i.hourly_rate_applied)
        ) AS amount_invoiced
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      LEFT JOIN timesheets t ON i.timesheet_id = t.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE u.tenant_id = $1
      ORDER BY i.due_date DESC;
    `;

    const result = await db.query(query, [tenantId]);

    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });

  } catch (err) {
    console.error("Fetch Invoices Error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch invoices"
    });
  }
});

// ==========================================================================
// 2. POST ROUTE: Generate Invoice
// ==========================================================================
router.post('/', async (req, res) => {

  const {
    client_id,
    timesheet_id
  } = req.body;

  try {

    const mathQuery = `
      SELECT 
        t.total_hours,
        t.period_start,
        t.period_end,
        u.id AS user_id,
        u.first_name,
        u.last_name,
        e.invoice_rate,
        e.invoice_num,
        e.role,
        e.vendor_for,
        e.net_terms,
        e.vendor_address AS client_address,
        c.company_name AS client_name,
        ten.domain_prefix
      FROM timesheets t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN employee_details e ON u.id = e.user_id
      JOIN clients c ON c.id = $1
      JOIN tenants ten ON u.tenant_id = ten.id
      WHERE t.id = $2;
    `;

    const mathResult = await db.query(mathQuery, [
      client_id,
      timesheet_id
    ]);

    if (mathResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: "No records found."
      });
    }

    const data = mathResult.rows[0];

    if (!data.invoice_rate) {
      return res.status(400).json({
        success: false,
        error: "Missing invoice rate."
      });
    }

    const hours = parseFloat(data.total_hours || 0);
    const rate = parseFloat(data.invoice_rate || 0);

    const dateObj = new Date(data.period_start);

    const yy = dateObj
      .getFullYear()
      .toString()
      .slice(-2);

    const mm = (dateObj.getMonth() + 1)
      .toString()
      .padStart(2, '0');

    const baseNum = data.invoice_num || '00';

    const uniquePin = Math.floor(
      1000 + Math.random() * 9000
    );

    const invoiceNumber =
      `${yy}${mm}${baseNum}-${uniquePin}`;

    const formatDate = (date) => {
      const d = date
        .getDate()
        .toString()
        .padStart(2, '0');

      const m = date.toLocaleString('default', {
        month: 'short'
      });

      const y = date.getFullYear();

      return `${d} ${m} ${y}`;
    };

    const today = new Date();

    const termsString =
      String(data.net_terms || 'Net 30');

    const termsDays =
      parseInt(
        termsString.replace(/\D/g, '')
      ) || 30;

    const dueDateObj = new Date();

    dueDateObj.setDate(
      today.getDate() + termsDays
    );

    const invoiceDate = new Date(
      data.period_start
    );

    const monthName =
      invoiceDate
        .toLocaleString('en-US', {
          month: 'long'
        })
        .toLowerCase();

    const year = invoiceDate.getFullYear();

    const cleanEmployeeName =
      `${data.first_name}_${data.last_name}`
        .replace(/\s+/g, '_')
        .toLowerCase();

    const cleanClientName =
      data.client_name
        .replace(/\s+/g, '_')
        .toLowerCase();

    const pdfFileName =
      `${cleanEmployeeName}_${monthName}_${year}_${cleanClientName}_invoice.pdf`;

    // ======================================================
    // Generate PDF
    // ======================================================

    const pdfBuffer = await generateInvoiceBuffer({
      companyName:
        data.domain_prefix === 'gandiva'
          ? 'Gandiva Insights'
          : 'Leo Does IT Inc.',

      invoiceNumber,

      invoiceDate: formatDate(today),

      netTerms: termsString,

      dueDate: formatDate(dueDateObj),

      clientName: data.client_name,

      clientAddress:
        data.client_address || '',

      vendorFor:
        data.vendor_for || 'N/A',

      contractorName:
        `${data.first_name} ${data.last_name}`,

      role:
        data.role || 'IT Consultant',

      hours,

      billingRate: rate,

      billingPeriod:
        `${new Date(data.period_start).toLocaleDateString('en-US')}
        -
        ${new Date(data.period_end).toLocaleDateString('en-US')}`
    });

    // ======================================================
    // Upload PDF to S3
    // ======================================================

    const s3Url = await uploadInvoiceToS3(
      pdfBuffer,
      pdfFileName
    );

    if (!s3Url) {
      return res.status(500).json({
        success: false,
        error:
          "Failed to upload generated PDF to AWS S3."
      });
    }

    // ======================================================
    // FIXED INSERT QUERY
    // ======================================================

    const insertQuery = `
      INSERT INTO invoices (
        client_id,
        timesheet_id,
        invoice_number,
        hours_billed,
        hourly_rate_applied,
        status,
        due_date,
        amount_paid,
        file_url
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        'UNPAID',
        CURRENT_DATE + INTERVAL '${termsDays} days',
        0,
        $6
      )
      RETURNING *;
    `;

    const insertResult = await db.query(
      insertQuery,
      [
        client_id,
        timesheet_id,
        invoiceNumber,
        hours,
        rate,
        s3Url
      ]
    );

    // ======================================================
    // Update Timesheet
    // ======================================================

    try {

      await db.query(
        `
        UPDATE timesheets
        SET status = 'INVOICED'
        WHERE id = $1;
        `,
        [timesheet_id]
      );

    } catch (timesheetUpdateError) {

      console.error(
        "Timesheet Update Error:",
        timesheetUpdateError.message
      );
    }

    // ======================================================
    // Send Email
    // ======================================================

    try {

      const contractorName =
        `${data.first_name} ${data.last_name}`;

      const isGandiva =
        data.domain_prefix === 'gandiva';

      const adminEmail = isGandiva
        ? process.env.GANDIVA_EMAIL
        : (
            process.env.ADMIN_NOTIFY_EMAIL ||
            process.env.EMAIL_USER
          );

      sendInvoiceEmail(
        data.domain_prefix,
        adminEmail,
        contractorName,
        monthName,
        s3Url,
        invoiceNumber
      ).catch(err =>
        console.error(
          "Invoice Email Error:",
          err
        )
      );

    } catch (emailError) {

      console.error(
        "Email Trigger Error:",
        emailError.message
      );
    }

    // ======================================================
    // SUCCESS RESPONSE
    // ======================================================

    res.status(201).json({
      success: true,
      message: "Invoice created successfully!",
      data: insertResult.rows[0]
    });

  } catch (err) {

    console.error("================================");
    console.error("POST Invoice Error");
    console.error("Message:", err.message);
    console.error("Detail:", err.detail);
    console.error("Table:", err.table);
    console.error("Constraint:", err.constraint);
    console.error("================================");

    res.status(500).json({
      success: false,
      error:
        `Database Transaction Failed: ${err.message}`
    });
  }
});

// ==========================================================================
// EXPORT ROUTER
// ==========================================================================
module.exports = router;