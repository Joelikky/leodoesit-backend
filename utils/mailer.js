const nodemailer = require('nodemailer');
const path = require('path');

const getTransporter = (isGandiva) => {
    // 🔥 DYNAMIC SERVER LOGIC
    // Gandiva uses Zoho | Leodoesit uses Outlook (Office365)
    const host = isGandiva ? 'smtp.zoho.com' : 'smtp.office365.com';
    const user = isGandiva ? process.env.GANDIVA_EMAIL : process.env.EMAIL_USER;
    const pass = isGandiva ? process.env.GANDIVA_PASS : process.env.EMAIL_PASS;

    return nodemailer.createTransport({
        host: host,
        port: 587,
        secure: false, // TLS
        auth: { user, pass },
        tls: {
            ciphers: 'SSLv3',
            rejectUnauthorized: false
        }
    });
};

// Logo Attachment Configurations for BOTH portals
const ldiLogoAttachment = {
    filename: 'LDI Logo.png',
    path: path.join(__dirname, 'LDI Logo.png'), 
    cid: 'leodoesit_logo' 
};

const gandivaLogoAttachment = {
    filename: 'GI Logo PNG.png',
    path: path.join(__dirname, 'GI Logo PNG.png'), 
    cid: 'gandiva_logo' 
};

// ==========================================
// 🎨 REUSABLE EMAIL SIGNATURES
// ==========================================
const leodoesitSignature = `
    <br/>
    <div style="font-family: Arial, sans-serif;">
        <p style="color: #000080; font-weight: bold; font-size: 14px; margin-bottom: 8px;">
            Bhanu Prakash | Accounts Team
        </p>
        <img src="cid:leodoesit_logo" alt="LeoDoesIT Logo" style="width: 200px; max-width: 100%; height: auto; margin-bottom: 8px;" />
        <p style="color: #000080; font-size: 13px; margin-top: 0; line-height: 1.5;">
            1335 Regents Park Dr, Ste# 270, Houston, TX 77058<br/>
            Phone: +1-346-585-7793 || Direct: 551-256-0027|<br/>
            Email: <a href="mailto:accounts@leodoesit.com" style="color: #000080; text-decoration: none;">accounts@leodoesit.com</a>
        </p>
    </div>
`;

const gandivaSignature = `
    <br/>
    <div style="font-family: Arial, sans-serif; color: #333; font-size: 14px; line-height: 1.5;">
        <p style="margin: 0 0 4px 0;"><strong>Best Regards</strong></p>
        <p style="margin: 0 0 4px 0; font-size: 16px; color: #444;"><strong>Accounts Team</strong></p>
        <p style="margin: 0;">E: <a href="mailto:accounts@gandivainsights.com" style="color: #0000EE; text-decoration: underline;">accounts@gandivainsights.com</a></p>
        <p style="margin: 0 0 10px 0;">W: <a href="http://gandivainsights.com" style="color: #0000EE; text-decoration: underline;">Gandivainsights.com</a> | Houston, TX | 77058 |</p>
        <img src="cid:gandiva_logo" alt="Gandiva Insights Logo" style="width: 150px; max-width: 100%; height: auto;" />
    </div>
`;

// 1. INVOICE EMAIL (🔥 CHANGED: Accepts s3PdfUrl instead of pdfBuffer)
const sendInvoiceEmail = async (tenantPrefix, clientEmail, contractorName, monthYear, s3PdfUrl, invoiceNumber) => {
    try {
        const isGandiva = tenantPrefix === 'gandiva';
        const transporter = getTransporter(isGandiva);
        const fromEmail = isGandiva ? process.env.GANDIVA_EMAIL : process.env.EMAIL_USER;

        let htmlContent = `
            <div style="font-family: Arial, sans-serif; color: #222; font-size: 14px; line-height: 1.6; max-width: 600px;">
                <p>Hi Team,</p>
                <p>Please find attached are the invoice <strong>#${invoiceNumber}</strong> and approved timesheets for <strong>${contractorName}</strong> for the month of <strong>${monthYear}</strong>.</p>
                <p>We kindly request you to confirm receipt and acceptance of the attached invoice at your earliest convenience.</p>
                <p>Thank you for your cooperation!</p>
                ${isGandiva ? gandivaSignature : leodoesitSignature}
            </div>
        `;

        // 🔥 CHANGED: Use 'href' to pull the PDF straight from AWS S3!
        const attachments = [{ 
            filename: `Invoice_${invoiceNumber}.pdf`, 
            href: s3PdfUrl 
        }];
        attachments.push(isGandiva ? gandivaLogoAttachment : ldiLogoAttachment);

        const mailOptions = {
            from: fromEmail,
            to: clientEmail,
            subject: `Invoice and Timesheets - ${contractorName} - ${monthYear}`,
            html: htmlContent,
            attachments: attachments
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error("Mailer Error:", error.message);
        return false;
    }
};

// 2. BALANCE REMINDER EMAIL
const sendBalanceReminderEmail = async (tenantPrefix, clientEmail, contractorName, invoiceNumber, balanceDue) => {
    try {
        const isGandiva = tenantPrefix === 'gandiva';
        const transporter = getTransporter(isGandiva);
        const fromEmail = isGandiva ? process.env.GANDIVA_EMAIL : process.env.EMAIL_USER;
        const formattedBalance = parseFloat(balanceDue).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        const htmlContent = `
            <div style="font-family: Arial, sans-serif; color: #222; font-size: 14px; line-height: 1.6; max-width: 600px;">
                <p>Hi Team,</p>
                <p>This is a reminder that there is a remaining balance of <strong style="color: #D32F2F;">${formattedBalance}</strong> for Invoice <strong>#${invoiceNumber}</strong>.</p>
                <p>Please process the payment at your earliest convenience.</p>
                ${isGandiva ? gandivaSignature : leodoesitSignature}
            </div>`;

        // Smart Attachments: Just the correct portal logo
        const attachments = [isGandiva ? gandivaLogoAttachment : ldiLogoAttachment];

        const mailOptions = {
            from: fromEmail,
            to: clientEmail,
            subject: `Action Required: Outstanding Balance for #${invoiceNumber}`,
            html: htmlContent,
            attachments: attachments
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error("Reminder Mailer Error:", error.message);
        return false;
    }
};

// 3. TIMESHEET REMINDER EMAIL
const sendTimesheetReminder = async (tenantPrefix, contractorEmail, contractorName, monthName) => {
    try {
        const isGandiva = tenantPrefix === 'gandiva';
        const transporter = getTransporter(isGandiva);
        const fromEmail = isGandiva ? process.env.GANDIVA_EMAIL : process.env.EMAIL_USER;

        const htmlContent = `
            <div style="font-family: Arial, sans-serif; color: #222; font-size: 14px; line-height: 1.6; max-width: 600px;">
                <p>Hi ${contractorName},</p>
                <p>This is an automated reminder that your timesheet for <strong>${monthName}</strong> is currently pending.</p>
                <p>Please submit your approved timesheet at your earliest convenience so we can ensure timely processing of your invoice.</p>
                <p>Thank you!</p>
                ${isGandiva ? gandivaSignature : leodoesitSignature}
            </div>`;

        // Smart Attachments: Just the correct portal logo
        const attachments = [isGandiva ? gandivaLogoAttachment : ldiLogoAttachment];

        const mailOptions = {
            from: fromEmail,
            to: contractorEmail,
            subject: `Reminder: Please submit your ${monthName} timesheet`,
            html: htmlContent,
            attachments: attachments
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error("Timesheet Reminder Error:", error.message);
        return false;
    }
};

module.exports = { sendInvoiceEmail, sendBalanceReminderEmail, sendTimesheetReminder };