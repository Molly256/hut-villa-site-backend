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

// Helper: keep phone as 10 digits starting with 0
function normalizePhone(phone) {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  
  // If user types 753520252, make it 0753520252
  if (digits.length === 9 && digits.startsWith('7')) {
    digits = '0' + digits;
  }
  
  return digits;
}

// Admin check - direct compare, 10 digits only
async function checkAdmin(req, res, next) {
  const phone = (req.headers['x-admin-phone'] || '').trim();
  const password = (req.headers['x-admin-password'] || '').trim();

  console.log('--- Admin Check ---');
  console.log('Received:', `"${phone}"`);
  console.log('Env:', `"${ADMIN_PHONE}"`);
  console.log('Match?', phone === ADMIN_PHONE && password === ADMIN_PASS);

  if (phone === ADMIN_PHONE && password === ADMIN_PASS) {
    return next();
  }
  
  return res.status(403).json({ error: 'Unauthorized - Admin only' });
}

// Register - stores 10 digits
app.post('/api/register', async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phoneNumber);
    const password = req.body.password;
    
    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone and password required' });
    }

    if (phone.length !== 10 || !phone.startsWith('0')) {
      return res.status(400).json({ error: 'Invalid phone. Use 10 digits starting with 0' });
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

// Login - uses 10 digits
app.post('/api/login', async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phoneNumber);
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

    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access only' });
    }

    res.json({ 
      success: true, 
      user: { phoneNumber: user.phonenumber, balance: user.balance, role: user.role } 
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

    const normalizedTarget = normalizePhone(targetPhone);
    const hashedPass = await bcrypt.hash(newPassword, 10);

    const { error } = await supabase
      .from('users')
      .update({ password: hashedPass })
      .eq('phonenumber', normalizedTarget);

    if (error) throw error;
    res.json({ success: true, message: `Password updated for ${normalizedTarget}` });
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;