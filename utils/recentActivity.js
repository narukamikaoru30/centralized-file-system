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

function dedupeRecentNotifications(notifications = [], limit = 8) {
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

module.exports = { dedupeRecentNotifications };