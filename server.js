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
if (!MONGO_URI) {
  console.error('MONGO_URI not set in environment variables');
  process.exit(1);
}

const client = new MongoClient(MONGO_URI);
let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db('hutvilla');
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection failed:', err);
    process.exit(1);
  }
}

// Helper: normalize phone to 12 digits with 256
function normalizePhone(phone) {
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

// Auth routes
app.post('/api/register', async (req, res) => {
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

app.post('/api/login', async (req, res) => {
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
app.post('/api/auth/create-admin', async (req, res) => {
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

// ... keep all your other routes exactly as they are below this point
// Deposit routes, withdrawal routes, balance, transactions, admin routes