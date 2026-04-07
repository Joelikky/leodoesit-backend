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
