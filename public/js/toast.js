/* ===== Toast Notification Utility ===== */
(function () {
  'use strict';

  const toastLayer = document.body || document.documentElement;
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-relevant', 'additions');
  }
  if (container.parentElement !== toastLayer) toastLayer.appendChild(container);

  function moveDashboardOverlaysToBody() {
    if (!document.querySelector('.dashboard-container')) return;

    document.querySelectorAll('.modal, .profile-modal, .confirm-modal, .action-modal')
      .forEach(function (overlay) {
        document.body.appendChild(overlay);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', moveDashboardOverlaysToBody, { once: true });
  } else {
    moveDashboardOverlaysToBody();
  }

  const ICONS = {
    success: 'ri-check-line',
    error: 'ri-close-circle-line',
    info: 'ri-information-line',
    warning: 'ri-alert-line'
  };

  const MAX_VISIBLE_TOASTS = 4;

  /**
   * Show a toast notification.
   * @param {string} message - Text to display
   * @param {'success'|'error'|'info'|'warning'} type - Toast type
   * @param {number} [duration=3500] - Auto-dismiss in ms (0 = manual)
   */
  function showToast(message, type, duration) {
    type = type || 'info';
    duration = typeof duration === 'number' ? duration : 3500;
    if (type === 'warn') type = 'warning';

    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');

    var icon = document.createElement('i');
    icon.className = 'ri ' + (ICONS[type] || ICONS.info);
    icon.setAttribute('aria-hidden', 'true');

    var text = document.createElement('span');
    text.className = 'toast-message';
    text.textContent = String(message == null ? '' : message);

    var closeButton = document.createElement('button');
    closeButton.className = 'toast-close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Dismiss notification');
    closeButton.innerHTML = '<i class="ri-close-line" aria-hidden="true"></i>';
    closeButton.addEventListener('click', function () { dismissToast(el); });

    el.appendChild(icon);
    el.appendChild(text);
    el.appendChild(closeButton);
    container.appendChild(el);

    while (container.children.length > MAX_VISIBLE_TOASTS) {
      dismissToast(container.firstElementChild);
    }

    if (duration > 0) {
      el.dismissTimer = setTimeout(function () { dismissToast(el); }, duration);
    }
    return el;
  }

  function dismissToast(el) {
    if (!el || !el.parentNode) return;
    if (el.dismissTimer) clearTimeout(el.dismissTimer);
    el.classList.add('toast-out');
    el.addEventListener('animationend', function () { el.remove(); });
    setTimeout(function () { if (el.parentNode) el.remove(); }, 350);
  }

  window.showToast = showToast;
  window.addEventListener('app:toast', function (event) {
    const detail = event.detail || {};
    if (detail.message) showToast(detail.message, detail.type, detail.duration);
  });
})();
