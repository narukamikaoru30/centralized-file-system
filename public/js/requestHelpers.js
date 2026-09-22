(function () {
  function redirectToLogin(redirect) {
    const target = redirect || '/auth/login?reason=timeout';
    if (typeof window !== 'undefined' && window.location && window.location.href !== target) {
      window.location.href = target;
    }
  }

  function shouldHandleTimeout(responseStatus, payload) {
    return responseStatus === 401 && payload && payload.reason === 'timeout';
  }

  function shouldHandleUnauthorized(responseStatus) {
    return responseStatus === 401;
  }

  const CSRF_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  function parseCsrfToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const timestamp = parseInt(parts[1], 36);
    if (Number.isNaN(timestamp)) return null;
    return { token, timestamp };
  }

  function isCsrfTokenExpired(token) {
    const parsed = parseCsrfToken(token);
    if (!parsed) return true;
    return Date.now() - parsed.timestamp >= CSRF_TOKEN_MAX_AGE_MS;
  }

  async function refreshCsrfToken() {
    try {
      const response = await fetch('/csrf-token', {
        method: 'GET',
        credentials: 'same-origin'
      });
      if (!response.ok) return '';
      const data = await response.json();
      const token = data && data.csrfToken ? data.csrfToken : '';
      const uploadCsrfTokenInput = document.getElementById('uploadCsrfToken');
      if (uploadCsrfTokenInput && token) uploadCsrfTokenInput.value = token;
      return token;
    } catch (_) {
      return '';
    }
  }

  function normalizeRequestOptions(options = {}) {
    const normalized = { ...options };
    const headers = { ...(normalized.headers || {}) };

    if (!headers.Accept) {
      headers.Accept = 'application/json';
    }
    if (!headers['X-Requested-With']) {
      headers['X-Requested-With'] = 'XMLHttpRequest';
    }
    if (!normalized.credentials) {
      normalized.credentials = 'same-origin';
    }

    const method = (normalized.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !headers['X-CSRF-Token']) {
      const csrfToken = getCsrfToken();
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
    }

    normalized.headers = headers;
    return normalized;
  }

  function getCsrfToken() {
    if (typeof window === 'undefined') return '';
    const match = document.cookie.match('(^|;)\\s*cfs_csrf=([^;]+)');
    if (match) {
      return decodeURIComponent(match[2]);
    }
    const hiddenCsrf = document.getElementById('uploadCsrfToken');
    return (hiddenCsrf && hiddenCsrf.value) ? hiddenCsrf.value : '';
  }

  function isCsrfMismatchResponse(response, payload) {
    return response && response.status === 403 && payload && typeof payload.message === 'string' && payload.message.toLowerCase().includes('csrf token');
  }

  function showCsrfMismatchToast() {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast('Security token mismatch. Please try again.', 'error');
    }
  }

  async function requestJson(url, options = {}) {
    const normalized = normalizeRequestOptions(options);
    const method = (normalized.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const existingToken = normalized.headers['X-CSRF-Token'] || normalized.headers['x-csrf-token'];
      if (!existingToken || isCsrfTokenExpired(existingToken)) {
        const refreshedToken = await refreshCsrfToken();
        if (refreshedToken) {
          normalized.headers['X-CSRF-Token'] = refreshedToken;
        }
      }
    }

    let response = await fetch(url, normalized);
    let contentType = response.headers.get('content-type') || '';
    let payload;

    if (contentType.includes('application/json')) {
      payload = await response.json();
    } else {
      payload = { success: false, message: `Request failed (${response.status})` };
    }

    if (isCsrfMismatchResponse(response, payload)) {
      const refreshedToken = await refreshCsrfToken();
      if (refreshedToken) {
        const retryOptions = { ...normalized, headers: { ...normalized.headers, 'X-CSRF-Token': refreshedToken } };
        response = await fetch(url, retryOptions);
        contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          payload = await response.json();
        } else {
          payload = { success: false, message: `Request failed (${response.status})` };
        }
      }
      if (isCsrfMismatchResponse(response, payload)) {
        showCsrfMismatchToast();
      }
    }

    if (shouldHandleUnauthorized(response.status)) {
      redirectToLogin((payload && payload.redirect) || '/auth/login?reason=timeout');
      if (shouldHandleTimeout(response.status, payload)) {
        throw new Error(payload.message || 'Session expired due to inactivity. Please log in again.');
      }
      throw new Error((payload && payload.message) || 'Unauthorized. Please log in again.');
    }

    return payload;
  }

  function postNoBody(url) {
    return requestJson(url, { method: 'POST' });
  }

  function postJson(url, payload) {
    return requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  window.RequestHelpers = {
    requestJson,
    postNoBody,
    postJson,
    redirectToLogin,
    shouldHandleTimeout,
    shouldHandleUnauthorized,
    getCsrfToken,
    isCsrfTokenExpired,
    refreshCsrfToken
  };
})();
