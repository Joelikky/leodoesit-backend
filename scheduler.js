// scheduler.js
const cron = require('node-cron');
const db = require('./db'); 
const { sendTimesheetReminder } = require('./utils/mailer');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- NEW LOGIC: Check if we have passed the First Monday ---
const isPastFirstMonday = () => {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    // Find the exact date of the First Monday
    let firstMonday = new Date(firstDayOfMonth);
    while (firstMonday.getDay() !== 1) { // 1 represents Monday
        firstMonday.setDate(firstMonday.getDate() + 1);
    }

    // Strip the time away so we are only comparing calendar days
    today.setHours(0, 0, 0, 0);
    firstMonday.setHours(0, 0, 0, 0);

    // Return true if today is ON or AFTER the first Monday
    return today >= firstMonday;
};

// --- NEW LOGIC: Auto-Generate Blank Timesheets on the 1st of the Month ---
const generateMonthlyTimesheets = async () => {
    console.log('Starting monthly timesheet generation...');
    
    try {
        // --- NEW: Calculate the exact Start and End dates for this month ---
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth(); // 0-indexed (0 = Jan, 1 = Feb)

        /// Create bulletproof SQL-friendly date strings (YYYY-MM-DD)
        const safeMonth = String(month + 1).padStart(2, '0'); // Ensures '4' becomes '04'
        const lastDay = new Date(year, month + 1, 0).getDate(); // Gets 28, 30, or 31

        const periodStart = `${year}-${safeMonth}-01`;
        const periodEnd = `${year}-${safeMonth}-${lastDay}`;

        // 1. Fetch all users/contractors from the database
        const usersResult = await db.query(`SELECT id FROM users`);
        const users = usersResult.rows;

        if (users.length === 0) {
            console.log('No users found in the database to generate timesheets for.');
            return;
        }

        // 2. Loop through and insert a blank, PENDING timesheet for each person
        let count = 0;
        for (const user of users) {
            // Notice we added period_start and period_end here!
            await db.query(`
                INSERT INTO timesheets (user_id, status, period_start, period_end)
                VALUES ($1, 'PENDING', $2, $3)
            `, [user.id, periodStart, periodEnd]);
            count++;
        }

        console.log(`Successfully generated ${count} blank timesheets for ${periodStart} to ${periodEnd}.`);

    } catch (err) {
        console.error('Error auto-generating timesheets:', err);
    }
};
const runDailyTimesheetCheck = async () => {
    console.log('Running daily timesheet check...');
    
    // 1. The Bouncer: Stop the script if it's too early in the month
    if (!isPastFirstMonday()) {
        console.log('Too early in the month. Waiting for the First Monday to begin reminders.');
        return; 
    }

    // --- NEW LOGIC: Calculate the PREVIOUS month ---
    const today = new Date();
    // Go back exactly one month (If today is in April, this becomes March 1st)
    const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    
    // Get the friendly name for the email (e.g., "March")
    const previousMonthName = lastMonthDate.toLocaleString('default', { month: 'long' });
    
    // Get the exact period_start string to find the correct timesheet in Supabase
    const targetYear = lastMonthDate.getFullYear();
    const targetMonth = String(lastMonthDate.getMonth() + 1).padStart(2, '0');
    const targetPeriodStart = `${targetYear}-${targetMonth}-01`;

    try {
        // 2. Query Supabase: Only find PENDING timesheets from EXACTLY last month
        const result = await db.query(`
            SELECT t.user_id, t.status, u.first_name, u.email
            FROM timesheets t
            JOIN users u ON t.user_id = u.id
            WHERE t.status = $1 AND t.period_start = $2
        `, ['PENDING', targetPeriodStart]); // <--- Notice we added targetPeriodStart here!

        const pendingContractors = result.rows;

        if (pendingContractors.length === 0) {
            console.log(`No pending timesheets found for ${previousMonthName}. Everyone is up to date!`);
            return;
        }

        console.log(`Found ${pendingContractors.length} pending timesheets for ${previousMonthName}. Initiating email sequence...`);

        // 3. Loop through and send emails
        for (const record of pendingContractors) {
            const email = record.email;
            const name = record.first_name; 

            // Pass previousMonthName into the email template!
            await sendTimesheetReminder(email, name, previousMonthName);
            await delay(5000); 
        }

        console.log('Daily email sequence complete.');

    } catch (err) {
        console.error('Error during automated timesheet check:', err);
    }
};

// Schedule the job to run EVERY DAY at 9:00 AM
// Minute(0) Hour(9) Day(*) Month(*) DayOfWeek(*)
cron.schedule('0 9 * * *', () => {
    runDailyTimesheetCheck();
}, {
    timezone: "America/Chicago" // Automatically handles US Daylight Saving Time
});

console.log('Timesheet Scheduler initialized. Running daily at 9:00 AM. Reminders start on the First Monday.');

// Schedule the Generator to run at 12:00 AM (Midnight) on the 1st of EVERY month
// Minute(0) Hour(0) DayOfMonth(1) Month(*) DayOfWeek(*)
cron.schedule('0 0 1 * *', () => {
    generateMonthlyTimesheets();
}, 
{
    timezone: "America/Chicago"
}

);

console.log('Timesheet Generator initialized. Scheduled for midnight on the 1st of every month.');