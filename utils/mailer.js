// // utils/mailer.js
// const nodemailer = require('nodemailer');
// require('dotenv').config();

// // Configure the transport specifically for Outlook/Office365
// const transporter = nodemailer.createTransport({
//     host: 'smtp.office365.com',
//     port: 587,
//     secure: false, // true for 465, false for other ports
//     auth: {
//         user: process.env.EMAIL_USER,
//         pass: process.env.EMAIL_PASS,
//     },
//     tls: {
//         ciphers: 'SSLv3',
//         rejectUnauthorized: false // Helps prevent local certificate errors
//     }
// });

// /**
//  * Sends a timesheet reminder email.
//  * Includes both Text and HTML to lower spam score.
//  */
// const sendTimesheetReminder = async (contractorEmail, contractorName, monthName) => {
//     const subjectLine = `Action Required: Submit your timesheet for ${monthName}`;
    
//     // Plain text version (Crucial for bypassing spam filters)
//     const textVersion = `
//         Hello ${contractorName},
        
//         This is a friendly reminder to submit your timesheet for ${monthName}. 
//         Please log into the portal to complete your submission so we can process your invoice.
        
//         Thank you,
//         Leo
//         Leodoes It Management
//     `;

//     // HTML version (For better UI, but keep it clean and simple)
//     const htmlVersion = `
//         <div style="font-family: Arial, sans-serif; color: #333;">
//             <h2>Hello ${contractorName},</h2>
//             <p>This is a friendly reminder from the <strong>Leodoes It</strong> team to submit your timesheet for <strong>${monthName}</strong>.</p>
//             <p>Please log into your contractor portal to complete your submission as soon as possible so we can begin the invoicing process.</p>
//             <br/>
//             <p>Thank you,</p>
//             <p><strong>Leo</strong><br/>Leodoes It Management</p>
//         </div>
//     `;

//     try {
//         const info = await transporter.sendMail({
//             from: `"Leodoes It Accounts" <${process.env.EMAIL_USER}>`, 
//             to: contractorEmail,
//             subject: subjectLine,
//             text: textVersion,
//             html: htmlVersion,
//         });
//         console.log(`Email successfully sent to ${contractorEmail}: ${info.messageId}`);
//         return true;
//     } catch (error) {
//         console.error(`Failed to send to ${contractorEmail}:`, error);
//         return false;
//     }
// };

// module.exports = { sendTimesheetReminder };


// utils/mailer.js
const nodemailer = require('nodemailer');
require('dotenv').config();

// Configure the transport specifically for Gmail
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    }
});

/**
 * Sends a timesheet reminder email.
 * Includes both Text and HTML to lower spam score.
 */
const sendTimesheetReminder = async (contractorEmail, contractorName, monthName) => {
    const subjectLine = `Action Required: Submit your timesheet for ${monthName}`;
    
    // Plain text version with Anti-Spam Footer
    const textVersion = `
        Hello ${contractorName},
        
        This is a friendly reminder to submit your timesheet for ${monthName}. 
        Please log into the portal to complete your submission so we can process your invoice.
        
        Thank you,
        Leo
        Leodoes It Management

        -------------------------------------------------
        You are receiving this automated email because you are 
        registered as an active contractor for Leodoes It.
    `;

    // HTML version with Anti-Spam Footer
    const htmlVersion = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px;">
            <h2>Hello ${contractorName},</h2>
            <p>This is a friendly reminder from the <strong>Leodoes It</strong> team to submit your timesheet for <strong>${monthName}</strong>.</p>
            <p>Please log into your contractor portal to complete your submission as soon as possible so we can begin the invoicing process.</p>
            <br/>
            <p>Thank you,</p>
            <p><strong>Leo</strong><br/>Leodoes It Management</p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin-top: 30px;" />
            <p style="font-size: 11px; color: #888;">
                You are receiving this automated email because you are registered as an active contractor for Leodoes It.
            </p>
        </div>
    `;

    try {
        const info = await transporter.sendMail({
            from: `"Leodoes It Accounts" <${process.env.EMAIL_USER}>`, 
            replyTo: process.env.EMAIL_USER, // <-- Tells spam filters this is a real inbox
            to: contractorEmail,
            subject: subjectLine,
            text: textVersion,
            html: htmlVersion,
        });
        console.log(`Email successfully sent to ${contractorEmail}: ${info.messageId}`);
        return true;
    } catch (error) {
        console.error(`Failed to send to ${contractorEmail}:`, error);
        return false;
    }
};

module.exports = { sendTimesheetReminder };