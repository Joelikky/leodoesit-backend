const nodemailer = require('nodemailer');

// 1. INVOICE EMAIL
const sendInvoiceEmail = async (tenantPrefix, clientEmail, contractorName, monthYear, pdfPath, invoiceNumber) => {
    try {
        const isGandiva = tenantPrefix === 'gandiva';

        // 1. DYNAMIC CREDENTIALS: Pick the right email and password based on the portal
        const smtpUser = isGandiva ? process.env.GANDIVA_EMAIL : process.env.EMAIL_USER;
        const smtpPass = isGandiva ? process.env.GANDIVA_PASS : process.env.EMAIL_PASS;

        // 2. Setup your email server
        const transporter = nodemailer.createTransport({
            host: 'smtp.zoho.com', // Note: Change to smtp.gmail.com or smtp.office365.com if you aren't using Zoho!
            port: 465,
            secure: true,
            auth: {
                user: smtpUser,
                pass: smtpPass
            }
        });

        let htmlContent = '';

        if (!isGandiva) {
            htmlContent = `
            <div style="font-family: Arial, sans-serif; color: #222; font-size: 14px; line-height: 1.6; max-width: 600px;">
                <p>Hi Team,</p>
                <p>I hope this message finds you well.</p>
                <p>Please find attached are the invoice - <strong>#${invoiceNumber}</strong> and approved timesheets for <strong>${contractorName}</strong> for the month of <strong>${monthYear}</strong>.</p>
                <p>We kindly request you to confirm receipt and acceptance of the attached invoice at your earliest convenience. Your prompt acknowledgment will help us ensure our records remain accurate and allow the invoicing process to proceed smoothly.</p>
                <p>Should you have any questions or require further clarification, please feel free to reach out.</p>
                <p>Thank you for your cooperation</p>
                <br/>
                <div style="font-family: Arial, sans-serif;">
                    <p style="color: #000080; font-weight: bold; font-size: 14px; margin-bottom: 8px;">
                        Bhanu Prakash | Accounts Team
                    </p>
                    <h2 style="margin: 0 0 8px 0; font-family: 'Arial Black', sans-serif; font-size: 22px;">
                        <span style="color: #FF5722;">LEO</span><span style="color: #1976D2;">DOESIT</span>
                    </h2>
                    <p style="color: #000080; font-size: 13px; margin-top: 0; line-height: 1.5;">
                        1335 Regents Park Dr, Ste# 270, Houston, TX 77058<br/>
                        Phone: +1-346-585-7793 || Direct: 551-256-0027|<br/>
                        Email: <a href="mailto:accounts@leodoesit.com" style="color: #000080; text-decoration: none;">accounts@leodoesit.com</a>
                    </p>
                </div>
            </div>
            `;
        } else {
            htmlContent = `
            <div style="font-family: Arial, sans-serif; color: #222; font-size: 14px; line-height: 1.6; max-width: 600px;">
                <p>Hi Team,</p>
                <p>I hope this message finds you well.</p>
                <p>Please find attached are the invoice - <strong>#${invoiceNumber}</strong> and approved timesheets for <strong>${contractorName}</strong> for the month of <strong>${monthYear}</strong>.</p>
                <p>We kindly request you to confirm receipt and acceptance of the attached invoice at your earliest convenience. Your prompt acknowledgment will help us ensure our records remain accurate and allow the invoicing process to proceed smoothly.</p>
                <p>Should you have any questions or require further clarification, please feel free to reach out.</p>
                <p>Thank you for your cooperation</p>
                <br/>
                <div style="font-family: Arial, sans-serif;">
                    <p style="color: #283747; font-weight: bold; font-size: 14px; margin-bottom: 8px;">
                        Accounts Team
                    </p>
                    <h2 style="margin: 0 0 8px 0; font-family: 'Arial Black', sans-serif; font-size: 22px;">
                        <span style="color: #283747;">GANDIVA</span> <span style="color: #E67E22;">INSIGHTS</span>
                    </h2>
                    <p style="color: #283747; font-size: 13px; margin-top: 0; line-height: 1.5;">
                        123 Gandiva Way, Suite 100, Tech City, TX 75001<br/>
                        Phone: 555-256-0000<br/>
                        Email: <a href="mailto:accounts@gandivainsights.com" style="color: #283747; text-decoration: none;">accounts@gandivainsights.com</a>
                    </p>
                </div>
            </div>
            `;
        }

        const mailOptions = {
            from: smtpUser, 
            to: clientEmail,
            subject: `Invoice and Timesheets - ${contractorName} - ${monthYear}`,
            html: htmlContent,
            attachments: [
                {
                    filename: `Invoice_${contractorName.replace(/\s+/g, '_')}_${monthYear}.pdf`,
                    path: pdfPath
                }
            ]
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error("Mailer Error:", error);
        return false;
    }
};

// 2. BALANCE REMINDER EMAIL
const sendBalanceReminderEmail = async (tenantPrefix, clientEmail, contractorName, invoiceNumber, balanceDue) => {
    try {
        const isGandiva = tenantPrefix === 'gandiva';
        const smtpUser = isGandiva ? process.env.GANDIVA_EMAIL : process.env.EMAIL_USER;
        const smtpPass = isGandiva ? process.env.GANDIVA_PASS : process.env.EMAIL_PASS;

        const transporter = nodemailer.createTransport({
            host: 'smtp.zoho.com', 
            port: 465,
            secure: true,
            auth: { user: smtpUser, pass: smtpPass }
        });

        let htmlContent = '';
        const formattedBalance = parseFloat(balanceDue).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        if (!isGandiva) {
            htmlContent = `
            <div style="font-family: Arial, sans-serif; color: #222; font-size: 14px; line-height: 1.6; max-width: 600px;">
                <p>Hi Team,</p>
                <p>We are writing to kindly remind you of an outstanding balance on your account.</p>
                <p>A partial payment was received, but there is a remaining balance of <strong style="color: #D32F2F;">${formattedBalance}</strong> for Invoice <strong>#${invoiceNumber}</strong> (Contractor: ${contractorName}).</p>
                <p>Please process the remaining balance at your earliest convenience to clear this invoice.</p>
                <p>Thank you for your prompt attention to this matter and your continued business!</p>
                <br/>
                <div style="font-family: Arial, sans-serif;">
                    <p style="color: #000080; font-weight: bold; font-size: 14px; margin-bottom: 8px;">Accounts Team</p>
                    <h2 style="margin: 0 0 8px 0; font-family: 'Arial Black', sans-serif; font-size: 22px;">
                        <span style="color: #FF5722;">LEO</span><span style="color: #1976D2;">DOESIT</span>
                    </h2>
                </div>
            </div>`;
        } else {
            htmlContent = `
            <div style="font-family: Arial, sans-serif; color: #222; font-size: 14px; line-height: 1.6; max-width: 600px;">
                <p>Hi Team,</p>
                <p>We are writing to kindly remind you of an outstanding balance on your account.</p>
                <p>A partial payment was received, but there is a remaining balance of <strong style="color: #D32F2F;">${formattedBalance}</strong> for Invoice <strong>#${invoiceNumber}</strong> (Contractor: ${contractorName}).</p>
                <p>Please process the remaining balance at your earliest convenience to clear this invoice.</p>
                <p>Thank you for your prompt attention to this matter.</p>
                <br/>
                <div style="font-family: Arial, sans-serif;">
                    <p style="color: #283747; font-weight: bold; font-size: 14px; margin-bottom: 8px;">Accounts Team</p>
                    <h2 style="margin: 0 0 8px 0; font-family: 'Arial Black', sans-serif; font-size: 22px;">
                        <span style="color: #283747;">GANDIVA</span> <span style="color: #E67E22;">INSIGHTS</span>
                    </h2>
                </div>
            </div>`;
        }

        const mailOptions = {
            from: smtpUser,
            to: clientEmail,
            subject: `Action Required: Outstanding Balance for Invoice #${invoiceNumber}`,
            html: htmlContent
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error("Reminder Mailer Error:", error);
        return false;
    }
};

// 3. NEW: TIMESHEET REMINDER EMAIL
const sendTimesheetReminder = async (tenantPrefix, contractorEmail, contractorName, monthName) => {
    try {
        const isGandiva = tenantPrefix === 'gandiva';
        const smtpUser = isGandiva ? process.env.GANDIVA_EMAIL : process.env.EMAIL_USER;
        const smtpPass = isGandiva ? process.env.GANDIVA_PASS : process.env.EMAIL_PASS;

        const transporter = nodemailer.createTransport({
            host: 'smtp.zoho.com', 
            port: 465,
            secure: true,
            auth: { user: smtpUser, pass: smtpPass }
        });

        let htmlContent = '';

        if (!isGandiva) {
            htmlContent = `
            <div style="font-family: Arial, sans-serif; color: #222; font-size: 14px; line-height: 1.6; max-width: 600px;">
                <p>Hi ${contractorName},</p>
                <p>This is an automated reminder that your timesheet for <strong>${monthName}</strong> is currently pending.</p>
                <p>Please submit your approved timesheet at your earliest convenience so we can ensure timely processing of your invoice.</p>
                <p>Thank you!</p>
                <br/>
                <div style="font-family: Arial, sans-serif;">
                    <p style="color: #000080; font-weight: bold; font-size: 14px; margin-bottom: 8px;">HR & Accounts Team</p>
                    <h2 style="margin: 0 0 8px 0; font-family: 'Arial Black', sans-serif; font-size: 22px;">
                        <span style="color: #FF5722;">LEO</span><span style="color: #1976D2;">DOESIT</span>
                    </h2>
                </div>
            </div>`;
        } else {
            htmlContent = `
            <div style="font-family: Arial, sans-serif; color: #222; font-size: 14px; line-height: 1.6; max-width: 600px;">
                <p>Hi ${contractorName},</p>
                <p>This is an automated reminder that your timesheet for <strong>${monthName}</strong> is currently pending.</p>
                <p>Please submit your approved timesheet at your earliest convenience so we can ensure timely processing of your invoice.</p>
                <p>Thank you!</p>
                <br/>
                <div style="font-family: Arial, sans-serif;">
                    <p style="color: #283747; font-weight: bold; font-size: 14px; margin-bottom: 8px;">HR & Accounts Team</p>
                    <h2 style="margin: 0 0 8px 0; font-family: 'Arial Black', sans-serif; font-size: 22px;">
                        <span style="color: #283747;">GANDIVA</span> <span style="color: #E67E22;">INSIGHTS</span>
                    </h2>
                </div>
            </div>`;
        }

        const mailOptions = {
            from: smtpUser,
            to: contractorEmail,
            subject: `Reminder: Please submit your ${monthName} timesheet`,
            html: htmlContent
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error("Timesheet Reminder Mailer Error:", error);
        return false;
    }
};

// Export ALL THREE functions!
module.exports = { sendInvoiceEmail, sendBalanceReminderEmail, sendTimesheetReminder };