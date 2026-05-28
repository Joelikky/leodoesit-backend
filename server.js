const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./db'); 

// --- ADD THE SCHEDULER RIGHT HERE ---
require('./scheduler');
// ------------------------------------

const app = express();

// 🔥 FIX 1: Enforce Native CORS Handshaking at the ABSOLUTE Top of the Stack
// This automatically captures and intercepts browser OPTIONS requests cleanly.
app.use(cors({
  origin: [
    'http://localhost:5173',                  // Your local Vite React server
    'https://leodoesit-frontend.vercel.app'   // 🔥 Your exact frontend Vercel production URL
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'], // Whitelists your custom tenant headers
  credentials: true,
  optionsSuccessStatus: 200 // Forces legacy browser preflights to resolve with a clean 200 OK
}));

// 🔥 FIX 2: Double-Layer Fallback Interceptor
// Ensures that if any serverless container skips the native cors pool, headers remain locked.
app.use((req, res, next) => {
    const allowedOrigins = ['http://localhost:5173', 'https://leodoesit-frontend.vercel.app'];
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tenant-id');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Parse body content safely
app.use(express.json());

// ✅ Root route to confirm API status
app.get('/', (req, res) => {
    res.send('🚀 Leodoesit Backend API is awake and running on Vercel!');
});

// --- ROUTES ---
const userRoutes = require('./routes/users');
app.use('/api/users', userRoutes);

const timesheetRoutes = require('./routes/timesheets');
app.use('/api/timesheets', timesheetRoutes);

const clientRoutes = require('./routes/clients');
app.use('/api/clients', clientRoutes);

const invoiceRoutes = require('./routes/invoices');
app.use('/api/invoices', invoiceRoutes);

const subVendorRoutes = require('./routes/subVendors');
app.use('/api/sub_vendors', subVendorRoutes);

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

// 🔥 VERCEL COMPATIBILITY:
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app; // 🚀 Required for Vercel deployment