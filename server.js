require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { supabase } = require('./supabaseClient');

const app = express();
const PORT = process.env.PORT || 5000;

const ADMIN_PHONE = process.env.ADMIN_PHONE; 
const ADMIN_PASS = process.env.ADMIN_PASS;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Admin check - exact match only
async function checkAdmin(req, res, next) {
  const phone = (req.headers['x-admin-phone'] || '').trim();
  const password = (req.headers['x-admin-password'] || '').trim();

  if (phone === ADMIN_PHONE && password === ADMIN_PASS) {
    return next();
  }
  return res.status(403).json({ error: 'Unauthorized - Admin only' });
}

// User auth middleware
async function checkUser(req, res, next) {
  const phone = req.headers['x-user-phone'];
  if (!phone) return res.status(401).json({ error: 'User phone required' });
  
  const { data: user } = await supabase
    .from('users')
    .select('phonenumber, role, balance')
    .eq('phonenumber', phone)
    .single();
    
  if (!user) return res.status(401).json({ error: 'User not found' });
  
  req.user = user;
  next();
}

// 1. Register
app.post('/api/register', async (req, res) => {
  try {
    const phone = req.body.phoneNumber;
    const password = req.body.password;
    
    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone and password required' });
    }

    const { data: exists } = await supabase
      .from('users')
      .select('phonenumber')
      .eq('phonenumber', phone)
      .maybeSingle();

    if (exists) {
      return res.status(400).json({ error: 'Account already exists' });
    }

    const hashedPass = await bcrypt.hash(password, 10);

    const { error } = await supabase
      .from('users')
      .insert([{ phonenumber: phone, password: hashedPass, role: 'user', balance: 0 }]);

    if (error) throw error;

    res.json({ success: true, message: 'Account created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Login
app.post('/api/login', async (req, res) => {
  try {
    const phone = req.body.phoneNumber;
    const password = req.body.password;

    const { data: user, error } = await supabase
      .from('users')
      .select('phonenumber, password, balance, role')
      .eq('phonenumber', phone)
      .maybeSingle();
    
    if (error) throw error;
    if (!user) return res.status(404).json({ error: 'No account found. Please register first.' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    res.json({ 
      success: true, 
      user: { phoneNumber: user.phonenumber, balance: user.balance, role: user.role } 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Dashboard - for Dashboard.js
app.post('/api/dashboard', checkUser, async (req, res) => {
  try {
    const phone = req.user.phonenumber;
    
    const { data: referrals } = await supabase
      .from('users')
      .select('id')
      .eq('referred_by', phone);

    res.json({ 
      success: true,
      balance: req.user.balance,
      team_count: referrals ? referrals.length : 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Modify Password - for ModifyPassword.js
app.post('/api/modify-password', checkUser, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const phone = req.user.phonenumber;

    const { data: user } = await supabase
      .from('users')
      .select('password')
      .eq('phonenumber', phone)
      .single();

    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Old password incorrect' });

    const hashedPass = await bcrypt.hash(newPassword, 10);
    await supabase.from('users').update({ password: hashedPass }).eq('phonenumber', phone);

    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Update Bank Info - for BankInfo.js
app.post('/api/update-bank', checkUser, async (req, res) => {
  try {
    const { bank_name, account_number, account_name } = req.body;
    const phone = req.user.phonenumber;

    const { error } = await supabase
      .from('users')
      .update({ bank_name, account_number, account_name })
      .eq('phonenumber', phone);

    if (error) throw error;
    res.json({ success: true, message: 'Bank info updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Get Huts - for VipTask.js
app.get('/api/huts', async (req, res) => {
  try {
    const { data: huts } = await supabase
      .from('huts')
      .select('*')
      .order('price', { ascending: true });

    res.json({ success: true, huts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Rent Hut - for VipTask.js
app.post('/api/rent-hut', checkUser, async (req, res) => {
  try {
    const { hut_id } = req.body;
    const phone = req.user.phonenumber;

    const { data: hut } = await supabase.from('huts').select('*').eq('id', hut_id).single();
    if (!hut) return res.status(404).json({ error: 'Hut not found' });
    if (req.user.balance < hut.price) return res.status(400).json({ error: 'Insufficient balance' });

    await supabase.from('users').update({ balance: req.user.balance - hut.price }).eq('phonenumber', phone);
    
    await supabase.from('rentals').insert([{ 
      phonenumber: phone, 
      hut_id, 
      status: 'active',
      start_time: new Date()
    }]);

    res.json({ success: true, message: 'Hut rented' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Collect Hut Income - for VipTask.js
app.post('/api/collect-hut', checkUser, async (req, res) => {
  try {
    const { rental_id } = req.body;
    const phone = req.user.phonenumber;

    const { data: rental } = await supabase.from('rentals').select('*').eq('id', rental_id).single();
    if (!rental || rental.phonenumber !== phone) return res.status(404).json({ error: 'Rental not found' });

    const income = rental.daily_income || 0;
    await supabase.from('users').update({ balance: req.user.balance + income }).eq('phonenumber', phone);

    res.json({ success: true, amount: income });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Deposit
app.post('/api/deposit', checkUser, async (req, res) => {
  try {
    const { amount } = req.body;
    const phone = req.user.phonenumber;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount required' });
    }

    const { error } = await supabase
      .from('deposits')
      .insert([{ phonenumber: phone, amount: parseFloat(amount), status: 'pending' }]);

    if (error) throw error;

    res.json({ success: true, message: 'Deposit request submitted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Withdraw
app.post('/api/withdraw', checkUser, async (req, res) => {
  try {
    const { amount } = req.body;
    const phone = req.user.phonenumber;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount required' });
    }

    if (req.user.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const { error } = await supabase
      .from('withdrawals')
      .insert([{ phonenumber: phone, amount: parseFloat(amount), status: 'pending' }]);

    if (error) throw error;

    res.json({ success: true, message: 'Withdrawal request submitted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. History - for Bill.js
app.post('/api/history', checkUser, async (req, res) => {
  try {
    const phone = req.user.phonenumber;
    const { type } = req.body;

    let query = supabase.from(type).select('*').eq('phonenumber', phone).order('created_at', { ascending: false }).limit(20);
    
    const { data } = await query;
    res.json({ success: true, history: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset password
app.post('/api/reset-password', async (req, res) => {
  try {
    const phone = req.body.phoneNumber;
    const { newPassword } = req.body;
    
    if (!phone || !newPassword) {
      return res.status(400).json({ error: 'Phone and new password required' });
    }

    const hashedPass = await bcrypt.hash(newPassword, 10);

    const { error } = await supabase
      .from('users')
      .update({ password: hashedPass })
      .eq('phonenumber', phone);

    if (error) throw error;

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user data
app.get('/api/user/data', checkUser, async (req, res) => {
  try {
    const phone = req.user.phonenumber;
    
    const { data: deposits } = await supabase
      .from('deposits')
      .select('*')
      .eq('phonenumber', phone)
      .order('created_at', { ascending: false })
      .limit(10);
      
    const { data: withdrawals } = await supabase
      .from('withdrawals')
      .select('*')
      .eq('phonenumber', phone)
      .order('created_at', { ascending: false })
      .limit(10);
    
    res.json({ 
      success: true, 
      balance: req.user.balance,
      deposits,
      withdrawals 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin routes
app.post('/api/admin/reset-password', checkAdmin, async (req, res) => {
  try {
    const { targetPhone, newPassword } = req.body;
    if (!targetPhone || !newPassword) {
      return res.status(400).json({ error: 'targetPhone and newPassword required' });
    }

    const hashedPass = await bcrypt.hash(newPassword, 10);

    const { error } = await supabase
      .from('users')
      .update({ password: hashedPass })
      .eq('phonenumber', targetPhone);

    if (error) throw error;
    res.json({ success: true, message: `Password updated for ${targetPhone}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/pending-transactions', checkAdmin, async (req, res) => {
  try {
    const { data: deposits } = await supabase
      .from('deposits')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    const { data: withdrawals } = await supabase
      .from('withdrawals')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    
    res.json({ success: true, deposits, withdrawals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/approve-transaction', checkAdmin, async (req, res) => {
  try {
    const { type, id, action } = req.body;
    if (!type || !id || !action) {
      return res.status(400).json({ error: 'type, id, and action are required' });
    }

    const table = type === 'deposit' ? 'deposits' : 'withdrawals';
    const { data: transaction, error: fetchError } = await supabase
      .from(table)
      .select('*')
      .eq('id', id)
      .single();
    
    if (fetchError) throw fetchError;
    if (transaction.status !== 'pending') {
      return res.status(400).json({ error: 'Transaction already processed' });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const { error: updateError } = await supabase
      .from(table)
      .update({ status: newStatus, processed_at: new Date() })
      .eq('id', id);
    
    if (updateError) throw updateError;
    
    if (action === 'approve') {
      const { data: user } = await supabase
        .from('users')
        .select('balance')
        .eq('phonenumber', transaction.phonenumber)
        .single();
      
      const newBalance = type === 'deposit' 
        ? (user.balance || 0) + transaction.amount 
        : (user.balance || 0) - transaction.amount;

      await supabase
        .from('users')
        .update({ balance: newBalance })
        .eq('phonenumber', transaction.phonenumber);
    }
    
    res.json({ success: true, message: `Transaction ${newStatus}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run server locally, but export for Vercel
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;