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
// GET ALL INVOICES
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

        const result =
            await db.query(query, [tenantId]);

        res.json({
            success: true,
            count: result.rowCount,
            data: result.rows
        });

    } catch (err) {

        console.error(
            "Fetch Invoice Error:",
            err
        );

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
                c.billing_email,
                ten.domain_prefix
            FROM timesheets t
            JOIN users u ON t.user_id = u.id
            LEFT JOIN employee_details e ON u.id = e.user_id
            JOIN clients c ON c.id = $1
            JOIN tenants ten ON u.tenant_id = ten.id
            WHERE t.id = $2;
        `;

        const mathResult =
            await db.query(
                mathQuery,
                [client_id, timesheet_id]
            );

        if (mathResult.rowCount === 0) {

            return res.status(404).json({
                success: false,
                error: "No invoice records found."
            });
        }

        const data = mathResult.rows[0];

        const hours =
            parseFloat(data.total_hours || 0);

        const rate =
            parseFloat(data.invoice_rate || 0);

        const dateObj =
            new Date(data.period_start);

        const yy =
            dateObj
                .getFullYear()
                .toString()
                .slice(-2);

        const mm =
            (dateObj.getMonth() + 1)
                .toString()
                .padStart(2, '0');

        const uniquePin =
            Math.floor(
                1000 + Math.random() * 9000
            );

        const invoiceNumber =
            `${yy}${mm}${data.invoice_num || '00'}-${uniquePin}`;

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

        const formatDate = (date) => {

            const d =
                date
                    .getDate()
                    .toString()
                    .padStart(2, '0');

            const m =
                date.toLocaleString(
                    'default',
                    { month: 'short' }
                );

            const y =
                date.getFullYear();

            return `${d} ${m} ${y}`;
        };

        const invoiceDate =
            new Date(data.period_start);

        const monthName =
            invoiceDate
                .toLocaleString(
                    'en-US',
                    { month: 'long' }
                )
                .toLowerCase();

        const year =
            invoiceDate.getFullYear();

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
        // GENERATE PDF
        // ======================================================

        const pdfBuffer =
            await generateInvoiceBuffer({

                companyName:
                    data.domain_prefix === 'gandiva'
                        ? 'Gandiva Insights'
                        : 'Leo Does IT Inc.',

                invoiceNumber,

                invoiceDate:
                    formatDate(today),

                netTerms:
                    termsString,

                dueDate:
                    formatDate(dueDateObj),

                clientName:
                    data.client_name,

                clientAddress:
                    data.client_address || '',

                vendorFor:
                    data.vendor_for || 'N/A',

                contractorName:
                    `${data.first_name} ${data.last_name}`,

                role:
                    data.role || 'Consultant',

                hours,

                billingRate:
                    rate,

                billingPeriod:
                    `${new Date(data.period_start).toLocaleDateString('en-US')}
                    -
                    ${new Date(data.period_end).toLocaleDateString('en-US')}`
            });

        // ======================================================
        // S3 UPLOAD
        // ======================================================

        const s3Url =
            await uploadInvoiceToS3(
                pdfBuffer,
                pdfFileName
            );

        if (!s3Url) {

            return res.status(500).json({
                success: false,
                error:
                    "Failed to upload PDF to S3."
            });
        }

        // ======================================================
        // INSERT INVOICE
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

        const insertResult =
            await db.query(
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
        // UPDATE TIMESHEET
        // ======================================================

        await db.query(
            `
            UPDATE timesheets
            SET status = 'INVOICED'
            WHERE id = $1;
            `,
            [timesheet_id]
        );

        // ======================================================
        // AUTO SEND EMAIL
        // ======================================================

        try {

            const contractorName =
                `${data.first_name} ${data.last_name}`;

            await sendInvoiceEmail(
                data.domain_prefix,
                data.billing_email,
                contractorName,
                monthName,
                s3Url,
                invoiceNumber
            );

            console.log(
                "✅ Invoice email auto sent"
            );

        } catch (emailError) {

            console.error(
                "Email Trigger Error:",
                emailError.message
            );
        }

        res.status(201).json({
            success: true,
            message:
                "Invoice created successfully!",
            data: insertResult.rows[0]
        });

    } catch (err) {

        console.error(
            "Invoice Creation Error:",
            err
        );

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// ==========================================================================
// DOWNLOAD INVOICE PDF
// ==========================================================================
router.get('/:id/download', async (req, res) => {

    const invoiceId = req.params.id;

    try {

        const query = `
            SELECT file_url
            FROM invoices
            WHERE id = $1
        `;

        const result =
            await db.query(
                query,
                [invoiceId]
            );

        let fileKey =
            result.rows[0]?.file_url;

        if (!fileKey) {

            return res
                .status(404)
                .send(
                    'Invoice file not found.'
                );
        }

        if (fileKey.startsWith('http')) {

            const splitParts =
                fileKey.split(
                    '.amazonaws.com/'
                );

            if (splitParts.length > 1) {

                fileKey = splitParts[1];
            }
        }

        const secureUrl =
            await generateSignedUrl(
                fileKey
            );

        if (!secureUrl) {

            return res
                .status(500)
                .send(
                    'Failed to generate secure URL.'
                );
        }

        res.redirect(secureUrl);

    } catch (error) {

        console.error(
            'Download Error:',
            error
        );

        res
            .status(500)
            .send(
                'Server error redirecting file.'
            );
    }
});

// ==========================================================================
// PAY INVOICE
// ==========================================================================
router.put('/:id/pay', async (req, res) => {

    const { id } = req.params;

    try {

        const updateQuery = `
            UPDATE invoices
            SET
                status = 'PAID',
                amount_paid =
                    COALESCE(
                        amount_invoiced,
                        (hours_billed * hourly_rate_applied)
                    )
            WHERE id = $1
            RETURNING *;
        `;

        const result =
            await db.query(
                updateQuery,
                [id]
            );

        res.json({
            success: true,
            message:
                "Invoice marked as PAID",
            data: result.rows[0]
        });

    } catch (err) {

        console.error(
            "Pay Invoice Error:",
            err
        );

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// ==========================================================================
// VOID INVOICE
// ==========================================================================
router.put('/:id/void', async (req, res) => {

    const { id } = req.params;

    try {

        const updateQuery = `
            UPDATE invoices
            SET status = 'VOID'
            WHERE id = $1
            RETURNING *;
        `;

        const result =
            await db.query(
                updateQuery,
                [id]
            );

        res.json({
            success: true,
            message:
                "Invoice voided successfully",
            data: result.rows[0]
        });

    } catch (err) {

        console.error(
            "Void Invoice Error:",
            err
        );

        res.status(500).json({
            success: false,
            error: err.message
        });
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
                COALESCE(
                    i.amount_invoiced,
                    (i.hours_billed * i.hourly_rate_applied)
                ) AS amount_invoiced,
                c.company_name,
                c.billing_email
            FROM invoices i
            LEFT JOIN clients c
            ON i.client_id = c.id
            WHERE i.id = $1
        `;

        const result =
            await db.query(query, [id]);

        if (result.rowCount === 0) {

            return res.status(404).json({
                success: false,
                error: "Invoice not found"
            });
        }

        const invoice =
            result.rows[0];

        await sendInvoiceEmail(
            'leodoesit',
            invoice.billing_email,
            invoice.company_name,
            'Current Month',
            invoice.file_url,
            invoice.invoice_number
        );

        res.json({
            success: true,
            message:
                "Invoice email sent successfully"
        });

    } catch (err) {

        console.error(
            "Send Invoice Error:",
            err
        );

        res.status(500).json({
            success: false,
            error: err.message
        });
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
                COALESCE(
                    i.amount_invoiced,
                    (i.hours_billed * i.hourly_rate_applied)
                ) AS amount_invoiced,
                c.company_name,
                c.billing_email
            FROM invoices i
            LEFT JOIN clients c
            ON i.client_id = c.id
            WHERE i.id = $1
        `;

        const result =
            await db.query(query, [id]);

        if (result.rowCount === 0) {

            return res.status(404).json({
                success: false,
                error: "Invoice not found"
            });
        }

        const invoice =
            result.rows[0];

        await sendBalanceReminderEmail(
            'leodoesit',
            invoice.billing_email,
            invoice.company_name,
            invoice.invoice_number,
            invoice.amount_invoiced
        );

        res.json({
            success: true,
            message:
                "Reminder email sent successfully"
        });

    } catch (err) {

        console.error(
            "Reminder Error:",
            err
        );

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// ==========================================================================
// EXPORT ROUTER
// ==========================================================================
module.exports = router;