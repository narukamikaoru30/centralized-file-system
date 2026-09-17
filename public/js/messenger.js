(function() {
  const root = document.getElementById('messenger-root');
  if (!root) return;

  const meEmail = root.getAttribute('data-email');
  let meFull = root.getAttribute('data-fullname') || '';
  const meRole = root.getAttribute('data-role') || '';
  const API = '/messages';

  // compact floating messenger styles
  const style = document.createElement('style');
  style.textContent = `
    #messenger-btn { position: fixed; right: 18px; bottom: 18px; width:60px; height:60px; border-radius:50%; background:linear-gradient(135deg,#D4AF37,#C1121F); color:white; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:9999; box-shadow:0 14px 36px rgba(212,175,55,0.35), 0 10px 24px rgba(0,0,0,0.16); font-size:22px; transition:transform .22s ease, box-shadow .22s ease; }
    #messenger-btn:hover { transform: translateY(-2px) scale(1.04); box-shadow:0 18px 40px rgba(212,175,55,0.45), 0 12px 28px rgba(0,0,0,0.18); }
    #messenger-panel { position: fixed; right: 18px; bottom: 96px; width: 560px; max-width:calc(100% - 36px); height: min(700px, calc(100vh - 130px)); background: linear-gradient(180deg,#fff,#fcfcfd); border-radius:18px; box-shadow: 0 30px 80px rgba(0,0,0,0.26); overflow: hidden; display:none; z-index:9999; font-family: 'Segoe UI', Inter, Arial, sans-serif; border:1px solid rgba(255,255,255,0.8); transform: translateY(8px) scale(.98); opacity:0; }
    #messenger-panel.show { display:flex; flex-direction:column; animation: msrPanelIn .25s ease forwards; }
    @keyframes msrPanelIn { to { transform: translateY(0) scale(1); opacity:1; } }
    .msr-top { padding:12px 14px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,.25); background:linear-gradient(100deg,#D4AF37, #C1121F); color:white; font-weight:700; }
    .msr-top-main { display:flex; flex-direction:column; gap:2px; }
    .msr-title { font-size:15px; font-weight:800; letter-spacing:.2px; }
    .msr-subtitle { font-size:12px; opacity:.92; font-weight:600; }
    .msr-close { width:28px !important; height:28px !important; min-width:28px !important; min-height:28px !important; padding:0 !important; margin:0 !important; border:none !important; border-radius:8px !important; background:rgba(255,255,255,.2) !important; color:#fff !important; cursor:pointer !important; font-size:17px !important; font-weight:800 !important; font-family:'Segoe UI Symbol','Segoe UI',Arial,sans-serif !important; line-height:1 !important; display:inline-flex !important; align-items:center !important; justify-content:center !important; box-shadow:none !important; transform:none !important; }
    .msr-close:hover { background:rgba(255,255,255,.32) !important; transform:none !important; box-shadow:none !important; }
    .msr-controls { display:flex; align-items:center; gap:6px; }
    .msr-mute { border:none !important; border-radius:8px !important; background:rgba(255,255,255,.2) !important; color:#fff !important; cursor:pointer !important; font-size:12px !important; font-weight:800 !important; padding:6px 8px !important; line-height:1 !important; margin:0 !important; box-shadow:none !important; transform:none !important; }
    .msr-mute:hover { background:rgba(255,255,255,.32) !important; transform:none !important; box-shadow:none !important; }
    .msr-mute.active { background:rgba(239,68,68,.85); }
    .msr-close::before,
    .msr-mute::before { content:none !important; display:none !important; }
    .msr-body { display:flex; gap:0; flex:1; min-height:0; }
    #messenger-contacts { width:190px; background:#fff; border-right:1px solid #f2f4f7; overflow:auto; min-height:0; }
    .msr-search-wrap { padding:10px; border-bottom:1px solid #f6f7f9; background:#fff; position:sticky; top:0; z-index:2; }
    .msr-sort-wrap { margin-top:8px; }
    #msr-search { width:100%; padding:9px 10px; border-radius:10px; border:1px solid #e6e9ef; font-size:13px; }
    #msr-sort-toggle { width:100%; padding:7px 9px; border-radius:9px; border:1px solid #e6e9ef; font-size:12px; background:#fff; color:#374151; font-weight:700; cursor:pointer; }
    #msr-search:focus { outline:none; border-color:#F4D35E; box-shadow:0 0 0 3px rgba(244,211,94,.28); }
    #msr-sort-toggle:focus { outline:none; border-color:#F4D35E; box-shadow:0 0 0 3px rgba(244,211,94,.28); }
    #msr-sort-toggle:hover { background:#fff7f2; }
    .contact { padding:10px 10px; cursor:pointer; border-bottom:1px solid #fafafa; display:flex; gap:8px; align-items:flex-start; font-size:13px; transition:background .18s ease; }
    .contact:hover { background:#fff7f2; }
      .contact-avatar { width:34px; height:34px; border-radius:10px; object-fit:cover; border:1px solid #f1d7cc; box-shadow:0 2px 8px rgba(0,0,0,.08); flex-shrink:0; }
    .contact-head { display:flex; align-items:center; justify-content:space-between; gap:6px; }
    .contact-role { font-size:9.5px; font-weight:800; padding:2px 6px; border-radius:999px; background:#f3f4f6; color:#374151; text-transform:uppercase; letter-spacing:.2px; }
    .contact-role.admin { background:#fff0e8; color:#b45309; }
    .contact-role.super_admin { background:#ede9fe; color:#5b21b6; }
    .contact .meta { font-size:11px; color:#666; }
    .contact .last { font-size:11px; color:#999; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:132px; }
    .contact .dot { width:10px; height:10px; border-radius:50%; margin-left:auto; margin-top:2px; }
    #messenger-main { flex:1; display:flex; flex-direction:column; background:#fff; min-height:0; }
    .msr-convo-head { display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid #f3f4f6; background:#fff; }
    .msr-convo-avatar { width:30px; height:30px; border-radius:9px; object-fit:cover; border:1px solid #f1d7cc; }
    .msr-convo-name { font-size:12.5px; font-weight:800; color:#111827; }
    .msr-convo-role { margin-left:auto; font-size:10.5px; font-weight:800; padding:4px 8px; border-radius:999px; background:#f3f4f6; color:#374151; text-transform:uppercase; letter-spacing:.25px; }
    .msr-convo-role.admin { background:#fff0e8; color:#b45309; }
    .msr-convo-role.super_admin { background:#ede9fe; color:#5b21b6; }
    .msg-row { display:flex; align-items:flex-end; gap:6px; margin-bottom:10px; }
    .msg-row.me { justify-content:flex-end; }
    .msg-row.them { justify-content:flex-start; }
    .msg-avatar { width:24px; height:24px; border-radius:8px; object-fit:cover; border:1px solid #e5e7eb; flex-shrink:0; }
    #msr-messages { padding:12px; overflow-y:auto; overflow-x:hidden; flex:1; min-height:0; background: #fff; }
    .msr-empty { padding:12px; color:#888; font-weight:600; }
    .msr-input { display:flex; gap:8px; padding:10px; border-top:1px solid #e5e7eb; background:#fff; }
    .msr-input input { flex:1; padding:10px 12px; border-radius:10px; border:1px solid #e6e9ef; background:#fff; }
    .msr-input input:focus { outline:none; border-color:#F4D35E; box-shadow:0 0 0 3px rgba(244,211,94,.28); }
    .msr-send { background:linear-gradient(135deg,#D4AF37,#C1121F); color:white; border:none; padding:9px 13px; border-radius:10px; cursor:pointer; font-weight:700; }
    .msr-send:hover { filter:brightness(1.02); }
    .msg { margin-bottom:10px; max-width:82%; padding:9px 11px; border-radius:12px; font-size:13.5px; line-height:1.35; box-shadow:0 2px 8px rgba(0,0,0,.05); }
    .msg.me { background:linear-gradient(135deg, rgba(212, 175, 55, 0.15), rgba(193, 18, 31, 0.12)); margin-left:auto; border-bottom-right-radius:4px; color:#1f2937; }
    .msg.them { background:#f3f4f6; margin-right:auto; border-bottom-left-radius:4px; color:#1f2937; }
    .msr-toast-wrap { position:fixed; right:18px; top:18px; z-index:10000; display:grid; gap:10px; width:min(420px, calc(100vw - 32px)); }
    .msr-toast { background:#ffffff; border:1px solid #fde3d8; border-left:5px solid #D4AF37; border-radius:12px; padding:12px 13px; box-shadow:0 12px 28px rgba(0,0,0,.16); animation: msrToastIn .18s ease; }
    .msr-toast-title { font-size:14px; font-weight:800; color:#111827; margin-bottom:4px; }
    .msr-toast-msg { font-size:13px; color:#4b5563; line-height:1.4; }
    @keyframes msrToastIn { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform: translateY(0); } }

    /* Light mode explicit text colors */
    body:not(.dark-mode) #messenger-panel,
    body:not(.dark-mode) #messenger-contacts,
    body:not(.dark-mode) #messenger-main {
      color: #1f2937 !important;
    }
    body:not(.dark-mode) .contact .meta { color: #374151 !important; }
    body:not(.dark-mode) .contact .last { color: #6b7280 !important; }
    body:not(.dark-mode) .msr-convo-name { color: #111827 !important; }
    body:not(.dark-mode) .msr-empty { color: #6b7280 !important; }
    body:not(.dark-mode) .msg.me,
    body:not(.dark-mode) .msg.them { color: #1f2937 !important; }
    body:not(.dark-mode) .msr-input input { color: #1f2937 !important; }
    body:not(.dark-mode) .msr-input input::placeholder { color: #9ca3af !important; }
    body:not(.dark-mode) #msr-search { color: #1f2937 !important; background: #fff !important; }
    body:not(.dark-mode) #msr-search::placeholder { color: #6b7280 !important; }
    body:not(.dark-mode) #msr-sort-toggle { color: #374151 !important; background: #fff !important; }

    body.dark-mode #messenger-panel,
    body.dark-mode #messenger-contacts,
    body.dark-mode #messenger-main,
    body.dark-mode .msr-search-wrap,
    body.dark-mode .msr-input,
    body.dark-mode .msr-convo-head {
      background: rgba(15, 23, 42, 0.96) !important;
      color: #e5e7eb !important;
      border-color: rgba(255, 255, 255, 0.12) !important;
    }

    body.dark-mode #msr-messages {
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.95), rgba(17, 24, 39, 0.95));
    }

    body.dark-mode .contact {
      background: rgba(15, 23, 42, 0.96);
      border-color: rgba(255, 255, 255, 0.08);
    }

    body.dark-mode .contact:hover {
      background: rgba(244, 211, 94, 0.24);
    }

    body.dark-mode #msr-search,
    body.dark-mode #msr-sort-toggle,
    body.dark-mode .msr-input input {
      background: rgba(30, 41, 59, 0.95) !important;
      color: #f8fafc !important;
      border-color: rgba(244, 211, 94, 0.34) !important;
    }

    body.dark-mode #msr-sort-toggle:hover {
      background: rgba(244, 211, 94, 0.2) !important;
    }

    body.dark-mode .msr-empty,
    body.dark-mode .contact .meta,
    body.dark-mode .contact .last,
    body.dark-mode .msr-convo-name,
    body.dark-mode .msg.them,
    body.dark-mode .msg.me {
      color: #e2e8f0;
    }

    body.dark-mode .contact .meta {
      color: #f8fafc !important;
      font-weight: 700;
    }

    body.dark-mode .contact .last {
      color: #94a3b8 !important;
    }

    body.dark-mode .contact-role {
      background: rgba(51, 65, 85, 0.85);
      color: #e2e8f0;
    }

    body.dark-mode .contact-role.admin {
      background: rgba(180, 83, 9, 0.35);
      color: #fcd34d;
    }

    body.dark-mode .contact-role.super_admin {
      background: rgba(91, 33, 182, 0.35);
      color: #c4b5fd;
    }

    body.dark-mode .msr-convo-role {
      background: rgba(51, 65, 85, 0.85);
      color: #e2e8f0;
    }

    body.dark-mode .msr-convo-role.admin {
      background: rgba(180, 83, 9, 0.35);
      color: #fcd34d;
    }

    body.dark-mode .msr-convo-role.super_admin {
      background: rgba(91, 33, 182, 0.35);
      color: #c4b5fd;
    }

    body.dark-mode .contact-avatar,
    body.dark-mode .msr-convo-avatar,
    body.dark-mode .msg-avatar {
      border-color: rgba(244, 211, 94, 0.4);
    }

    body.dark-mode .msg.them {
      background: rgba(51, 65, 85, 0.85);
    }

    body.dark-mode .msg.me {
      background: rgba(193, 18, 31, 0.5);
    }

    body.dark-mode .msr-toast {
      background: rgba(17, 24, 39, 0.98);
      border-color: rgba(255, 255, 255, 0.18);
    }

    body.dark-mode .msr-toast-title,
    body.dark-mode .msr-toast-msg {
      color: #f1f5f9;
    }

    @media (max-width:700px) {
      #messenger-panel { right:12px; left:12px; width:auto; bottom:74px; height:min(72vh, calc(100vh - 86px)); }
      #messenger-contacts { display:none; }
      .msr-top { padding:10px 11px; }
      .msr-title { font-size:14px; }
      .msr-subtitle { font-size:11px; }
      .msr-controls { gap:4px; }
      .msr-close { width:26px !important; height:26px !important; min-width:26px !important; min-height:26px !important; font-size:16px !important; }
      .msr-mute { padding:5px 7px !important; font-size:11px !important; }
    }
  `;
  document.head.appendChild(style);

  // UI
  const btn = document.createElement('div'); btn.id = 'messenger-btn'; btn.title = 'Messenger'; btn.innerHTML = '💬';
  const panel = document.createElement('div'); panel.id = 'messenger-panel';
  const toastWrap = document.createElement('div'); toastWrap.className = 'msr-toast-wrap';
  panel.innerHTML = `
    <div class="msr-top">
      <div class="msr-top-main">
        <div class="msr-title">Messenger${meRole === 'admin' ? ' • Admin' : ''}</div>
        <div class="msr-subtitle">${escapeHtml(meFull || meEmail)}</div>
      </div>
      <div class="msr-controls"><button id="msr-mute" class="msr-mute" type="button" title="Mute notifications">🔔</button><button id="msr-close" class="msr-close" title="Close">×</button></div>
    </div>
    <div class="msr-body">
      <div id="messenger-contacts">
        <div class="msr-search-wrap"><input id="msr-search" placeholder="Search users..." /><div class="msr-sort-wrap"><button id="msr-sort-toggle" type="button">Sort: Role Priority</button></div></div>
        <div id="msr-contacts-list" style="overflow:auto;"></div>
      </div>
      <div id="messenger-main">
        <div id="msr-convo-head" class="msr-convo-head" style="display:none;"></div>
        <div id="msr-messages" class="msr-messages"><div class="msr-empty">Select a contact</div></div>
        <div class="msr-input"><input id="msr-input" placeholder="Type a message..."/><button id="msr-send" class="msr-send">Send</button></div>
      </div>
    </div>
  `;
  root.appendChild(btn); root.appendChild(panel); root.appendChild(toastWrap);

  let currentContact = null;

  btn.addEventListener('click', () => {
    requestBrowserNotificationPermission();
    panel.classList.toggle('show');
    if (panel.classList.contains('show')) {
      updateBadge(0);
      loadContacts();
    }
  });

  const closeBtn = document.getElementById('msr-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => panel.classList.remove('show'));
  }

  const sortStorageKey = 'messengerSortMode';
  const muteStorageKey = 'messengerMuted';
  let contactSortMode = localStorage.getItem(sortStorageKey) === 'recent' ? 'recent' : 'role';
  let notificationsMuted = localStorage.getItem(muteStorageKey) === 'true';

  const muteBtn = document.getElementById('msr-mute');
  function updateMuteButton() {
    if (!muteBtn) return;
    muteBtn.classList.toggle('active', notificationsMuted);
    muteBtn.textContent = notificationsMuted ? '🔕' : '🔔';
    muteBtn.title = notificationsMuted ? 'Unmute notifications' : 'Mute notifications';
  }
  if (muteBtn) {
    updateMuteButton();
    muteBtn.addEventListener('click', () => {
      notificationsMuted = !notificationsMuted;
      localStorage.setItem(muteStorageKey, String(notificationsMuted));
      updateMuteButton();
    });
  }

  async function api(path, opts = {}){
    const normalizedOpts = { ...opts };
    normalizedOpts.credentials = normalizedOpts.credentials || 'same-origin';
    normalizedOpts.headers = { ...(normalizedOpts.headers || {}) };

    const method = (normalizedOpts.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const headerToken = normalizedOpts.headers['X-CSRF-Token'] || normalizedOpts.headers['x-csrf-token'];
      if ((!headerToken || (window.RequestHelpers && window.RequestHelpers.isCsrfTokenExpired && window.RequestHelpers.isCsrfTokenExpired(headerToken))) && window.RequestHelpers && window.RequestHelpers.refreshCsrfToken) {
        const refreshedToken = await window.RequestHelpers.refreshCsrfToken();
        if (refreshedToken) normalizedOpts.headers['X-CSRF-Token'] = refreshedToken;
      } else if (!headerToken && window.RequestHelpers && window.RequestHelpers.getCsrfToken) {
        const token = window.RequestHelpers.getCsrfToken();
        if (token) normalizedOpts.headers['X-CSRF-Token'] = token;
      }
    }

    const res = await fetch(API + path, normalizedOpts);
    return res.json();
  }

  let contactsCache = [];
  // let convoPoll = null;
  let lastMessagesCount = 0;
  let socket = null;
  let unreadCount = 0;
  const badge = document.createElement('div'); badge.id = 'messenger-badge'; badge.style.cssText = 'position:absolute; right:-6px; top:-6px; background:#C1121F; color:white; width:20px; height:20px; border-radius:50%; display:none; align-items:center; justify-content:center; font-size:12px; font-weight:700;';
  btn.style.position = 'fixed'; btn.style.display = 'flex'; btn.style.alignItems = 'center'; btn.style.justifyContent = 'center'; btn.style.zIndex = '9999';
  btn.appendChild(badge);

  async function loadContacts(){
    if (!meEmail) return;
    try {
      const resp = await api('/contacts');
      if (!resp.success) return;
      contactsCache = resp.data || [];
      renderContacts('');

      // wire search
      const searchEl = document.getElementById('msr-search');
      if (searchEl) {
        searchEl.oninput = (e) => {
          renderContacts((e.target.value || '').toLowerCase());
        };
      }

      const sortToggleEl = document.getElementById('msr-sort-toggle');
      if (sortToggleEl) {
        sortToggleEl.textContent = getSortModeLabel(contactSortMode);
        sortToggleEl.onclick = () => {
          contactSortMode = contactSortMode === 'role' ? 'recent' : 'role';
          localStorage.setItem(sortStorageKey, contactSortMode);
          sortToggleEl.textContent = getSortModeLabel(contactSortMode);
          renderContacts(document.getElementById('msr-search')?.value || '');
        };
      }

      // Keep panel state manual; do not auto-open on recent messages.
    } catch (err) {
      console.error('Load contacts', err);
    }
  }

  function renderContacts(filter) {
    const container = document.getElementById('msr-contacts-list');
    if (!container) return;
    container.innerHTML = '';
    const q = (filter || '').toLowerCase().trim();
    const list = contactsCache.filter(c => {
      if (!q) return true;
      const name = (c.fullname || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      const last = (c.lastMessage && c.lastMessage.text) ? (c.lastMessage.text || '').toLowerCase() : '';
      return name.includes(q) || email.includes(q) || last.includes(q);
    }).sort(contactSortMode === 'recent' ? sortContactsRecentFirst : sortContacts);
    list.forEach(c => {
      const el = document.createElement('div');
      el.className = 'contact';
      // highlight matching substring in name/email/last message
      const nameHtml = highlightMatch(c.fullname || c.email, filter);
      const emailHtml = (c.fullname ? ('<div class="meta">' + escapeHtml(c.email) + '</div>') : '');
      const lastText = (c.lastMessage && c.lastMessage.text) ? c.lastMessage.text : '';
      const lastHtml = '<div class="last">' + highlightMatch(lastText, filter) + '</div>';
        const avatarHtml = `<img class="contact-avatar" src="${escapeHtml(getAvatarUrl(c.avatar || ''))}" alt="${escapeHtml(c.fullname || c.email || 'User')}" />`;
        const roleText = (c.role || 'user').replace('_', ' ');
        el.innerHTML = `${avatarHtml}<div style="flex:1"><div class="contact-head"><div style="font-weight:700">${nameHtml}</div><span class="contact-role ${escapeHtml(roleBadgeClass(c.role || 'user'))}">${escapeHtml(roleText)}</span></div>${emailHtml}${lastHtml}</div><div class="dot" style="background:${c.online? '#3ddc84':'#bbb'}" title="${c.online? 'Online':'Offline'}"></div>`;
      el.addEventListener('click', () => openConversation(c));
      container.appendChild(el);
    });
    if (!list.length) {
      container.innerHTML = '<div class="msr-empty">No matching contacts</div>';
    }
  }

  function updateBadge(n) {
    unreadCount = n || 0;
    if (unreadCount > 0) { badge.style.display = 'flex'; badge.textContent = String(unreadCount > 9 ? '9+' : unreadCount); }
    else badge.style.display = 'none';
  }

  // load socket.io client then connect
  (function initSocketClient(){
    const s = document.createElement('script');
    s.src = '/socket.io/socket.io.js';
    s.onload = () => {
      try {
        socket = io();
        socket.emit('identify', meEmail);
        socket.on('message', (m) => {
          // if the incoming message is for me
          if (!m) return;
          const fromEmail = m.from && m.from.email;
          const toEmail = m.to && m.to.email;
          // if message is from someone else to me
          if (toEmail === meEmail && fromEmail !== meEmail) {
            const activeConversation = panel.classList.contains('show') && currentContact && currentContact.email === fromEmail;
            if (!activeConversation) {
              notifyIncomingMessage(m);
            }
            // if panel closed, increment badge
            if (!panel.classList.contains('show')) {
              updateBadge(unreadCount + 1);
            }
            // if open and conversation with sender is active, reload conversation
            if (panel.classList.contains('show') && currentContact && currentContact.email === fromEmail) {
              openConversation(currentContact);
              updateBadge(0);
            }
            // Refresh contacts list to show lastMessage
            loadContacts();
          }
        });

        socket.on('presence', (p) => {
          // update contacts cache if present
          if (!p || !p.email) return;
          const idx = contactsCache.findIndex(c => c.email === p.email);
          if (idx !== -1) { contactsCache[idx].online = !!p.online; contactsCache[idx].lastOnline = p.lastOnline || contactsCache[idx].lastOnline; renderContacts(document.getElementById('msr-search')?.value || ''); }
        });

        socket.on('profileUpdated', (p) => {
          if (!p || !p.email) return;

          const idx = contactsCache.findIndex(c => c.email === p.email);
          if (idx !== -1) {
            contactsCache[idx].fullname = p.fullname || contactsCache[idx].fullname;
              contactsCache[idx].avatar = typeof p.avatar !== 'undefined' ? p.avatar : contactsCache[idx].avatar;
            renderContacts(document.getElementById('msr-search')?.value || '');
          }

          if (currentContact && currentContact.email === p.email) {
            currentContact.fullname = p.fullname || currentContact.fullname;
            currentContact.avatar = typeof p.avatar !== 'undefined' ? p.avatar : currentContact.avatar;
            const convoHeadEl = document.getElementById('msr-convo-head');
            if (convoHeadEl && convoHeadEl.style.display !== 'none') {
              convoHeadEl.innerHTML = `<img class="msr-convo-avatar" src="${escapeHtml(getAvatarUrl(currentContact.avatar || ''))}" alt="${escapeHtml(currentContact.fullname || currentContact.email || 'User')}" /><div class="msr-convo-name">${escapeHtml(currentContact.fullname || currentContact.email)}</div><span class="msr-convo-role ${escapeHtml(roleBadgeClass(currentContact.role || 'user'))}">${escapeHtml((currentContact.role || 'user').replace('_', ' '))}</span>`;
            }
          }

          if (p.email === meEmail) {
            meFull = p.fullname || meFull;
            const subtitleEl = panel.querySelector('.msr-subtitle');
            if (subtitleEl) subtitleEl.textContent = meFull || meEmail;
          }
        });
      } catch (e) { console.error('socket init', e); }
    };
    document.head.appendChild(s);
  })();

  function highlightMatch(text, q) {
    if (!q) return escapeHtml(text || '');
    const t = String(text || '');
    const qi = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(' + qi + ')', 'ig');
    return escapeHtml(t).replace(re, '<mark style="background:#F4D35E;color:#111827">$1</mark>');
  }

  function getAvatarUrl(avatarFilename) {
    return avatarFilename ? `/uploads/${avatarFilename}` : 'https://via.placeholder.com/34';
  }

  function roleBadgeClass(role) {
    return role === 'super_admin' ? 'super_admin' : (role === 'admin' ? 'admin' : 'user');
  }

  function getSortModeLabel(mode) {
    return mode === 'recent' ? '🕒 Sort: Recent First' : '⚖️ Sort: Role Priority';
  }

  function requestBrowserNotificationPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  function showToastNotification(title, message) {
    if (!toastWrap) return;
    const toast = document.createElement('div');
    toast.className = 'msr-toast';
    toast.innerHTML = `<div class="msr-toast-title">${escapeHtml(title)}</div><div class="msr-toast-msg">${escapeHtml(message)}</div>`;
    toastWrap.prepend(toast);
    while (toastWrap.children.length > 3) {
      toastWrap.removeChild(toastWrap.lastChild);
    }
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity .2s ease';
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 220);
    }, 3200);
  }

  function showBrowserNotification(title, message) {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      new Notification(title, { body: message, icon: '/favicon.ico' });
    } catch (err) {
      console.error('notification error', err);
    }
  }

  function notifyIncomingMessage(message) {
    if (notificationsMuted) return;
    const senderName = (message && message.from && (message.from.fullname || message.from.email)) ? (message.from.fullname || message.from.email) : 'New message';
    const text = (message && message.text) ? message.text : 'You have a new message.';
    showToastNotification(senderName, text);
    if (document.hidden || !panel.classList.contains('show')) {
      showBrowserNotification(senderName, text);
    }
  }

  function rolePriority(role) {
    if (role === 'super_admin') return 0;
    if (role === 'admin') return 1;
    return 2;
  }

  function getLastMessageTime(contact) {
    if (!contact || !contact.lastMessage || !contact.lastMessage.date) return 0;
    const parsed = new Date(contact.lastMessage.date).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sortContacts(a, b) {
    const roleDiff = rolePriority(a?.role) - rolePriority(b?.role);
    if (roleDiff !== 0) return roleDiff;

    const timeDiff = getLastMessageTime(b) - getLastMessageTime(a);
    if (timeDiff !== 0) return timeDiff;

    const aName = (a?.fullname || a?.email || '').toLowerCase();
    const bName = (b?.fullname || b?.email || '').toLowerCase();
    return aName.localeCompare(bName);
  }

  function sortContactsRecentFirst(a, b) {
    const timeDiff = getLastMessageTime(b) - getLastMessageTime(a);
    if (timeDiff !== 0) return timeDiff;

    const roleDiff = rolePriority(a?.role) - rolePriority(b?.role);
    if (roleDiff !== 0) return roleDiff;

    const aName = (a?.fullname || a?.email || '').toLowerCase();
    const bName = (b?.fullname || b?.email || '').toLowerCase();
    return aName.localeCompare(bName);
  }

  function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  async function openConversation(contact){
    currentContact = contact;
    const messagesEl = document.getElementById('msr-messages');
    const convoHeadEl = document.getElementById('msr-convo-head');
    if (convoHeadEl) {
      convoHeadEl.style.display = 'flex';
      convoHeadEl.innerHTML = `<img class="msr-convo-avatar" src="${escapeHtml(getAvatarUrl(contact.avatar || ''))}" alt="${escapeHtml(contact.fullname || contact.email || 'User')}" /><div class="msr-convo-name">${escapeHtml(contact.fullname || contact.email)}</div><span class="msr-convo-role ${escapeHtml(roleBadgeClass(contact.role || 'user'))}">${escapeHtml((contact.role || 'user').replace('_', ' '))}</span>`;
    }
    messagesEl.innerHTML = '<div style="padding:12px;color:#666">Loading...</div>';
    try {
      const resp = await api('/conversation/' + encodeURIComponent(contact.email));
      if (!resp.success) { messagesEl.innerHTML = '<div style="padding:12px;color:#dc2626">Failed to load</div>'; return; }
      const msgs = resp.data || [];
      messagesEl.innerHTML = '';
      msgs.forEach(m => {
        const mine = m.from && m.from.email === meEmail;
        const row = document.createElement('div');
        row.className = 'msg-row ' + (mine ? 'me' : 'them');
        if (!mine) {
          const senderAvatar = document.createElement('img');
          senderAvatar.className = 'msg-avatar';
          senderAvatar.src = getAvatarUrl((m.from && m.from.avatar) || contact.avatar || '');
          senderAvatar.alt = (m.from && (m.from.fullname || m.from.email)) || (contact.fullname || contact.email || 'User');
          row.appendChild(senderAvatar);
        }
        const bubble = document.createElement('div');
        bubble.className = 'msg ' + (mine ? 'me' : 'them');
        bubble.textContent = m.text;
        row.appendChild(bubble);
        messagesEl.appendChild(row);
      });
      // scrolling and focus
      messagesEl.scrollTop = messagesEl.scrollHeight;
      document.getElementById('msr-input').focus();
      // No polling: rely on socket.io for updates
    } catch (err) {
      console.error('Open conversation', err);
    }
  }

  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && !btn.contains(e.target)) {
      panel.classList.remove('show');
    }
  });

  document.getElementById('msr-send').addEventListener('click', sendMessage);
  document.getElementById('msr-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

  async function sendMessage(){
    const input = document.getElementById('msr-input');
    const text = (input.value || '').trim();
    if (!text || !currentContact) return;
    try {
      const resp = await api('/send', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ toEmail: currentContact.email, text })
      });
      if (resp.success) {
        input.value = '';
        openConversation(currentContact);
        loadContacts();
      }
    } catch (err) { console.error('Send', err); }
  }

  // presence
  async function setPresence(online){
    if (!meEmail) return;
    try { await api('/presence', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ online }) }); } catch(e){console.error('presence', e);}  
  }
  setPresence(true);
  window.addEventListener('beforeunload', () => setPresence(false));

  // refresh contacts periodically
  setInterval(() => { if (panel.classList.contains('show')) loadContacts(); }, 15000);

})();
