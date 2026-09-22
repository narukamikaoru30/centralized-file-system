require('dotenv').config();
const bcrypt = require('bcrypt');
const connectDB = require('./config/mongo');
const User = require('./models/User');

(async () => {
  await connectDB();
  const email = 'mk145@gmail.com';
  const newPassword = 'Mk145@2026!';
  const hash = await bcrypt.hash(newPassword, 12);
  await User.updateOne({ email }, { $set: { password: hash, failedLoginAttempts: 0, lockUntil: null } });
  const user = await User.findOne({ email }).lean();
  const matches = await bcrypt.compare(newPassword, user.password);
  console.log(JSON.stringify({ email, updated: true, matches, password: newPassword }, null, 2));
  process.exit(matches ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
