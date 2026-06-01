// utils/mailer.js

const nodemailer = require('nodemailer');
const path = require('path');

// ==========================================
// 🚀 TRANSPORTER LOGIC (POOLING DISABLED FOR SERVERLESS STABILITY)
// ==========================================

const gandivaTransporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 587,
    secure: false, // TLS
    family: 4,     // 🚀 FORCES IPv4 (Fixes serverless route network crashes)
    auth: { 
        user: process.env.GANDIVA_EMAIL, 
        pass: process.env.GANDIVA_PASS 
    },
    tls: { 
        ciphers: 'SSLv3', 
        rejectUnauthorized: false 
    },
    debug: true,             // Prints raw SMTP traffic to cloud runtime console logs
    logger: true,            // Enables internal monitoring loggers
    connectionTimeout: 10000 // Breaks hanging connections at 10s to prevent container timeouts
});

const ldiTransporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false, // TLS
    family: 4,     // 🚀 FORCES IPv4
    auth: { 
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
    },
    tls: { 
        ciphers: 'SSLv3', 
        rejectUnauthorized: false 
    },
    debug: true,             
    logger: true,            
    connectionTimeout: 10000 
});

const getTransporter = (isGandiva) => isGandiva ? gandivaTransporter : ldiTransporter;

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

// ==========================================
// 🛠️ ACTIVE TRANSACTION FUNCTIONALITY
// ==========================================

// 1. INVOICE EMAIL (FIXED ATTACHMENT ROUTE)
const sendInvoiceEmail = async (tenantPrefix, clientEmail, contractorName, monthYear, pdfBuffer, invoiceNumber) => {
    try {
        const isGandiva = tenantPrefix === 'gandiva';
        const transporter = getTransporter(isGandiva);
        const fromEmail = isGandiva ? process.env.GANDIVA_EMAIL : process.env.EMAIL_USER;

        let htmlContent = `
            <div style="font-family: Arial, sans-serif; color: #222; font-size: 14px; line-height: 1.6; max-width: 600px;">
                <p>Hi Team,</p>
                <p>Please find attached the invoice <strong>#${invoiceNumber}</strong> and approved timesheets for <strong>${contractorName}</strong> for the month of <strong>${monthYear}</strong>.</p>
                <p>We kindly request you to confirm receipt and acceptance of the attached invoice at your earliest convenience.</p>
                <p>Thank you for your cooperation!</p>
                ${isGandiva ? gandivaSignature : leodoesitSignature}
            </div>
        `;

        const attachments = [
            { 
                filename: `Invoice_${invoiceNumber}.pdf`, 
                content: pdfBuffer 
            },
            isGandiva ? gandivaLogoAttachment : ldiLogoAttachment
        ];

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

        const mailOptions = {
            from: fromEmail,
            to: clientEmail,
            subject: `Action Required: Outstanding Balance for #${invoiceNumber}`,
            html: htmlContent,
            attachments: [isGandiva ? gandivaLogoAttachment : ldiLogoAttachment]
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
        const portalUrl = "https://leodoesit-frontend.vercel.app/";
        
        // Dynamic styling for the button based on tenant branding
        const btnColor = isGandiva ? '#1E40AF' : '#10B981'; 

        const htmlContent = `
            <div style="font-family: Arial, sans-serif; color: #222; font-size: 14px; line-height: 1.6; max-width: 600px;">
                <p>Hi ${contractorName},</p>
                <p>This is an automated reminder that your timesheet for <strong>${monthName}</strong> is currently pending.</p>
                <p>Please click the button below to log into the portal and submit your approved timesheet at your earliest convenience so we can ensure timely processing of your invoice.</p>
                
                <div style="margin: 25px 0; text-align: left;">
                    <a href="${portalUrl}" 
                       style="background-color: ${btnColor}; color: white; text-decoration: none; padding: 12px 24px; font-weight: bold; border-radius: 6px; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                       + Submit Your Timesheet
                    </a>
                </div>
                
                <p>Thank you!</p>
                ${isGandiva ? gandivaSignature : leodoesitSignature}
            </div>`;

        const mailOptions = {
            from: fromEmail,
            to: contractorEmail,
            subject: `Reminder: Please submit your ${monthName} timesheet`,
            html: htmlContent,
            attachments: [isGandiva ? gandivaLogoAttachment : ldiLogoAttachment]
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error("Timesheet Reminder Error:", error.message);
        return false;
    }
};

// 4. REJECTION EMAIL
const sendRejectionEmail = async (tenantPrefix, contractorEmail, contractorName, billingPeriod, rejectionReason) => {
    try {
        const isGandiva = tenantPrefix === 'gandiva';
        const transporter = getTransporter(isGandiva); 
        const fromEmail = isGandiva ? process.env.GANDIVA_EMAIL : process.env.EMAIL_USER;
        const portalUrl = "https://leodoesit-frontend.vercel.app/";
        const btnColor = isGandiva ? '#1E40AF' : '#10B981';

        const htmlContent = `
            <div style="font-family: Arial, sans-serif; color: #222; font-size: 14px; line-height: 1.6; max-width: 600px;">
                <p>Hi ${contractorName},</p>
                <p>Unfortunately, your timesheet for the period <strong>${billingPeriod}</strong> has been rejected.</p>
                <div style="background-color: #FEF2F2; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #EF4444;">
                    <p style="margin: 0; color: #991B1B;"><strong>Reason for Rejection:</strong> ${rejectionReason}</p>
                </div>
                <p>Please click the button below to log into your portal, review the notes, make the necessary corrections, and resubmit.</p>
                
                <div style="margin: 25px 0; text-align: left;">
                    <a href="${portalUrl}" 
                       style="background-color: ${btnColor}; color: white; text-decoration: none; padding: 12px 24px; font-weight: bold; border-radius: 6px; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                       Fix & Resubmit Timesheet
                    </a>
                </div>
                
                <p>Thank you,</p>
                ${isGandiva ? gandivaSignature : leodoesitSignature}
            </div>`;

        const mailOptions = {
            from: fromEmail,
            to: contractorEmail,
            subject: `Action Required: Timesheet Rejected for ${billingPeriod}`,
            html: htmlContent,
            attachments: [isGandiva ? gandivaLogoAttachment : ldiLogoAttachment]
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error("Rejection Mailer Error:", error.message);
        return false;
    }
};

// 5. TIMESHEET SUBMISSION CONFIRMATION EMAIL
const sendTimesheetSubmissionEmail = async (tenantPrefix, employeeEmail, adminEmail, employeeName, billingPeriod, totalHours) => {
    try {
        const isGandiva = tenantPrefix === 'gandiva';
        const transporter = getTransporter(isGandiva); 
        const fromEmail = isGandiva ? process.env.GANDIVA_EMAIL : process.env.EMAIL_USER;
        const teamName = isGandiva ? "Gandiva Insights Admin Team" : "Leodoes IT Admin Team";

        const mailOptions = {
            from: `"${teamName}" <${fromEmail}>`,
            to: employeeEmail,
            cc: adminEmail, 
            subject: `Timesheet Submitted: ${employeeName} (${billingPeriod})`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111827;">
                    <h2 style="color: #10B981;">Timesheet Received ✅</h2>
                    <p>Hi ${employeeName},</p>
                    <p>Your timesheet for the period <strong>${billingPeriod}</strong> has been successfully submitted and is now pending admin approval.</p>
                    
                    <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3B82F6;">
                        <p style="margin: 0;"><strong>Total Hours Logged:</strong> ${totalHours} hrs</p>
                    </div>
                    
                    <p>You will receive another notification once this has been officially approved or if any adjustments are needed.</p>
                    <p>Best regards,<br><strong>${teamName}</strong></p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error("❌ Timesheet Confirmation Email Failed:", error.message);
        return false;
    }
};

// 6. TIMESHEET APPROVAL EMAIL
const sendTimesheetApprovalEmail = async (tenantPrefix, contractorEmail, contractorName, billingPeriod, totalHours) => {
    try {
        const isGandiva = tenantPrefix === 'gandiva';
        const transporter = getTransporter(isGandiva); 
        const fromEmail = isGandiva ? process.env.GANDIVA_EMAIL : process.env.EMAIL_USER;
        const teamName = isGandiva ? "Gandiva Insights Admin Team" : "Leodoes IT Admin Team";

        const mailOptions = {
            from: `"${teamName}" <${fromEmail}>`,
            to: contractorEmail,
            subject: `Timesheet Approved: ${billingPeriod}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111827;">
                    <h2 style="color: #10B981;">Timesheet Approved ✅</h2>
                    <p>Hi ${contractorName},</p>
                    <p>Great news! Your timesheet for the period <strong>${billingPeriod}</strong> has been reviewed and officially approved.</p>
                    
                    <div style="background-color: #F0FDF4; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10B981;">
                        <p style="margin: 0; color: #065F46;"><strong>Approved Hours:</strong> ${totalHours} hrs</p>
                    </div>
                    
                    <p>These hours will now be moved to the Invoicing Hub for final processing. Thank you for your hard work!</p>
                    <p>Best regards,<br><strong>${teamName}</strong></p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error("❌ Approval Confirmation Email Failed:", error.message);
        return false;
    }
};

module.exports = { 
    sendRejectionEmail, 
    sendInvoiceEmail, 
    sendBalanceReminderEmail, 
    sendTimesheetReminder, 
    sendTimesheetSubmissionEmail,
    sendTimesheetApprovalEmail
};