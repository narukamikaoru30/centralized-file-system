require('dotenv').config();
const connectDB = require('./config/mongo');
const Notification = require('./models/Notification');
const User = require('./models/User');
const File = require('./models/File');

(async () => {
  await connectDB();
  const actor = await User.findOne({ email: 'mk145@gmail.com' }).lean();
  const file = await File.findOne({}).sort({ uploadedAt: -1 }).lean();
  if (!actor || !file) {
    console.log('missing actor/file');
    process.exit(1);
  }

  const message = `${actor.fullname || actor.email} downloaded ${file.originalName || file.filename}`;
  const notification = await Notification.create({
    owner: actor._id,
    relatedFile: file._id,
    relatedUser: actor._id,
    type: 'download',
    message,
    metadata: {
      action: 'download',
      fileId: file._id,
      actorName: actor.fullname || actor.email,
      actorEmail: actor.email,
      fileName: file.originalName || file.filename
    }
  });

  console.log(JSON.stringify({ inserted: true, notificationId: notification._id.toString(), message }, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
