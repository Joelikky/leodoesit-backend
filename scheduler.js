const cron = require('node-cron');
const db = require('./db'); 
const { sendTimesheetReminder, sendBalanceReminderEmail } = require('./utils/mailer');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// 1. THE DAILY TIMESHEET CHASER
// Runs every day at 9:00 AM to automatically email anyone "MISSING" a timesheet
// ============================================================================
const runDailyTimesheetCheck = async () => {
    console.log('🔍 Running Daily Missing Timesheet Chase...');
    
    const today = new Date();
    
    // We want to chase timesheets for LAST month
    const targetDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const monthName = targetDate.toLocaleString('default', { month: 'long' });
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(year, targetDate.getMonth() + 1, 0).getDate();

    const startOfMonth = `${year}-${month}-01`;
    const endOfMonth = `${year}-${month}-${lastDay}`;

    try {
        // 1. Get ALL Active Contractors (Ignore Admins, Deleted users, AND Inactive users)
        const usersRes = await db.query(`
            SELECT u.id, u.first_name, u.email, ten.domain_prefix
            FROM users u
            JOIN tenants ten ON u.tenant_id = ten.id
            WHERE COALESCE(u.is_deleted, false) = false
            AND COALESCE(u.is_active, true) = true
            AND u.role != 'ADMIN'
        `);
        const activeContractors = usersRes.rows;

        // 2. Get ALL timesheets submitted for the target month
        const tsRes = await db.query(`
            SELECT user_id 
            FROM timesheets 
            WHERE period_start >= $1 AND period_start <= $2
        `, [startOfMonth, endOfMonth]);
        
        // Create a simple array of User IDs who HAVE submitted
        const submittedUserIds = tsRes.rows.map(ts => ts.user_id);

        // 3. Find the MISSING contractors (Active contractors NOT in the submitted list)
        const missingContractors = activeContractors.filter(user => !submittedUserIds.includes(user.id));

        if (missingContractors.length === 0) {
            console.log(`✅ Awesome! Everyone has submitted their timesheet for ${monthName}.`);
            return;
        }

        console.log(`⚠️ Found ${missingContractors.length} contractors missing timesheets for ${monthName}. Sending automated reminders...`);

        // 4. Fire the emails!
        for (const user of missingContractors) {
            try {
                console.log(`➡️ Emailing reminder to: ${user.first_name} (${user.email})`);
                await sendTimesheetReminder(user.domain_prefix, user.email, user.first_name, monthName);
                await delay(3000); // 3 second pause to protect your email sender reputation
            } catch (emailErr) {
                console.error(`❌ Failed to send reminder to ${user.email}:`, emailErr);
            }
        }

        console.log('Daily timesheet chase complete.');

    } catch (err) {
        console.error('❌ Error during automated timesheet check:', err);
    }
};


// ============================================================================
// CRON TIMERS
// ============================================================================

// 🕒 Fire every day at 9:00 AM Central Time (Chases Missing Timesheets)
cron.schedule('0 9 * * *', () => {
    runDailyTimesheetCheck();
}, { timezone: "America/Chicago" });


// 🕒 Fire every day at 8:00 AM Central Time (Chases Unpaid Client Invoices)
cron.schedule('0 8 * * *', async () => {
    console.log('🔍 Running Daily Payment Chase Engine...');

    try {
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
            console.log('✅ No unpaid past-due invoices found today.');
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const invoice of unpaidInvoices) {
            const termsString = invoice.net_terms || 'Net 30';
            const termDays = parseInt(termsString.replace(/\D/g, '')) || 30; 

            const createdAt = new Date(invoice.created_at);
            const dueDate = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate() + termDays);
            dueDate.setHours(0, 0, 0, 0);

            if (today > dueDate) {
                const diffTime = today.getTime() - dueDate.getTime();
                const daysLate = Math.floor(diffTime / (1000 * 60 * 60 * 24)); 

                if (daysLate === 1 || daysLate === 5 || daysLate === 10) {
                    console.log(`Sending past-due notice to ${invoice.company_name} for Invoice #${invoice.invoice_id} (${daysLate} days late)`);
                    
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

console.log('✅ Production Scheduler initialized. Timesheet and Invoice chasers are active.');