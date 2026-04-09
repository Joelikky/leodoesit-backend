const cron = require('node-cron');
const db = require('./db'); 
const { sendTimesheetReminder } = require('./utils/mailer');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

        // UPDATE: We now fetch the user's ID AND their tenant_id
        const usersResult = await db.query(`SELECT id, tenant_id FROM users`);
        const users = usersResult.rows;

        if (users.length === 0) {
            console.log('No users found to generate timesheets for.');
            return;
        }

        let count = 0;
        for (const user of users) {
            // UPDATE: We insert the tenant_id into the new timesheet so it stays in the right portal
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

const runDailyTimesheetCheck = async () => {
    console.log('Running daily timesheet check...');
    
    if (!isPastFirstMonday()) {
        console.log('Too early in the month. Waiting for the First Monday.');
        return; 
    }

    const today = new Date();
    const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const previousMonthName = lastMonthDate.toLocaleString('default', { month: 'long' });
    
    const targetYear = lastMonthDate.getFullYear();
    const targetMonth = String(lastMonthDate.getMonth() + 1).padStart(2, '0');
    const targetPeriodStart = `${targetYear}-${targetMonth}-01`;

    try {
        // UPDATE: We use a JOIN to grab the domain_prefix from the tenants table
        const result = await db.query(`
            SELECT t.user_id, t.status, u.first_name, u.email, ten.domain_prefix
            FROM timesheets t
            JOIN users u ON t.user_id = u.id
            JOIN tenants ten ON u.tenant_id = ten.id
            WHERE t.status = $1 AND t.period_start = $2
        `, ['PENDING', targetPeriodStart]); 

        const pendingContractors = result.rows;

        if (pendingContractors.length === 0) {
            console.log(`No pending timesheets found for ${previousMonthName}.`);
            return;
        }

        console.log(`Found ${pendingContractors.length} pending timesheets. Initiating emails...`);

        for (const record of pendingContractors) {
            // UPDATE: We pass the domain_prefix (leodoesit or gandiva) to the mailer!
            await sendTimesheetReminder(record.domain_prefix, record.email, record.first_name, previousMonthName);
            await delay(5000); 
        }

        console.log('Daily email sequence complete.');

    } catch (err) {
        console.error('Error during automated timesheet check:', err);
    }
};

cron.schedule('0 9 * * *', () => {
    runDailyTimesheetCheck();
}, { timezone: "America/Chicago" });

cron.schedule('0 0 1 * *', () => {
    generateMonthlyTimesheets();
}, { timezone: "America/Chicago" });

console.log('Timesheet Scheduler initialized.');