const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./db'); 

// --- ADD THE SCHEDULER RIGHT HERE ---
require('./scheduler');
// ------------------------------------

const app = express();

app.use(cors());
app.use(express.json());


const path = require('path');

// Tell Express to serve the 'uploads' folder publicly so React can see the images!
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- WE ADDED THESE TWO LINES ---
const userRoutes = require('./routes/users');
app.use('/api/users', userRoutes);
// --------------------------------

const timesheetRoutes = require('./routes/timesheets');
app.use('/api/timesheets', timesheetRoutes);
// ---------------------------

// --- ADD THESE TWO LINES ---
const clientRoutes = require('./routes/clients');
app.use('/api/clients', clientRoutes);
// ---------------------------

// --- ADD THESE TWO LINES ---
const invoiceRoutes = require('./routes/invoices');
app.use('/api/invoices', invoiceRoutes);
// ---------------------------

app.use('/api/auth', require('./routes/auth'));

// --- NEW: Update W2 Compliance Documents ---
app.put('/api/contractors/:id/compliance', async (req, res) => {
  const { id } = req.params;
  const { i9_completed, w4_completed, everify_completed, bank_details_completed } = req.body;
  
  try {
      // 🔥 Make sure this updates employee_details, not users!
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
// -------------------------------------------

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
