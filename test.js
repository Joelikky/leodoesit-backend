// test.js
require('dotenv').config();
const { sendTimesheetReminder } = require('./utils/mailer');

async function runTest() {
    console.log("Attempting to send test email...");
    
    // Replace this with your own personal email address to see if it arrives!
    const testEmail = "neovamsisai@gmail.com"; 
    
    const success = await sendTimesheetReminder(testEmail, "Leo (Test)", "April");
    
    if (success) {
        console.log("🎉 SUCCESS! The Microsoft App Password works perfectly!");
    } else {
        console.log("❌ FAILED. Double check your .env file!");
    }
}

runTest();