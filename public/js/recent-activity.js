(function () {
  'use strict';

  const MAX_ITEMS = 30;
  const icons = {
    upload: 'upload-cloud-2-line',
    delete: 'delete-bin-6-line',
    download: 'download-2-line',
    share: 'share-line',
    system_alert: 'alert-line',
    admin_action: 'shield-user-line',
    security: 'lock-line',
    restore: 'restart-line',
    version: 'file-history-line',
    tag: 'price-tag-3-line',
    invite: 'mail-send-line',
    branch_update: 'building-line',
    general: 'notification-3-line'
  };

  function getElements() {
    return {
      feed: document.querySelector('[data-recent-activity-feed]'),
      count: document.querySelector('[data-recent-activity-count]')
    };
  }

  function normalizedType(type) {
    return Object.prototype.hasOwnProperty.call(icons, type) ? type : 'general';
  }

  function createActivityItem(activity) {
    const type = normalizedType(activity.type);
    const date = new Date(activity.date || Date.now());
    const duplicateKey = JSON.stringify([
      type,
      String(activity.message || '').trim().toLowerCase(),
      String(activity.relatedUser || ''),
      String(activity.relatedFile || ''),
      Math.floor((Number.isNaN(date.getTime()) ? Date.now() : date.getTime()) / 1000)
    ]);
    const article = document.createElement('article');
    article.className = 'activity-item';
    if (activity.id) article.dataset.activityId = String(activity.id);
    article.dataset.activityKey = duplicateKey;
    const icon = document.createElement('div');
    icon.className = `activity-icon activity-icon-${type}`;
    icon.setAttribute('aria-hidden', 'true');
    const iconElement = document.createElement('i');
    iconElement.className = `ri-${icons[type]}`;
    icon.appendChild(iconElement);

    const body = document.createElement('div');
    body.className = 'activity-body';
    const message = document.createElement('strong');
    message.textContent = activity.message || 'New activity';
    message.title = message.textContent;
    const details = document.createElement('div');
    details.className = 'activity-details';
    const category = document.createElement('span');
    category.className = 'activity-type';
    category.textContent = type.replace(/_/g, ' ');
    const time = document.createElement('time');
    time.className = 'activity-meta';
    time.dateTime = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
    time.textContent = Number.isNaN(date.getTime()) ? new Date().toLocaleString() : date.toLocaleString();
    details.append(category, time);
    body.append(message, details);
    article.append(icon, body);
    return article;
  }

  function updateCounter(feed, count) {
    if (count) count.textContent = `${feed.querySelectorAll('.activity-item').length} RECENT`;
  }

  function renderActivities(items) {
    const { feed, count } = getElements();
    if (!feed || !Array.isArray(items)) return;
    feed.replaceChildren();
    items.slice(0, MAX_ITEMS).forEach((item) => feed.appendChild(createActivityItem(item)));
    if (!feed.children.length) {
      const empty = document.createElement('div');
      empty.className = 'activity-empty';
      empty.textContent = 'No recent activity.';
      feed.appendChild(empty);
    }
    updateCounter(feed, count);
  }

  function prependActivity(activity) {
    const { feed, count } = getElements();
    if (!feed || !activity) return;
    if (activity.id && Array.from(feed.querySelectorAll('[data-activity-id]'))
      .some((item) => item.dataset.activityId === String(activity.id))) return;
    const activityItem = createActivityItem(activity);
    if (Array.from(feed.querySelectorAll('[data-activity-key]'))
      .some((item) => item.dataset.activityKey === activityItem.dataset.activityKey)) return;
    const empty = feed.querySelector('.activity-empty');
    if (empty) empty.remove();
    feed.insertBefore(activityItem, feed.firstChild);
    while (feed.querySelectorAll('.activity-item').length > MAX_ITEMS) {
      feed.lastElementChild.remove();
    }
    updateCounter(feed, count);
  }

  function attachSocket(socket) {
    if (!socket || socket.__recentActivityAttached) return;
    socket.__recentActivityAttached = true;
    socket.on('recentActivity', prependActivity);
  }

  window.renderRecentActivities = renderActivities;
  attachSocket(window.appSocket);
  window.addEventListener('app:socket-ready', (event) => attachSocket(event.detail && event.detail.socket));
})();
