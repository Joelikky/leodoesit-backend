const express = require('express');
const router = express.Router();
const db = require('../db');

// UTILITIES
const { generateInvoiceBuffer } = require('../utils/pdfGenerator');

const {
    uploadInvoiceToS3,
    generateSignedUrl
} = require('../utils/s3Service');

const {
    sendInvoiceEmail,
    sendBalanceReminderEmail
} = require('../utils/mailer');

// ==========================================================================
// GET ALL INVOICES (OPTIMIZED CACHE EVILUTION)
// ==========================================================================
router.get('/', async (req, res) => {
    const tenantId = req.headers['x-tenant-id'];

    if (!tenantId) {
        return res.status(400).json({ success: false, error: "Access Denied: Tenant ID is required." });
    }

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

        // 🛠️ FORCE BROWSER AND VERCEL EDGE TO BYPASS CACHE FOR REAL-TIME LEDGER SYNC
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        res.json({
            success: true,
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {
        console.error("Fetch Invoice Error:", err);
        res.status(500).json({
            success: false,
            error: "Failed to fetch invoices"
        });
    }
});

// ==========================================================================
// CREATE INVOICE
// ==========================================================================
router.post('/', async (req, res) => {
    const { client_id, timesheet_id } = req.body;

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
                c.billing_email,
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
            return res.status(404).json({
                success: false,
                error: "No invoice records found."
            });
        }

        const data = mathResult.rows[0];
        const hours = parseFloat(data.total_hours || 0);
        const rate = parseFloat(data.invoice_rate || 0);
        const dateObj = new Date(data.period_start);

        const yy = dateObj.getFullYear().toString().slice(-2);
        const mm = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const uniquePin = Math.floor(1000 + Math.random() * 9000);
        const invoiceNumber = `${yy}${mm}${data.invoice_num || '00'}-${uniquePin}`;

        const today = new Date();
        const termsString = String(data.net_terms || 'Net 30');
        const termsDays = parseInt(termsString.replace(/\D/g, '')) || 30;

        const dueDateObj = new Date();
        dueDateObj.setDate(today.getDate() + termsDays);

        const formatDate = (date) => {
            const d = date.getDate().toString().padStart(2, '0');
            const m = date.toLocaleString('default', { month: 'short' });
            const y = date.getFullYear();
            return `${d} ${m} ${y}`;
        };

        const invoiceDate = new Date(data.period_start);
        const monthName = invoiceDate.toLocaleString('en-US', { month: 'long' }).toLowerCase();
        const year = invoiceDate.getFullYear();

        const cleanEmployeeName = `${data.first_name}_${data.last_name}`.replace(/\s+/g, '_').toLowerCase();
        const cleanClientName = data.client_name.replace(/\s+/g, '_').toLowerCase();
        const pdfFileName = `${cleanEmployeeName}_${monthName}_${year}_${cleanClientName}_invoice.pdf`;

        // Generate PDF Buffer
        const pdfBuffer = await generateInvoiceBuffer({
            companyName: data.domain_prefix === 'gandiva' ? 'Gandiva Insights' : 'Leo Does IT Inc.',
            invoiceNumber,
            invoiceDate: formatDate(today),
            netTerms: termsString,
            dueDate: formatDate(dueDateObj),
            clientName: data.client_name,
            clientAddress: data.client_address || '',
            vendorFor: data.vendor_for || 'N/A',
            contractorName: `${data.first_name} ${data.last_name}`,
            role: data.role || 'Consultant',
            hours,
            billingRate: rate,
            billingPeriod: `${new Date(data.period_start).toLocaleDateString('en-US')} - ${new Date(data.period_end).toLocaleDateString('en-US')}`,
            amountPaid: 0,
            balanceDue: hours * rate
        });

        // S3 Storage Allocation
        const s3Url = await uploadInvoiceToS3(pdfBuffer, pdfFileName);
        if (!s3Url) {
            return res.status(500).json({ success: false, error: "Failed to upload PDF to S3." });
        }

        // Database Write Sync via Atomic Process
        await db.query('BEGIN');

        const insertQuery = `
            INSERT INTO invoices (
                client_id, timesheet_id, invoice_number, hours_billed, 
                hourly_rate_applied, status, due_date, amount_paid, file_url
            )
            VALUES ($1, $2, $3, $4, $5, 'UNPAID', CURRENT_DATE + INTERVAL '${termsDays} days', 0, $6)
            RETURNING *;
        `;
        const insertResult = await db.query(insertQuery, [client_id, timesheet_id, invoiceNumber, hours, rate, s3Url]);

        await db.query(`UPDATE timesheets SET status = 'INVOICED' WHERE id = $1;`, [timesheet_id]);
        
        await db.query('COMMIT');

        // Non-blocking Outbound Email Service Trigger
        try {
            const contractorName = `${data.first_name} ${data.last_name}`;
            await sendInvoiceEmail(data.domain_prefix, data.billing_email, contractorName, monthName, s3Url, invoiceNumber);
            console.log("✅ Invoice email auto sent");
        } catch (emailError) {
            console.error("Email Trigger Error:", emailError.message);
        }

        res.status(201).json({
            success: true,
            message: "Invoice created successfully!",
            data: insertResult.rows[0]
        });

    } catch (err) {
        await db.query('ROLLBACK');
        console.error("Invoice Creation Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================================================
// DOWNLOAD INVOICE PDF
// ==========================================================================
router.get('/:id/download', async (req, res) => {
    const invoiceId = req.params.id;

    try {
        const query = `SELECT file_url FROM invoices WHERE id = $1`;
        const result = await db.query(query, [invoiceId]);
        let fileKey = result.rows[0]?.file_url;

        if (!fileKey) {
            return res.status(404).send('Invoice file not found.');
        }

        if (fileKey.startsWith('http')) {
            const splitParts = fileKey.split('.amazonaws.com/');
            if (splitParts.length > 1) {
                fileKey = splitParts[1];
            }
        }

        const secureUrl = await generateSignedUrl(fileKey);
        if (!secureUrl) {
            return res.status(500).send('Failed to generate secure URL.');
        }

        res.redirect(secureUrl);

    } catch (error) {
        console.error('Download Error:', error);
        res.status(500).send('Server error redirecting file.');
    }
});

// ==========================================================================
// PAY INVOICE (SUPPORTS PARTIAL & FULL PAYMENTS)
// ==========================================================================
router.put('/:id/pay', async (req, res) => {
    const { id } = req.params;
    const { amountPaidEntered } = req.body; // Expects a generic context number from frontend input

    if (amountPaidEntered === undefined || isNaN(amountPaidEntered) || Number(amountPaidEntered) <= 0) {
        return res.status(400).json({ success: false, error: "A valid positive numeric payment amount is required." });
    }

    try {
        await db.query('BEGIN');

        // 1. Gather all invoice criteria needed to accurately compile the PDF engine parameters
        const invoiceQuery = `
            SELECT 
                i.id, i.invoice_number, i.hours_billed, i.hourly_rate_applied, i.due_date,
                COALESCE(i.amount_paid, 0) AS current_amount_paid, i.client_id, i.timesheet_id,
                COALESCE(i.amount_invoiced, (i.hours_billed * i.hourly_rate_applied)) AS total_amount,
                t.period_start, t.period_end, u.first_name, u.last_name,
                e.invoice_rate, e.role, e.vendor_for, e.net_terms, e.vendor_address AS client_address,
                c.company_name AS client_name, ten.domain_prefix
            FROM invoices i
            JOIN timesheets t ON i.timesheet_id = t.id
            JOIN users u ON t.user_id = u.id
            LEFT JOIN employee_details e ON u.id = e.user_id
            JOIN clients c ON c.id = i.client_id
            JOIN tenants ten ON u.tenant_id = ten.id
            WHERE i.id = $1;
        `;
        const invoiceCheck = await db.query(invoiceQuery, [id]);

        if (invoiceCheck.rowCount === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Invoice record not found." });
        }

        const invoice = invoiceCheck.rows[0];
        const totalAmount = parseFloat(invoice.total_amount);
        const newAmountPaid = parseFloat(invoice.current_amount_paid) + parseFloat(amountPaidEntered);
        const balanceDue = totalAmount - newAmountPaid;

        // Establish string configuration match for status state logs
        let newStatus = 'PARTIALLY PAID';
        if (balanceDue <= 0.01) {
            newStatus = 'PAID';
        }

        const formatDate = (dateObj) => {
            const d = dateObj.getDate().toString().padStart(2, '0');
            const m = dateObj.toLocaleString('default', { month: 'short' });
            const y = dateObj.getFullYear();
            return `${d} ${m} ${y}`;
        };

        const today = new Date();
        const periodStartObj = new Date(invoice.period_start);
        const monthName = periodStartObj.toLocaleString('en-US', { month: 'long' }).toLowerCase();
        const year = periodStartObj.getFullYear();
        const cleanEmployeeName = `${invoice.first_name}_${invoice.last_name}`.replace(/\s+/g, '_').toLowerCase();
        const cleanClientName = invoice.client_name.replace(/\s+/g, '_').toLowerCase();
        const pdfFileName = `${cleanEmployeeName}_${monthName}_${year}_${cleanClientName}_invoice.pdf`;

        // 2. Generate updated layout matrix PDF
        const updatedPdfBuffer = await generateInvoiceBuffer({
            companyName: invoice.domain_prefix === 'gandiva' ? 'Gandiva Insights' : 'Leo Does IT Inc.',
            invoiceNumber: invoice.invoice_number,
            invoiceDate: formatDate(today),
            netTerms: String(invoice.net_terms || 'Net 30'),
            dueDate: formatDate(new Date(invoice.due_date)),
            clientName: invoice.client_name,
            clientAddress: invoice.client_address || '',
            vendorFor: invoice.vendor_for || 'N/A',
            contractorName: `${invoice.first_name} ${invoice.last_name}`,
            role: invoice.role || 'Consultant',
            hours: parseFloat(invoice.hours_billed),
            billingRate: parseFloat(invoice.hourly_rate_applied),
            billingPeriod: `${new Date(invoice.period_start).toLocaleDateString('en-US')} - ${new Date(invoice.period_end).toLocaleDateString('en-US')}`,
            amountPaid: newAmountPaid,
            balanceDue: balanceDue < 0 ? 0 : balanceDue
        });

        // 3. Re-upload over the top of S3 object key
        const newS3Url = await uploadInvoiceToS3(updatedPdfBuffer, pdfFileName);
        if (!newS3Url) {
            await db.query('ROLLBACK');
            return res.status(500).json({ success: false, error: "Failed to upload updated PDF revision to storage layers." });
        }

        // 4. Update core ledger metrics entries row
        const updateQuery = `
            UPDATE invoices
            SET status = $1,
                amount_paid = $2,
                file_url = $3
            WHERE id = $4
            RETURNING *;
        `;
        const result = await db.query(updateQuery, [newStatus, newAmountPaid, newS3Url, id]);

        await db.query('COMMIT');

        res.json({
            success: true,
            message: `Payment registered successfully. Invoice status changed to ${newStatus}.`,
            balanceDue: balanceDue < 0 ? 0 : balanceDue,
            data: result.rows[0]
        });

    } catch (err) {
        await db.query('ROLLBACK');
        console.error("Pay Invoice Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================================================
// 🔄 VOID INVOICE & RESTORE HOURS TO HUB
// ==========================================================================
router.put('/:id/void', async (req, res) => {
    const { id } = req.params;

    try {
        // Init multi-stage database transaction context
        await db.query('BEGIN');

        // A. Identify the timesheet tied to this ledger item before changing its record
        const findQuery = `SELECT timesheet_id FROM invoices WHERE id = $1`;
        const invoiceCheck = await db.query(findQuery, [id]);

        if (invoiceCheck.rowCount === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Invoice not found." });
        }

        const timesheetId = invoiceCheck.rows[0].timesheet_id;

        // B. Roll back timesheet tracking state back to standard 'APPROVED'
        if (timesheetId) {
            const rollbackTimesheetQuery = `
                UPDATE timesheets
                SET status = 'APPROVED'
                WHERE id = $1;
            `;
            await db.query(rollbackTimesheetQuery, [timesheetId]);
        }

        // C. Securely switch the ledger state string to 'VOID' to align with Postgres custom Enum constraints
        const voidInvoiceQuery = `
            UPDATE invoices
            SET status = 'VOID'
            WHERE id = $1
            RETURNING *;
        `;
        const result = await db.query(voidInvoiceQuery, [id]);

        await db.query('COMMIT');

        res.json({
            success: true,
            message: "Invoice successfully voided. Associated billable hours returned to Invoicing Hub.",
            data: result.rows[0]
        });

    } catch (err) {
        await db.query('ROLLBACK');
        console.error("Void Invoice Transaction Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================================================
// SEND INVOICE EMAIL
// ==========================================================================
router.post('/:id/send', async (req, res) => {
    const { id } = req.params;

    try {
        const query = `
            SELECT
                i.invoice_number,
                i.file_url,
                COALESCE(i.amount_invoiced, (i.hours_billed * i.hourly_rate_applied)) AS amount_invoiced,
                c.company_name,
                c.billing_email
            FROM invoices i
            LEFT JOIN clients c ON i.client_id = c.id
            WHERE i.id = $1
        `;
        const result = await db.query(query, [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: "Invoice not found" });
        }

        const invoice = result.rows[0];

        await sendInvoiceEmail('leodoesit', invoice.billing_email, invoice.company_name, 'Current Month', invoice.file_url, invoice.invoice_number);

        res.json({
            success: true,
            message: "Invoice email sent successfully"
        });

    } catch (err) {
        console.error("Send Invoice Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================================================
// SEND REMINDER EMAIL
// ==========================================================================
router.post('/:id/remind', async (req, res) => {
    const { id } = req.params;

    try {
        const query = `
            SELECT
                i.invoice_number,
                i.file_url,
                COALESCE(i.amount_invoiced, (i.hours_billed * i.hourly_rate_applied)) AS amount_invoiced,
                c.company_name,
                c.billing_email
            FROM invoices i
            LEFT JOIN clients c ON i.client_id = c.id
            WHERE i.id = $1
        `;
        const result = await db.query(query, [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: "Invoice not found" });
        }

        const invoice = result.rows[0];

        await sendBalanceReminderEmail('leodoesit', invoice.billing_email, invoice.company_name, invoice.invoice_number, invoice.amount_invoiced);

        res.json({
            success: true,
            message: "Reminder email sent successfully"
        });

    } catch (err) {
        console.error("Reminder Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;