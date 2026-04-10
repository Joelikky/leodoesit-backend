const cron = require('node-cron');
const db = require('./db'); 
const { sendTimesheetReminder } = require('./utils/mailer');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Checks if today is past the first Monday of the month
const isPastFirstMonday = () => {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    let firstMonday = new Date(firstDayOfMonth);
    while (firstMonday.getDay() !== 1) { 
        firstMonday.setDate(firstMonday.getDate() + 1);
    }

    today.setHours(0, 0, 0, 0);
    firstMonday.setHours(0, 0, 0, 0);
    return today >= firstMonday;
};

// Runs on the 1st of every month
const generateMonthlyTimesheets = async () => {
    console.log('Starting monthly timesheet generation...');
    
    try {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth(); 
        const safeMonth = String(month + 1).padStart(2, '0'); 
        const lastDay = new Date(year, month + 1, 0).getDate(); 

        const periodStart = `${year}-${safeMonth}-01`;
        const periodEnd = `${year}-${safeMonth}-${lastDay}`;

        // Fetch all ACTIVE users (Ignore deleted/archived employees)
        const usersResult = await db.query(`
            SELECT id, tenant_id FROM users 
            WHERE COALESCE(is_deleted, false) = false
        `);
        const users = usersResult.rows;

        if (users.length === 0) {
            console.log('No active users found to generate timesheets for.');
            return;
        }

        let count = 0;
        for (const user of users) {
            await db.query(`
                INSERT INTO timesheets (user_id, tenant_id, status, period_start, period_end)
                VALUES ($1, $2, 'PENDING', $3, $4)
            `, [user.id, user.tenant_id, periodStart, periodEnd]);
            count++;
        }

        console.log(`Successfully generated ${count} blank timesheets for ${periodStart} to ${periodEnd}.`);

    } catch (err) {
        console.error('Error auto-generating timesheets:', err);
    }
};

// Runs every day at 9:00 AM
const runDailyTimesheetCheck = async () => {
    console.log('Running daily timesheet check...');
    
    // Stop immediately if it's not the First Monday yet
    if (!isPastFirstMonday()) {
        console.log('Too early in the month. Waiting for the First Monday.');
        return; 
    }

    const today = new Date();
    // Look at LAST month's timesheets
    const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const previousMonthName = lastMonthDate.toLocaleString('default', { month: 'long' });
    
    const targetYear = lastMonthDate.getFullYear();
    const targetMonth = String(lastMonthDate.getMonth() + 1).padStart(2, '0');
    const targetPeriodStart = `${targetYear}-${targetMonth}-01`;

    try {
        const result = await db.query(`
            SELECT t.user_id, t.status, u.first_name, u.email, ten.domain_prefix
            FROM timesheets t
            JOIN users u ON t.user_id = u.id
            JOIN tenants ten ON u.tenant_id = ten.id
            WHERE t.status = $1 AND t.period_start = $2 AND COALESCE(u.is_deleted, false) = false
        `, ['PENDING', targetPeriodStart]); 

        const pendingContractors = result.rows;

        if (pendingContractors.length === 0) {
            console.log(`No pending timesheets found for ${previousMonthName}.`);
            return;
        }

        console.log(`Found ${pendingContractors.length} pending timesheets. Initiating emails...`);

        for (const record of pendingContractors) {
            await sendTimesheetReminder(record.domain_prefix, record.email, record.first_name, previousMonthName);
            await delay(5000); // 5 second pause to protect email reputation
        }

        console.log('Daily email sequence complete.');

    } catch (err) {
        console.error('Error during automated timesheet check:', err);
    }
};

// --- AUTOMATED CRON TIMERS ---

// Fire every day at 9:00 AM Central Time
cron.schedule('0 9 * * *', () => {
    runDailyTimesheetCheck();
}, { timezone: "America/Chicago" });

// Fire on the 1st of every month at midnight Central Time
cron.schedule('0 0 1 * *', () => {
    generateMonthlyTimesheets();
}, { timezone: "America/Chicago" });

console.log('Production Timesheet Scheduler initialized.');