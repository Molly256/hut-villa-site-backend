const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function createAdmin() {
  const phone = '0753520252';
  const password = 'admin256';
  
  const hashedPassword = await bcrypt.hash(password, 10);
  
  const { data, error } = await supabase
    .from('users')
    .upsert({ 
      phonenumber: phone, 
      password: hashedPassword, 
      role: 'admin',
      balance: 0 
    }, { onConflict: 'phonenumber' })
    .select();

  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('Admin created/updated successfully:', data);
  }
}

createAdmin();