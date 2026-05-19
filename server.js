// hut-villa-site-backend
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // serves files from /public folder

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

// Helper: normalize phone to remove +, spaces, dashes
function normalizePhone(phone) {
  return phone.replace(/\D/g, '');
}

// 1. User creates a deposit request
app.post('/api/deposit', async (req, res) => {
  try {
    const phoneNumber = normalizePhone(req.body.phoneNumber);
    const amount = Number(req.body.amount);
    
    if (!phoneNumber || !amount) {
      return res.status(400).json({ error: 'Phone number and amount required' });
    }
    
    const deposit = {
      phoneNumber,
      amount,
      status: 'pending',
      createdAt: new Date()
    };
    
    const result = await db.collection('deposits').insertOne(deposit);
    deposit._id = result.insertedId;
    
    res.json({ success: true, message: 'Deposit request sent. Pending confirmation.', deposit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. View all pending deposits
app.get('/api/deposits/pending', async (req, res) => {
  try {
    const pending = await db.collection('deposits').find({ status: 'pending' }).toArray();
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Confirm a deposit - adds money to user balance
app.post('/api/deposit/confirm/:id', async (req, res) => {
  try {
    const deposit = await db.collection('deposits').findOne({ 
      _id: new ObjectId(req.params.id),
      status: 'pending'
    });
    
    if (!deposit) {
      return res.status(404).json({ error: 'Deposit not found or already confirmed' });
    }
    
    await db.collection('deposits').updateOne(
      { _id: deposit._id },
      { $set: { status: 'confirmed' } }
    );
    
    const user = await db.collection('users').findOneAndUpdate(
      { phoneNumber: deposit.phoneNumber },
      { $inc: { balance: deposit.amount } },
      { upsert: true, returnDocument: 'after' }
    );
    
    res.json({ success: true, message: 'Deposit confirmed', user: user.value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. User creates a withdrawal request
app.post('/api/withdraw', async (req, res) => {
  try {
    const phoneNumber = normalizePhone(req.body.phoneNumber);
    const amount = Number(req.body.amount);
    
    if (!phoneNumber || !amount) {
      return res.status(400).json({ error: 'Phone number and amount required' });
    }
    
    const user = await db.collection('users').findOne({ phoneNumber });
    
    if (!user || user.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    const withdrawal = {
      phoneNumber,
      amount,
      details: req.body.details || '',
      status: 'pending',
      createdAt: new Date()
    };
    
    await db.collection('withdrawals').insertOne(withdrawal);
    
    res.json({ success: true, message: 'Withdrawal request sent. Pending confirmation.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. View all pending withdrawals
app.get('/api/withdrawals/pending', async (req, res) => {
  try {
    const pending = await db.collection('withdrawals').find({ status: 'pending' }).toArray();
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Confirm a withdrawal - deducts money from user balance
app.post('/api/withdraw/confirm/:id', async (req, res) => {
  try {
    const withdrawal = await db.collection('withdrawals').findOne({ 
      _id: new ObjectId(req.params.id),
      status: 'pending'
    });
    
    if (!withdrawal) {
      return res.status(404).json({ error: 'Withdrawal not found or already confirmed' });
    }
    
    await db.collection('withdrawals').updateOne(
      { _id: withdrawal._id },
      { $set: { status: 'confirmed' } }
    );
    
    const user = await db.collection('users').findOneAndUpdate(
      { phoneNumber: withdrawal.phoneNumber },
      { $inc: { balance: -withdrawal.amount } },
      { returnDocument: 'after' }
    );
    
    res.json({ success: true, message: 'Withdrawal confirmed', user: user.value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Check user balance by phone number
app.get('/api/balance/:phoneNumber', async (req, res) => {
  try {
    const phoneNumber = normalizePhone(req.params.phoneNumber);
    const user = await db.collection('users').findOne({ phoneNumber });
    res.json({ balance: user ? user.balance : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Get all transactions for a user
app.get('/api/transactions/:phone', async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    
    const deposits = await db.collection('deposits')
      .find({ phoneNumber: phone })
      .toArray();
      
    const withdrawals = await db.collection('withdrawals')
      .find({ phoneNumber: phone })
      .toArray();

    const all = [
      ...deposits.map(d => ({
        ...d,
        type: 'Deposit',
        amount: d.amount,
        status: d.status,
        timestamp: d.createdAt
      })),
      ...withdrawals.map(w => ({
        ...w,
        type: 'Withdrawal', 
        amount: w.amount,
        status: w.status,
        timestamp: w.createdAt
      }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server after DB connects
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`hut-villa-site-backend running on port ${PORT}`);
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await client.close();
  process.exit(0);
});