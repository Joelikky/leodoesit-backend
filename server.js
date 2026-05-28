const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./db'); 

const app = express();

// 🔥 FIX 1: CONDITIONAL SCHEDULER INITIALIZATION
// Prevents the background loop engine from hijacking and killing Vercel serverless functions.
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    try {
        require('./scheduler');
        console.log('✅ Local Scheduler initialized successfully.');
    } catch (e) {
        console.error('Failed to load local scheduler:', e);
    }
} else {
    console.log('ℹ️ Running in Serverless/Production environment. Background cron thread safely deferred.');
}

// 🔥 FIX 2: Explicit Top-Tier Preflight Interceptor Middleware
app.use((req, res, next) => {
    const allowedOrigins = ['http://localhost:5173', 'https://leodoesit-frontend.vercel.app'];
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-tenant-id');

    // Intercept OPTIONS requests instantly before they touch routers or middleware
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200); 
    }
    next();
});

// Standard library middleware rules
app.use(cors({
  origin: ['http://localhost:5173', 'https://leodoesit-frontend.vercel.app'],
  credentials: true
}));

app.use(express.json());

// Base diagnostic endpoint
app.get('/', (req, res) => {
    res.send('🚀 Leodoesit Backend API is awake and running on Vercel!');
});

// --- ROUTES ---
app.use('/api/users', require('./routes/users'));
app.use('/api/timesheets', require('./routes/timesheets'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/sub_vendors', require('./routes/subVendors'));
app.use('/api/auth', require('./routes/auth'));

// --- Update W2 Compliance Documents ---
app.put('/api/contractors/:id/compliance', async (req, res) => {
  const { id } = req.params;
  const { i9_completed, w4_completed, everify_completed, bank_details_completed } = req.body;
  
  try {
      const result = await db.query(
          `UPDATE employee_details 
            SET i9_completed = $1, 
                w4_completed = $2, 
                everify_completed = $3, 
                bank_details_completed = $4
            WHERE user_id = $5 
            RETURNING *`,
          [i9_completed, w4_completed, everify_completed, bank_details_completed, id]
      );
      
      if (result.rows.length === 0) {
          return res.status(404).json({ success: false, message: 'Contractor not found' });
      }
      
      res.json({ success: true, data: result.rows[0] });
  } catch (err) {
      console.error("Error updating compliance:", err);
      res.status(500).json({ success: false, error: 'Failed to update compliance records' });
  }
});

app.get('/api/test-db', async (req, res) => {
  try {
    const result = await db.query('SELECT NOW()');
    res.json({ 
      success: true, 
      message: "Supabase connection successful! The Leodoes It engine is live.", 
      time: result.rows[0].now 
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: "Database connection failed" });
  }
});

// Local dev engine fallback loop
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;