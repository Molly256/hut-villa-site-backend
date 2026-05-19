const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const router = express.Router();

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

function normalizePhone(phone) {
  return phone.replace(/\D/g, ''); // removes + and spaces
}

router.post('/', async (req, res) => {
  try {
    const phoneNumber = normalizePhone(req.body.phoneNumber);
    const amount = Number(req.body.amount);

    if (!phoneNumber || !amount || amount < 10000) {
      return res.status(400).json({ success: false, message: 'Invalid phone or amount' });
    }

    await client.connect();
    const db = client.db('hutvilla');

    const deposit = {
      phoneNumber,
      amount,
      status: 'pending',
      createdAt: new Date()
    };

    const result = await db.collection('deposits').insertOne(deposit);

    res.json({ 
      success: true, 
      message: 'Deposit request sent. Pending confirmation.', 
      deposit: { ...deposit, _id: result.insertedId }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/pending', async (req, res) => {
  try {
    await client.connect();
    const db = client.db('hutvilla');
    const deposits = await db.collection('deposits').find({ status: 'pending' }).toArray();
    res.json(deposits);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;