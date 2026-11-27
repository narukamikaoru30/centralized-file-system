const mongoose = require("mongoose");
const File = require("../models/File");
const User = require("../models/User");
const Notification = require("../models/Notification");

const RECENT_ACTIVITY_LIMIT = 30;
const SUPER_ADMIN_ACTIVITY_ROOM = "recent:super-admins";
let activityIo = null;
const recentBroadcasts = new Map();

function eventIdentity(notification) {
  const timestamp = new Date(notification.date).getTime();
  const second = Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : "unknown-time";

  return [
    String(notification.type || "general"),
    String(notification.message || "").trim().toLowerCase(),
    String(notification.relatedUser || ""),
    String(notification.relatedFile || ""),
    second
  ].join("\u0000");
}

function dedupeRecentNotifications(notifications = [], limit = RECENT_ACTIVITY_LIMIT) {
  const seen = new Set();
  const unique = [];

  for (const notification of notifications) {
    const identity = eventIdentity(notification);
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(notification);
    if (unique.length >= limit) break;
  }

  return unique;
}

function branchRoom(branch) {
  return `recent:branch:${encodeURIComponent(String(branch))}`;
}

function userRoom(userId) {
  return `recent:user:${String(userId)}`;
}

function getRecentActivityRoomsForUser(user = {}) {
  const rooms = [];
  if (user._id) rooms.push(userRoom(user._id));
  if (user.branch) rooms.push(branchRoom(user.branch));
  if (user.role === "super_admin") rooms.push(SUPER_ADMIN_ACTIVITY_ROOM);
  return rooms;
}

function setRecentActivityIO(io) {
  activityIo = io;
}

async function getRecentActivityBranch(notification) {
  if (notification.branch || notification.metadata?.branch) {
    return String(notification.branch || notification.metadata.branch);
  }

  const [file, owner] = await Promise.all([
    notification.relatedFile
      ? File.findById(notification.relatedFile).select("branch").lean()
      : null,
    notification.owner
      ? User.findById(notification.owner).select("branch").lean()
      : null
  ]);
  return String((file && file.branch) || (owner && owner.branch) || "");
}

async function publishRecentActivity(notification) {
  if (!activityIo || !notification) return;

  try {
    const data = typeof notification.toObject === "function"
      ? notification.toObject()
      : notification;
    const identity = eventIdentity(data);
    const previousBroadcast = recentBroadcasts.get(identity);
    if (previousBroadcast && Date.now() - previousBroadcast < 2000) return;
    recentBroadcasts.set(identity, Date.now());
    if (recentBroadcasts.size > 1000) {
      for (const [key, timestamp] of recentBroadcasts) {
        if (Date.now() - timestamp > 10000) recentBroadcasts.delete(key);
      }
    }
    const branch = await getRecentActivityBranch(data);
    const rooms = [SUPER_ADMIN_ACTIVITY_ROOM];
    if (branch) rooms.push(branchRoom(branch));
    if (data.owner) rooms.push(userRoom(data.owner));
    if (data.relatedUser) rooms.push(userRoom(data.relatedUser));

    let broadcast = activityIo.to(rooms[0]);
    for (const room of rooms.slice(1)) broadcast = broadcast.to(room);
    broadcast.emit("recentActivity", {
      id: String(data._id || data.id || ""),
      message: String(data.message || ""),
      type: String(data.type || "general"),
      date: data.date || new Date(),
      branch,
      owner: data.owner ? String(data.owner) : "",
      relatedUser: data.relatedUser ? String(data.relatedUser) : "",
      relatedFile: data.relatedFile ? String(data.relatedFile) : ""
    });
  } catch (error) {
    const logger = require("./logger");
    logger.error("[Recent Activity] Unable to broadcast notification", {
      error: error.message,
      notificationId: String(notification._id || notification.id || "")
    });
  }
}

async function getRecentNotifications({ role, branch, userId, limit = RECENT_ACTIVITY_LIMIT }) {
  const safeLimit = Math.min(Math.max(Number(limit) || RECENT_ACTIVITY_LIMIT, 1), 50);
  if (role === "super_admin") {
    const candidates = await Notification.find({})
      .sort({ date: -1 })
      .limit(safeLimit * 4)
      .lean();
    return dedupeRecentNotifications(candidates, safeLimit);
  }

  const pipeline = [
    {
      $lookup: {
        from: File.collection.name,
        localField: "relatedFile",
        foreignField: "_id",
        as: "activityFile"
      }
    },
    {
      $lookup: {
        from: User.collection.name,
        localField: "owner",
        foreignField: "_id",
        as: "activityOwner"
      }
    },
    {
      $addFields: {
        activityBranch: {
          $cond: [
            { $ne: [{ $ifNull: ["$branch", ""] }, ""] },
            "$branch",
            {
              $ifNull: [
                { $arrayElemAt: ["$activityFile.branch", 0] },
                { $arrayElemAt: ["$activityOwner.branch", 0] }
              ]
            }
          ]
        }
      }
    }
  ];

  const scope = [];
  if (branch) scope.push({ activityBranch: String(branch) });
  if (role === "user" && userId && mongoose.Types.ObjectId.isValid(String(userId))) {
    const id = new mongoose.Types.ObjectId(String(userId));
    scope.push({ owner: id }, { relatedUser: id });
  }
  if (!scope.length) return [];

  pipeline.push(
    { $match: { $or: scope } },
    { $sort: { date: -1, _id: -1 } },
    { $limit: safeLimit * 4 },
    { $project: { activityFile: 0, activityOwner: 0, activityBranch: 0 } }
  );

  return dedupeRecentNotifications(await Notification.aggregate(pipeline), safeLimit);
}

module.exports = {
  RECENT_ACTIVITY_LIMIT,
  SUPER_ADMIN_ACTIVITY_ROOM,
  branchRoom,
  userRoom,
  getRecentActivityRoomsForUser,
  setRecentActivityIO,
  publishRecentActivity,
  getRecentNotifications,
  dedupeRecentNotifications
};