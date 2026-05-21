// createAdmin.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI not found in .env file');
  process.exit(1);
}

// Use this if you don't have a User model yet
const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  name: { type: String }
});

const User = mongoose.model('User', userSchema);

async function createAdmin() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const adminPhone = '256753185973';
    const adminPassword = 'admin2026$';

    // Delete existing admin with this phone if it exists
    await User.deleteOne({ phone: adminPhone, role: 'admin' });
    console.log('🧹 Removed any existing admin with that phone');

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);

    // Create admin
    const admin = await User.create({
      phone: adminPhone,
      password: hashedPassword,
      role: 'admin',
      name: 'Super Admin'
    });

    console.log('✅ Admin user created successfully:');
    console.log(`Phone: ${admin.phone}`);
    console.log(`Password: ${adminPassword}`);
    console.log('\n⚠️ Change the password after first login');

  } catch (err) {
    console.error('❌ Error creating admin:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

createAdmin();