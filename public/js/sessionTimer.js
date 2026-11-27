/**
 * Session Timeout Countdown Timer
 * Shows remaining session time and warns users before expiration
 */
(function() {
  'use strict';

  // Configuration
  const WARNING_THRESHOLD_SECONDS = 120; // Show warning when 2 minutes left
  const CRITICAL_THRESHOLD_SECONDS = 30; // Critical warning at 30 seconds
  const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
  const ACTIVITY_DEBOUNCE_MS = 5000; // Only ping server every 5 seconds max

  let sessionTimeoutMinutes = 30; // Default, will be overridden
  let remainingSeconds = 0;
  let timerInterval = null;
  let lastActivityPing = 0;
  let timerElement = null;
  let containerElement = null;

  /**
   * Initialize the session timer
   * @param {number} timeoutMinutes - Session timeout in minutes from server
   */
  function init(timeoutMinutes) {
    sessionTimeoutMinutes = timeoutMinutes || 30;
    remainingSeconds = sessionTimeoutMinutes * 60;

    createTimerUI();
    startTimer();
    setupActivityListeners();

    console.log(`[SessionTimer] Initialized with ${sessionTimeoutMinutes} minute timeout`);
  }

  /**
   * Create the timer UI element
   */
  function createTimerUI() {
    // Create container
    containerElement = document.createElement('div');
    containerElement.id = 'session-timer-container';
    containerElement.innerHTML = `
      <div class="session-timer" id="session-timer">
        <div class="session-timer-icon">⏱️</div>
        <div class="session-timer-content">
          <span class="session-timer-label">Session</span>
          <span class="session-timer-time" id="session-timer-time">--:--</span>
        </div>
        <button class="session-timer-extend" id="session-timer-extend" title="Reset timer">↻</button>
      </div>
      <div class="session-warning" id="session-warning" style="display: none;">
        <span class="warning-icon">⚠️</span>
        <span class="warning-text">Session expiring soon!</span>
        <button class="warning-extend-btn" id="warning-extend-btn">Keep me logged in</button>
      </div>
    `;

    // Add styles
    const styles = document.createElement('style');
    styles.textContent = `
      #session-timer-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 1080;
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
      }

      .session-timer {
        display: flex;
        align-items: center;
        gap: 12px;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(249, 250, 251, 0.95));
        backdrop-filter: blur(10px);
        border: 1px solid rgba(212, 175, 55, 0.3);
        border-radius: 14px;
        padding: 12px 18px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        transition: all 0.3s ease;
      }

      .session-timer:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 25px rgba(0, 0, 0, 0.15);
      }

      .session-timer.warning {
        border-color: #f59e0b;
        background: linear-gradient(135deg, rgba(255, 251, 235, 0.98), rgba(254, 243, 199, 0.98));
        animation: pulse-warning 2s ease-in-out infinite;
      }

      .session-timer.critical {
        border-color: #ef4444;
        background: linear-gradient(135deg, rgba(254, 242, 242, 0.98), rgba(254, 226, 226, 0.98));
        animation: pulse-critical 0.5s ease-in-out infinite;
      }

      @keyframes pulse-warning {
        0%, 100% { box-shadow: 0 4px 20px rgba(245, 158, 11, 0.2); }
        50% { box-shadow: 0 4px 30px rgba(245, 158, 11, 0.4); }
      }

      @keyframes pulse-critical {
        0%, 100% { box-shadow: 0 4px 20px rgba(239, 68, 68, 0.3); }
        50% { box-shadow: 0 4px 30px rgba(239, 68, 68, 0.6); }
      }

      .session-timer-icon {
        font-size: 26px;
      }

      .session-timer-content {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .session-timer-label {
        font-size: 12px;
        font-weight: 600;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .session-timer-time {
        font-size: 22px;
        font-weight: 800;
        color: #1f2937;
        font-variant-numeric: tabular-nums;
      }

      .session-timer.warning .session-timer-time {
        color: #b45309;
      }

      .session-timer.critical .session-timer-time {
        color: #dc2626;
      }

      .session-timer-extend {
        background: rgba(212, 175, 55, 0.15);
        border: none;
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 18px;
        cursor: pointer;
        transition: all 0.2s ease;
        color: #92730f;
      }

      .session-timer-extend:hover {
        background: rgba(212, 175, 55, 0.3);
        transform: rotate(180deg);
      }

      .session-warning {
        position: relative;
        z-index: 1090;
        margin-top: 12px;
        background: linear-gradient(135deg, #fef3c7, #fde68a);
        border: 1px solid #f59e0b;
        border-radius: 14px;
        padding: 14px 20px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 4px 20px rgba(245, 158, 11, 0.25);
        animation: slideDown 0.3s ease-out;
      }

      .session-warning.critical {
        background: linear-gradient(135deg, #fee2e2, #fecaca);
        border-color: #ef4444;
        box-shadow: 0 4px 20px rgba(239, 68, 68, 0.25);
      }

      @keyframes slideDown {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .warning-icon {
        font-size: 24px;
      }

      .warning-text {
        flex: 1;
        font-size: 15px;
        font-weight: 600;
        color: #92400e;
      }

      .session-warning.critical .warning-text {
        color: #991b1b;
      }

      .warning-extend-btn {
        background: linear-gradient(135deg, #D4AF37, #b8972f);
        color: white;
        border: none;
        border-radius: 10px;
        padding: 10px 18px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
      }

      .warning-extend-btn:hover {
        background: linear-gradient(135deg, #c9a432, #a68729);
        transform: scale(1.02);
      }

      /* Dark mode support */
      body.dark-mode .session-timer {
        background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.95));
        border-color: rgba(244, 211, 94, 0.3);
      }

      body.dark-mode .session-timer-label {
        color: #94a3b8;
      }

      body.dark-mode .session-timer-time {
        color: #f1f5f9;
      }

      body.dark-mode .session-timer-extend {
        background: rgba(244, 211, 94, 0.2);
        color: #F4D35E;
      }

      body.dark-mode .session-timer-extend:hover {
        background: rgba(244, 211, 94, 0.35);
      }

      body.dark-mode .session-timer.warning {
        background: linear-gradient(135deg, rgba(120, 77, 25, 0.9), rgba(92, 61, 21, 0.9));
        border-color: #f59e0b;
      }

      body.dark-mode .session-timer.warning .session-timer-time {
        color: #fbbf24;
      }

      body.dark-mode .session-timer.critical {
        background: linear-gradient(135deg, rgba(127, 29, 29, 0.9), rgba(99, 22, 22, 0.9));
        border-color: #ef4444;
      }

      body.dark-mode .session-timer.critical .session-timer-time {
        color: #f87171;
      }

      body.dark-mode .session-warning {
        background: linear-gradient(135deg, rgba(120, 77, 25, 0.95), rgba(92, 61, 21, 0.95));
        border-color: #d97706;
      }

      body.dark-mode .session-warning .warning-text {
        color: #fcd34d;
      }

      body.dark-mode .session-warning.critical {
        background: linear-gradient(135deg, rgba(127, 29, 29, 0.95), rgba(99, 22, 22, 0.95));
        border-color: #dc2626;
      }

      body.dark-mode .session-warning.critical .warning-text {
        color: #fca5a5;
      }

      /* Mobile responsive */
      @media (max-width: 480px) {
        #session-timer-container {
          top: 10px;
          right: 10px;
          left: 10px;
        }

        .session-timer {
          width: 100%;
          justify-content: center;
        }

        .session-warning {
          flex-wrap: wrap;
          justify-content: center;
          text-align: center;
        }

        .warning-extend-btn {
          width: 100%;
          margin-top: 8px;
        }
      }
    `;

    document.head.appendChild(styles);
    document.body.appendChild(containerElement);

    // Cache element references
    timerElement = document.getElementById('session-timer');
    const timeDisplay = document.getElementById('session-timer-time');
    const extendBtn = document.getElementById('session-timer-extend');
    const warningExtendBtn = document.getElementById('warning-extend-btn');

    // Add click handlers
    extendBtn.addEventListener('click', extendSession);
    warningExtendBtn.addEventListener('click', extendSession);
  }

  /**
   * Start the countdown timer
   */
  function startTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
    }

    timerInterval = setInterval(() => {
      remainingSeconds--;

      if (remainingSeconds <= 0) {
        clearInterval(timerInterval);
        handleSessionExpired();
        return;
      }

      updateDisplay();
      updateTimerState();
    }, 1000);

    updateDisplay();
  }

  /**
   * Update the timer display
   */
  function updateDisplay() {
    const timeDisplay = document.getElementById('session-timer-time');
    if (!timeDisplay) return;

    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    timeDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  /**
   * Update timer visual state based on remaining time
   */
  function updateTimerState() {
    if (!timerElement) return;

    const warningEl = document.getElementById('session-warning');

    timerElement.classList.remove('warning', 'critical');
    warningEl.classList.remove('critical');

    if (remainingSeconds <= CRITICAL_THRESHOLD_SECONDS) {
      timerElement.classList.add('critical');
      warningEl.classList.add('critical');
      warningEl.style.display = 'flex';
      warningEl.querySelector('.warning-text').textContent = 'Session expiring NOW!';
    } else if (remainingSeconds <= WARNING_THRESHOLD_SECONDS) {
      timerElement.classList.add('warning');
      warningEl.style.display = 'flex';
      warningEl.querySelector('.warning-text').textContent = `Session expiring in ${Math.ceil(remainingSeconds / 60)} minute${remainingSeconds > 60 ? 's' : ''}!`;
    } else {
      warningEl.style.display = 'none';
    }
  }

  /**
   * Setup activity listeners to reset timer on user interaction
   */
  function setupActivityListeners() {
    ACTIVITY_EVENTS.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true });
    });
  }

  /**
   * Handle user activity
   */
  function handleActivity() {
    const now = Date.now();

    // Debounce activity pings
    if (now - lastActivityPing < ACTIVITY_DEBOUNCE_MS) {
      return;
    }

    lastActivityPing = now;

    // Only reset if not in warning state (require explicit action)
    if (remainingSeconds > WARNING_THRESHOLD_SECONDS) {
      resetTimer();
    }
  }

  /**
   * Reset the timer to full duration
   */
  function resetTimer() {
    remainingSeconds = sessionTimeoutMinutes * 60;
    updateDisplay();
    updateTimerState();
  }

  /**
   * Extend session by making a request to server
   */
  async function extendSession() {
    try {
      // Make a simple request to keep session alive
      const response = await fetch('/csrf-token', {
        method: 'GET',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });

      if (response.ok) {
        resetTimer();
        showToast('Session extended!', 'success');
      } else if (response.status === 401) {
        handleSessionExpired();
      }
    } catch (err) {
      console.error('[SessionTimer] Failed to extend session:', err);
      // Still reset timer locally - server might be temporarily unavailable
      resetTimer();
    }
  }

  /**
   * Handle session expiration
   */
  function handleSessionExpired() {
    clearInterval(timerInterval);
    
    // Show expiration message
    if (timerElement) {
      timerElement.innerHTML = `
        <div class="session-timer-icon">🔒</div>
        <div class="session-timer-content">
          <span class="session-timer-label">Session</span>
          <span class="session-timer-time" style="color: #dc2626;">Expired</span>
        </div>
      `;
    }

    const warningEl = document.getElementById('session-warning');
    if (warningEl) {
      warningEl.innerHTML = `
        <span class="warning-icon">🔒</span>
        <span class="warning-text">Your session has expired</span>
        <a href="/auth/login" class="warning-extend-btn">Log in again</a>
      `;
      warningEl.classList.add('critical');
      warningEl.style.display = 'flex';
    }

    // Redirect after a short delay
    setTimeout(() => {
      window.location.href = '/auth/login?reason=timeout';
    }, 3000);
  }

  /**
   * Show a toast notification
   */
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 14px 24px;
      background: ${type === 'success' ? '#10b981' : '#3b82f6'};
      color: white;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      z-index: 99999;
      animation: slideIn 0.3s ease-out;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'fadeOut 0.3s ease-out forwards';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // Expose to global scope
  window.SessionTimer = {
    init,
    resetTimer,
    extendSession,
    getRemainingSeconds: () => remainingSeconds
  };
})();
