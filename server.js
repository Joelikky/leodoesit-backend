const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./db'); 

// --- ADD THE SCHEDULER RIGHT HERE ---
require('./scheduler');
// ------------------------------------

const app = express();

// 🔥 Secure CORS Policy for Production
app.use(cors({
  origin: [
    'http://localhost:5173',                  // Your local Vite React server
    'https://leodoesit-frontend.vercel.app'   // 🔥 YOUR EXACT VERCEL URL
  ],
  credentials: true
}));

app.use(express.json());

// ✅ NEW: Added a root route to prevent "Cannot GET /" errors
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
// In local development, app.listen works. In Vercel, we must export the app.
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app; // 🚀 Required for Vercel deployment