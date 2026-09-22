const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

async function inspectUsers() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/centralize_file_system');
    console.log('Connected to MongoDB');
    
    const users = await User.find({});
    console.log(`\nTotal users: ${users.length}\n`);
    
    users.forEach(user => {
      console.log(`Email: ${user.email}`);
      console.log(`  Role: ${user.role}`);
      console.log(`  Branch: ${user.branch || 'none'}`);
      console.log(`  Active: ${user.active}`);
      console.log('  ---');
    });
    
    await mongoose.connection.close();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

inspectUsers();
