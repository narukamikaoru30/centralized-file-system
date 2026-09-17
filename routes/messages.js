const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');  // 🔐 Fix #11: For ObjectId validation
const rateLimit = require('express-rate-limit');  // 🔐 Fix #12: For presence rate limiting
const User = require('../models/User');
const Message = require('../models/Message');
const File = require('../models/File');
const { requireActor } = require('../middleware/authMiddleware');
const { requireActive, requireRole } = require('../middleware/roleMiddleware');
const logger = require('../utils/logger');

// POST /messages/send
// body: { toEmail, text, attachmentFileId? }
router.post(
  '/send',
  requireActor({ mode: 'json', notFoundMessage: 'User not found' }),
  requireActive({ mode: 'json' }),
  requireRole(['user', 'admin', 'super_admin'], { mode: 'json' }),
  async (req, res) => {
  try {
    const { toEmail, text, attachmentFileId } = req.body;
    if (!toEmail || !text) return res.status(400).json({ success: false, message: 'Missing fields' });

    const from = req.actor;
    const to = await User.findOne({ email: toEmail });
    if (!from || !to) return res.status(404).json({ success: false, message: 'User(s) not found' });

    const msgData = { from: from._id, to: to._id, text };

    // Attach file from uploads if provided
    if (attachmentFileId) {
      // 🔐 Fix #11: Validate file ID format and existence
      if (!mongoose.Types.ObjectId.isValid(attachmentFileId)) {
        return res.status(400).json({ success: false, message: 'Invalid file ID format' });
      }
      const file = await File.findOne({
        _id: attachmentFileId,
        owner: from._id,
        deleted: { $ne: true }
      });
      if (!file) {
        return res.status(404).json({ success: false, message: 'File not found or not accessible' });
      }
      msgData.attachment = {
        fileId: file._id,
        filename: file.filename,
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes
      };
    }

    const msg = new Message(msgData);
    await msg.save();
    // emit real-time event if socket.io is available
    try {
      const io = req.app.get('io');
      if (io) {
        // emit to recipient room (use email as room)
        io.to(to.email).emit('message', {
          _id: msg._id,
          from: { _id: from._id, fullname: from.fullname, email: from.email },
          to: { _id: to._id, fullname: to.fullname, email: to.email },
          text: msg.text,
          date: msg.date,
          read: msg.read
        });
        // notify sender as well
        io.to(from.email).emit('message', {
          _id: msg._id,
          from: { _id: from._id, fullname: from.fullname, email: from.email },
          to: { _id: to._id, fullname: to.fullname, email: to.email },
          text: msg.text,
          date: msg.date,
          read: msg.read
        });
      }
    } catch (e) { logger.error('emit message error', e); }

    return res.json({ success: true, message: 'Message sent', data: msg });
  } catch (err) {
    logger.error('Send message error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /messages/conversation/:withEmail
router.get(
  '/conversation/:withEmail',
  requireActor({ mode: 'json', notFoundMessage: 'User not found' }),
  requireActive({ mode: 'json' }),
  requireRole(['user', 'admin', 'super_admin'], { mode: 'json' }),
  async (req, res) => {
  try {
    const withEmail = req.params.withEmail;

    const me = req.actor;
    const other = await User.findOne({ email: withEmail });
    if (!me || !other) return res.status(404).json({ success: false, message: 'User(s) not found' });

    const msgs = await Message.find({
      $or: [
        { from: me._id, to: other._id },
        { from: other._id, to: me._id }
      ]
    }).sort({ date: 1 }).populate('from to', 'fullname email avatar role online lastOnline');

    return res.json({ success: true, data: msgs });
  } catch (err) {
    logger.error('Conversation error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /messages/contacts
// returns list of users (except me) with presence and last message preview
// 🔐 Fix #1: Prevent N+1 query - use MongoDB aggregation with lookup
router.get(
  '/contacts',
  requireActor({ mode: 'json', notFoundMessage: 'User not found' }),
  requireActive({ mode: 'json' }),
  requireRole(['user', 'admin', 'super_admin'], { mode: 'json' }),
  async (req, res) => {
  try {
    const me = req.actor;
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));

    // Use aggregation to avoid N+1 query problem
    const contacts = await User.aggregate([
      { $match: { _id: { $ne: me._id } } },
      { $limit: limit },
      { $lookup: {
        from: 'messages',
        let: { userId: '$_id' },
        pipeline: [
          { $match: { $expr: { $or: [
            { $and: [{ $eq: ['$from', me._id] }, { $eq: ['$to', '$$userId'] }] },
            { $and: [{ $eq: ['$from', '$$userId'] }, { $eq: ['$to', me._id] }] }
          ] } } },
          { $sort: { date: -1 } },
          { $limit: 1 },
          { $project: { text: 1, date: 1, from: 1 } }
        ],
        as: 'lastMsg'
      } },
      { $unwind: { path: '$lastMsg', preserveNullAndEmptyArrays: true } },
      { $project: {
        _id: 1,
        fullname: 1,
        email: 1,
        avatar: 1,
        online: 1,
        lastOnline: 1,
        role: 1,
        lastMessage: { $cond: [{ $ne: ['$lastMsg', null] }, '$lastMsg', null] }
      } }
    ]);

    return res.json({ success: true, data: contacts });
  } catch (err) {
    logger.error('Contacts error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 🔐 Fix #12: Add rate limiting to presence endpoint
const presenceLimiter = rateLimit({
  windowMs: 10 * 1000,  // 10 seconds
  max: 5,  // 5 presence updates per 10 seconds
  keyGenerator: (req) => req.actor._id.toString()
});

// POST /messages/presence
// body: { online }
router.post(
  '/presence',
  requireActor({ mode: 'json', notFoundMessage: 'User not found' }),
  requireActive({ mode: 'json' }),
  presenceLimiter,
  requireRole(['user', 'admin', 'super_admin'], { mode: 'json' }),
  async (req, res) => {
  try {
    const { online } = req.body;
    if (typeof online === 'undefined') return res.status(400).json({ success: false, message: 'Missing fields' });

    const user = req.actor;

    user.online = !!online;
    if (!online) user.lastOnline = new Date();
    await user.save();

    // emit presence change
    try {
      const io = req.app.get('io');
      if (io) io.emit('presence', { email: user.email, online: !!online, lastOnline: user.lastOnline });
    } catch (e) { logger.error('emit presence error', e); }

    return res.json({ success: true, message: 'Presence updated' });
  } catch (err) {
    logger.error('Presence error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /messages/search?q=keyword&withEmail=optional
router.get(
  '/search',
  requireActor({ mode: 'json', notFoundMessage: 'User not found' }),
  requireActive({ mode: 'json' }),
  requireRole(['user', 'admin', 'super_admin'], { mode: 'json' }),
  async (req, res) => {
  try {
    const me = req.actor;
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.status(400).json({ success: false, message: 'Search query must be at least 2 characters' });

    const filter = {
      $or: [{ from: me._id }, { to: me._id }]
    };

    // Use text index if available, else regex
    const hasTextIndex = await Message.collection.indexExists('text_text');
    if (hasTextIndex) {
      filter.$text = { $search: q };
    } else {
      filter.text = { $regex: q, $options: 'i' };
    }

    // Optionally filter by conversation partner
    if (req.query.withEmail) {
      const other = await User.findOne({ email: req.query.withEmail });
      if (other) {
        filter.$or = [
          { from: me._id, to: other._id },
          { from: other._id, to: me._id }
        ];
      }
    }

    const msgs = await Message.find(filter)
      .sort({ date: -1 })
      .limit(50)
      .populate('from to', 'fullname email avatar');

    return res.json({ success: true, data: msgs });
  } catch (err) {
    logger.error('Message search error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /messages/mark-read
// body: { messageIds: [...] }
router.post(
  '/mark-read',
  requireActor({ mode: 'json', notFoundMessage: 'User not found' }),
  requireActive({ mode: 'json' }),
  requireRole(['user', 'admin', 'super_admin'], { mode: 'json' }),
  async (req, res) => {
  try {
    const me = req.actor;
    const { messageIds } = req.body;
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Missing messageIds' });
    }

    await Message.updateMany(
      { _id: { $in: messageIds }, to: me._id },
      { $set: { read: true } }
    );

    return res.json({ success: true, message: 'Messages marked as read' });
  } catch (err) {
    logger.error('Mark read error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /messages/unread-count
router.get(
  '/unread-count',
  requireActor({ mode: 'json', notFoundMessage: 'User not found' }),
  requireActive({ mode: 'json' }),
  requireRole(['user', 'admin', 'super_admin'], { mode: 'json' }),
  async (req, res) => {
  try {
    const count = await Message.countDocuments({ to: req.actor._id, read: false });
    return res.json({ success: true, count });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
