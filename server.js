// hut-villa-site-backend
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 5000;

// 1. ADMIN DETAILS - use 9 digits only, no 256
const ADMIN_PHONE = '753520252'; 
const ADMIN_PASS = 'admin256$';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI;

let db;
let client;

async function connectDB() {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI not set in environment variables');
  }
  
  if (!MONGO_URI.startsWith('mongodb://') && !MONGO_URI.startsWith('mongodb+srv://')) {
    throw new Error('Invalid MONGO_URI format. Must start with mongodb:// or mongodb+srv://');
  }

  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db('hutvilla');
  console.log('Connected to MongoDB');
}

// Connect but don't crash the process
connectDB().catch(err => {
  console.error('MongoDB connection failed:', err.message);
});

// Helper: normalize phone to 12 digits with 256
function normalizePhone(phone) {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  
  // If 9 digits starting with 7, add 256
  if (digits.length === 9 && digits.startsWith('7')) {
    digits = '256' + digits;
  }
  
  return digits;
}

// Admin check middleware
function checkAdmin(req, res, next) {
  const phone = normalizePhone(req.body.phone || req.query.phone || req.headers['x-admin-phone']);
  const password = req.body.password || req.query.password || req.headers['x-admin-password'];

  if (phone === '256' + ADMIN_PHONE && password === ADMIN_PASS) {
    return next();
  }
  
  return res.status(403).json({ error: 'Unauthorized - Admin only' });
}

// Health check route - works even if DB is down
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    db: db ? 'connected' : 'disconnected',
    mongoUriSet: !!MONGO_URI 
  });
});

// DB check middleware for routes that need DB
function checkDB(req, res, next) {
  if (!db) {
    return res.status(500).json({ error: 'Database not connected. Check MONGO_URI in Vercel.' });
  }
  next();
}

// Auth routes
app.post('/api/register', checkDB, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const password = req.body.password;
    
    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone and password required' });
    }

    if (phone.length !== 12 || !phone.startsWith('256')) {
      return res.status(400).json({ error: 'Invalid phone. Use 9 digits starting with 7' });
    }

    const exists = await db.collection('users').findOne({ phoneNumber: phone });
    if (exists) {
      return res.status(400).json({ error: 'Account already exists' });
    }

    await db.collection('users').insertOne({
      phoneNumber: phone,
      password: password,
      role: 'user',
      balance: 0,
      createdAt: new Date()
    });

    res.json({ success: true, message: 'Account created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', checkDB, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const password = req.body.password;

    const user = await db.collection('users').findOne({ 
      phoneNumber: phone, 
      password: password 
    });
    
    if (!user) {
      return res.status(404).json({ error: 'No account found. Please register first.' });
    }

    res.json({ 
      success: true, 
      user: { 
        phoneNumber: user.phoneNumber, 
        balance: user.balance,
        role: user.role || 'user'
      } 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TEMP ROUTE - DELETE AFTER CREATING ADMIN
app.post('/api/auth/create-admin', checkDB, async (req, res) => {
  try {
    let phone = normalizePhone(req.body.phone);
    const password = req.body.password;
    
    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone and password required' });
    }

    const exists = await db.collection('users').findOne({ phoneNumber: phone });
    if (exists) {
      return res.status(400).json({ error: 'Account already exists' });
    }

    await db.collection('users').insertOne({
      phoneNumber: phone,
      password: password,
      role: 'admin',
      balance: 0,
      createdAt: new Date()
    });

    res.json({ success: true, message: 'Admin created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Reset user password
app.post('/api/admin/reset-password', checkAdmin, checkDB, async (req, res) => {
  try {
    const { targetPhone, newPassword } = req.body;
    
    if (!targetPhone || !newPassword) {
      return res.status(400).json({ error: 'targetPhone and newPassword required' });
    }

    const normalizedTarget = normalizePhone(targetPhone);

    const result = await db.collection('users').updateOne(
      { phoneNumber: normalizedTarget },
      { $set: { password: newPassword } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ 
      success: true, 
      message: `Password updated for ${normalizedTarget}` 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ========== Pending Transactions Routes ========== */

// Get all pending deposits and withdrawals
app.get('/api/admin/pending-transactions', checkAdmin, checkDB, async (req, res) => {
  try {
    const deposits = await db.collection('deposits')
      .find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .toArray();
    
    const withdrawals = await db.collection('withdrawals')
      .find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .toArray();
    
    res.json({ success: true, deposits, withdrawals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve or reject a transaction
app.post('/api/admin/approve-transaction', checkAdmin, checkDB, async (req, res) => {
  try {
    const { type, id, action } = req.body;
    
    if (!type || !id || !action) {
      return res.status(400).json({ error: 'type, id, and action are required' });
    }

    const collection = type === 'deposit' ? 'deposits' : 'withdrawals';
    const transaction = await db.collection(collection).findOne({ _id: new ObjectId(id) });
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (transaction.status !== 'pending') {
      return res.status(400).json({ error: 'Transaction already processed' });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    
    await db.collection(collection).updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: newStatus, processedAt: new Date() } }
    );
    
    if (action === 'approve' && type === 'deposit') {
      await db.collection('users').updateOne(
        { phoneNumber: transaction.phoneNumber },
        { $inc: { balance: transaction.amount } }
      );
    }
    
    if (action === 'approve' && type === 'withdrawal') {
      await db.collection('users').updateOne(
        { phoneNumber: transaction.phoneNumber },
        { $inc: { balance: -transaction.amount } }
      );
    }
    
    res.json({ success: true, message: `Transaction ${newStatus}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add your other routes below this point

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;