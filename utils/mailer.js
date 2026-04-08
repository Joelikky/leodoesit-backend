const nodemailer = require('nodemailer');
require('dotenv').config();

// 1. Outlook Configuration (For Leodoesit)
const leodoesitTransporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false, 
    auth: {
      user: process.env.EMAIL_USER, 
      pass: process.env.EMAIL_PASS, 
    },
});

// 2. Zoho Configuration (For Gandiva)
const gandivaTransporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true, 
    auth: {
      user: process.env.GANDIVA_EMAIL, 
      pass: process.env.GANDIVA_PASS, 
    },
});

// 3. The "Smart Switcher" - It picks the right email account based on the company name
const getMailer = (tenantPrefix) => {
    if (tenantPrefix === 'gandiva') {
        return { transporter: gandivaTransporter, fromEmail: process.env.GANDIVA_EMAIL, companyName: 'Gandiva' };
    }
    return { transporter: leodoesitTransporter, fromEmail: process.env.EMAIL_USER, companyName: 'Leodoes It' };
};

// 4. The Email Functions
const sendTimesheetReminder = async (tenantPrefix, contractorEmail, contractorName, monthName) => {
    const { transporter, fromEmail, companyName } = getMailer(tenantPrefix);
    
    try {
        await transporter.sendMail({
            from: `"${companyName} Accounts" <${fromEmail}>`, 
            replyTo: fromEmail, 
            to: contractorEmail,
            subject: `Action Required: Submit your timesheet for ${monthName}`,
            html: `<div style="font-family: Arial, sans-serif; color: #333;">
                     <h2>Hello ${contractorName},</h2>
                     <p>This is a friendly reminder from <strong>${companyName}</strong> to submit your timesheet for <strong>${monthName}</strong>.</p>
                     <p>Please log into your portal to complete your submission.</p>
                     <br/>
                     <p>Thank you,</p>
                     <p><strong>Leo</strong><br/>${companyName} Management</p>
                   </div>`
        });
        console.log(`Reminder sent to ${contractorEmail} via ${companyName}`);
        return true;
    } catch (error) {
        console.error(`Failed to send reminder:`, error);
        return false;
    }
};

const sendRejectionEmail = async (tenantPrefix, contractorEmail, contractorName, billingPeriod, reason) => {
    const { transporter, fromEmail, companyName } = getMailer(tenantPrefix);
    
    try {
        await transporter.sendMail({
            from: `"${companyName} Accounts" <${fromEmail}>`, 
            to: contractorEmail,
            subject: `Action Required: Timesheet Rejected for ${billingPeriod}`,
            html: `<div style="font-family: Arial, sans-serif; color: #333;">
                     <h2>Hello ${contractorName},</h2>
                     <p>Your timesheet for ${billingPeriod} was reviewed and requires corrections.</p>
                     <p><strong>Reason for rejection:</strong> <i>"${reason}"</i></p>
                     <p>Please log in, make the necessary adjustments, and resubmit.</p>
                   </div>`
        });
        return true;
    } catch (error) {
        return false;
    }
};

const sendInvoiceEmail = async (tenantPrefix, clientEmail, contractorName, monthName, pdfPath) => {
    const { transporter, fromEmail, companyName } = getMailer(tenantPrefix);
    
    try {
        await transporter.sendMail({
            from: `"${companyName} Accounts" <${fromEmail}>`, 
            replyTo: fromEmail, 
            to: clientEmail,
            subject: `New Invoice: ${contractorName} - ${monthName} Services`,
            html: `<div style="font-family: Arial, sans-serif; color: #333;">
                     <p>Hello,</p>
                     <p>Please find attached the official invoice for contractor services provided by <strong>${contractorName}</strong> for <strong>${monthName}</strong>.</p>
                     <p>Thank you for your continued business!</p>
                     <p><strong>Leo</strong><br/>${companyName} Management</p>
                   </div>`,
            attachments: [{ filename: `Invoice_${contractorName.replace(/\s+/g, '_')}_${monthName}.pdf`, path: pdfPath }]
        });
        return true;
    } catch (error) {
        return false;
    }
};

module.exports = { sendTimesheetReminder, sendInvoiceEmail, sendRejectionEmail };