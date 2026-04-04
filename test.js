require('dotenv').config();
const { sendTimesheetReminder } = require('./utils/mailer');

async function runTest() {
    console.log("Preparing to send the Timesheet Reminder...");

    // 👇 REPLACE THIS WITH YOUR REAL GMAIL/PERSONAL EMAIL 👇
    const testEmail = "invoice.leo@outlook.com"; 
    
    // Using realistic test data
    const contractorName = "Alex Contractor";
    const billingPeriod = "April 2026"; 

    // Trigger the function you wrote in mailer.js
    const success = await sendTimesheetReminder(testEmail, contractorName, billingPeriod);

    if (success) {
        console.log(`\n🎉 SUCCESS! The email was sent to ${testEmail}.`);
        console.log("Go check your inbox (and your spam folder just in case)!");
    } else {
        console.log("\n❌ FAILED. Check the error messages above.");
    }
}

runTest();