const cron = require('node-cron');
const db = require('./db'); 
const { sendTimesheetReminder, sendBalanceReminderEmail } = require('./utils/mailer');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Checks if today is past the first Monday of the month (Original Logic)
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

// Runs on the 1st of every month (Original Logic)
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

// Runs every day at 9:00 AM (Updated: Inner try/catch added)
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

        // CHANGED: Try/Catch moved inside the loop to prevent crashes if one email fails
        for (const record of pendingContractors) {
            try {
                await sendTimesheetReminder(record.domain_prefix, record.email, record.first_name, previousMonthName);
                await delay(3000); // 3 second pause to protect email reputation
            } catch (emailErr) {
                console.error(`Failed to send reminder to ${record.email}:`, emailErr);
            }
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

// Runs every day at 8:00 AM to chase unpaid client invoices (Updated: Midnight math & inner try/catch)
cron.schedule('0 8 * * *', async () => {
    console.log('🔍 Running Daily Payment Chase Engine...');

    try {
        // Find all unpaid invoices and join with client details
        const result = await db.query(`
            SELECT 
                i.id AS invoice_id, i.amount_invoiced, i.created_at, i.tenant_id,
                c.company_name, c.billing_email, c.net_terms,
                t.domain_prefix
            FROM invoices i
            JOIN clients c ON i.client_id = c.id
            JOIN tenants t ON i.tenant_id = t.id
            WHERE i.status = 'UNPAID' AND c.billing_email IS NOT NULL
        `);
        
        const unpaidInvoices = result.rows;

        if (unpaidInvoices.length === 0) {
            console.log('No unpaid past-due invoices found today.');
            return;
        }

        // CHANGED: Standardize "Today" to exactly midnight for flawless math
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const invoice of unpaidInvoices) {
            // Extract the number from "Net 30", default to 30 days if blank
            const termsString = invoice.net_terms || 'Net 30';
            const termDays = parseInt(termsString.replace(/\D/g, '')) || 30; 

            // CHANGED: Standardize "Due Date" to exactly midnight
            const createdAt = new Date(invoice.created_at);
            const dueDate = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate() + termDays);
            dueDate.setHours(0, 0, 0, 0);

            // If today is past the due date, calculate how many days late it is
            if (today > dueDate) {
                // CHANGED: Use strictly floored integer math based on the midnight timestamps
                const diffTime = today.getTime() - dueDate.getTime();
                const daysLate = Math.floor(diffTime / (1000 * 60 * 60 * 24)); 

                // We send reminder emails exactly 1 day, 5 days, and 10 days after it is late
                if (daysLate === 1 || daysLate === 5 || daysLate === 10) {
                    console.log(`Sending past-due notice to ${invoice.company_name} for Invoice #${invoice.invoice_id} (${daysLate} days late)`);
                    
                    // CHANGED: Inner try/catch to protect the loop
                    try {
                        await sendBalanceReminderEmail(
                            invoice.domain_prefix,
                            invoice.billing_email,
                            invoice.company_name, 
                            invoice.invoice_id,
                            invoice.amount_invoiced
                        );
                        await delay(3000); 
                    } catch (emailErr) {
                        console.error(`Failed to send to ${invoice.company_name}:`, emailErr);
                    }
                }
            }
        }
        console.log('Payment Chase Engine complete.');
    } catch (error) {
        console.error('❌ Error in Payment Chase Engine:', error.message);
    }
}, { timezone: "America/Chicago" });

console.log('Production Timesheet Scheduler initialized.');