/* ===== PowerSeva - shared helpers: API calls, session, layout, formatting ===== */
const API = '/api';

const Auth = {
  get token() { return localStorage.getItem('efrs_token'); },
  get user() {
    try { return JSON.parse(localStorage.getItem('efrs_user')); } catch (e) { return null; }
  },
  save(token, user) {
    localStorage.setItem('efrs_token', token);
    localStorage.setItem('efrs_user', JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem('efrs_token');
    localStorage.removeItem('efrs_user');
  }
};

async function api(path, opts = {}) {
  const headers = {};
  if (Auth.token) headers.Authorization = 'Bearer ' + Auth.token;
  let body = opts.body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(API + path, { method: opts.method || 'GET', headers, body });
  } catch (e) {
    const err = new Error(t('Cannot reach the server. Is the backend running?'));
    err.offline = true; // lets pages queue the action for later (offline mode)
    // Read-only pages keep working offline with the last answer saved on this phone
    if (!opts.method && window.PWA) {
      const saved = PWA.recall(path);
      if (saved !== undefined) { PWA.notifyStale(); return saved; }
    }
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }

  if (res.status === 401 && Auth.token) {
    Auth.clear();
    location.href = '/login.html';
    throw new Error(t('Session expired'));
  }
  if (!res.ok) throw new Error(t((data && data.message) || 'Request failed'));
  if (!opts.method && window.PWA) PWA.remember(path, data);
  return data;
}

/* ----- Formatting ----- */
function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// 'in_progress' -> 'In progress' (and into Telugu when that language is chosen)
function label(s) { return t(cap(s)); }
function fmtDate(d) {
  if (!d) return '-';
  const dt = new Date(String(d).replace(' ', 'T'));
  if (isNaN(dt)) return esc(d);
  return dt.toLocaleString(getLang() === 'te' ? 'te-IN' : 'en-IN',
    { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function statusBadge(s) { return `<span class="badge st-${esc(s)}">${esc(label(s))}</span>`; }
function priorityBadge(p) { return `<span class="badge pr-${esc(p)}">${esc(label(p))}</span>`; }
function qs(name) { return new URLSearchParams(location.search).get(name); }

/* ----- Toast & modal ----- */
function toast(msg, type = 'info') {
  let box = document.getElementById('toast-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-box';
    box.setAttribute('role', 'status');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function openModal(html) {
  closeModal();
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.id = 'modal-backdrop';
  bd.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="modal-close" aria-label="${esc(t('Close'))}">&times;</button><div id="modal-body">${html}</div></div>`;
  bd.addEventListener('click', (e) => { if (e.target === bd) closeModal(); });
  bd.querySelector('.modal-close').addEventListener('click', closeModal);
  document.body.appendChild(bd);
  const body = bd.querySelector('#modal-body');
  enableVoice(body);
  return body;
}
function closeModal() {
  const m = document.getElementById('modal-backdrop');
  if (m) m.remove();
}

/* ----- Session guards ----- */
function dashboardPath(role) { return `/${role}/dashboard.html`; }

function requireRole(role) {
  const u = Auth.user;
  if (!Auth.token || !u) { location.href = '/login.html'; return null; }
  if (u.role !== role) { location.href = dashboardPath(u.role); return null; }
  return u;
}

function logout() {
  Auth.clear();
  if (window.PWA) PWA.clearPrivateData();
  location.href = '/login.html';
}

/* ----- Sidebar + topbar for logged-in pages ----- */
const LOGO_MARK = '<span class="logo-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="13.5,2 4,14 11,14 9.5,22 20,9.5 13,9.5"/></svg></span>';

const NAV = {
  citizen: [
    ['dashboard.html', 'Dashboard'],
    ['report-fault.html', 'Report a Fault'],
    ['my-complaints.html', 'My Complaints'],
    ['track-complaint.html', 'Track Complaint'],
    ['alerts.html', 'Power Alerts']
  ],
  admin: [
    ['dashboard.html', 'Dashboard'],
    ['manage-complaints.html', 'Manage Complaints'],
    ['assign-technician.html', 'Assign Technician'],
    ['hotspots.html', 'Fault Hotspots'],
    ['predictions.html', 'Fault Prediction'],
    ['alerts.html', 'Outage Alerts'],
    ['manage-users.html', 'Manage Users'],
    ['reports.html', 'Reports']
  ],
  technician: [
    ['dashboard.html', 'Dashboard'],
    ['assigned-complaints.html', 'Assigned Complaints'],
    ['update-repair.html', 'Update Repair']
  ]
};

const BELL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

function renderLayout(role, title) {
  const user = requireRole(role);
  if (!user) return null;
  const current = location.pathname.split('/').pop();
  setPageTitle(title);
  document.documentElement.lang = getLang() === 'te' ? 'te' : 'en';

  document.getElementById('sidebar').innerHTML = `
    <div class="brand"><a class="logo" href="/${role}/dashboard.html">${LOGO_MARK}PowerSeva</a>
      <span class="role-tag">${esc(t(cap(role) + ' Portal'))}</span></div>
    <nav>${NAV[role].map(([file, text]) =>
      `<a href="/${role}/${file}" class="${file === current ? 'active' : ''}">${esc(t(text))}</a>`).join('')}
    </nav>`;

  document.getElementById('topbar').innerHTML = `
    <div class="left">
      <button class="menu-btn" id="menu-btn" aria-label="${esc(t('Menu'))}">&#9776;</button>
      <h2>${esc(t(title))}</h2>
    </div>
    <div class="right">
      <div class="lang-slot"></div>
      <button class="bell" id="bell" aria-label="${esc(t('Notifications'))}">${BELL_SVG}<span class="count hidden" id="bell-count">0</span></button>
      ${role === 'admin' ? `<div class="user-chip"><b>${esc(user.name)}</b>${esc(label(role))}</div>`
        : `<button class="user-chip as-button" id="profile-btn" title="${esc(t('My profile'))}"><b>${esc(user.name)}</b>${esc(label(role))}</button>`}
      ${role === 'admin' ? `<button class="btn btn-outline btn-sm" id="pw-btn" title="${esc(t('Change password'))}" aria-label="${esc(t('Change password'))}">&#128273;</button>` : ''}
      <button class="btn btn-outline btn-sm" id="logout-btn">${esc(t('Logout'))}</button>
    </div>`;

  mountLangSwitch(document.querySelector('#topbar .lang-slot'));
  document.getElementById('menu-btn').addEventListener('click', () =>
    document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('logout-btn').addEventListener('click', logout);
  const pwb = document.getElementById('pw-btn');
  if (pwb) pwb.addEventListener('click', openChangePassword);
  const pb = document.getElementById('profile-btn');
  if (pb) pb.addEventListener('click', () => openProfile());
  document.getElementById('bell').addEventListener('click', toggleNotifications);
  loadBellCount();
  return user;
}

async function loadBellCount() {
  try {
    const list = await api('/complaints/notifications');
    const unread = list.filter((n) => !n.is_read).length;
    const badge = document.getElementById('bell-count');
    badge.textContent = unread;
    badge.classList.toggle('hidden', unread === 0);
  } catch (e) { /* ignore */ }
}

async function toggleNotifications() {
  const existing = document.getElementById('notif-panel');
  if (existing) { existing.remove(); return; }
  const panel = document.createElement('div');
  panel.className = 'notif-panel';
  panel.id = 'notif-panel';
  panel.innerHTML = `<header>${esc(t('Notifications'))}</header><div class="empty">${esc(t('Loading...'))}</div>`;
  document.body.appendChild(panel);
  try {
    const list = await api('/complaints/notifications');
    panel.innerHTML = `<header>${esc(t('Notifications'))} <button class="btn btn-sm btn-outline" id="mark-read">${esc(t('Mark all read'))}</button></header>` +
      (list.length ? list.map((n) => `
        <div class="notif-item ${n.is_read ? '' : 'unread'}">
          <b>${esc(t(n.title))}</b>${esc(t(n.message))}<br><small>${fmtDate(n.created_at)}</small>
        </div>`).join('') : `<div class="empty">${esc(t('No notifications yet'))}</div>`);
    const btn = document.getElementById('mark-read');
    if (btn) btn.addEventListener('click', async () => {
      await api('/complaints/notifications/read', { method: 'POST' });
      panel.remove();
      loadBellCount();
    });
  } catch (e) {
    panel.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notif-panel');
  if (panel && !panel.contains(e.target) && !e.target.closest('#bell')) panel.remove();
});

/* ----- Change password (profile page for citizens / technicians, key button for admins) ----- */
function openChangePassword() {
  const body = openModal(`
    <h2>${esc(t('Change password'))}</h2>
    <form id="cp-form" novalidate>
      <div class="form-group"><label for="cp-old">${esc(t('Current password'))}</label>
        <input type="password" id="cp-old" autocomplete="current-password"><div class="error-text" id="cp-old-err"></div></div>
      <div class="form-group"><label for="cp-new">${esc(t('New password'))}</label>
        <input type="password" id="cp-new" autocomplete="new-password"><div class="error-text" id="cp-new-err"></div>
        <div class="hint">${esc(t('At least 6 characters.'))}</div></div>
      <div class="form-group"><label for="cp-confirm">${esc(t('Confirm new password'))}</label>
        <input type="password" id="cp-confirm" autocomplete="new-password"><div class="error-text" id="cp-confirm-err"></div></div>
      <p class="muted">${esc(t('Signed up with Google and never set a password? Log out and use "Forgot password?" to create one.'))}</p>
      <button class="btn" id="cp-save" type="submit">${esc(t('Update password'))}</button>
    </form>`);
  const f = (id) => body.querySelector('#' + id);
  body.querySelector('#cp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errs = {
      'cp-old': f('cp-old').value ? '' : t('Enter your current password'),
      'cp-new': f('cp-new').value.length >= 6 ? '' : t('Password must be at least 6 characters'),
      'cp-confirm': f('cp-confirm').value === f('cp-new').value ? '' : t('Passwords do not match')
    };
    Object.keys(errs).forEach((k) => { f(k + '-err').textContent = errs[k]; f(k).classList.toggle('invalid', !!errs[k]); });
    if (Object.values(errs).some(Boolean)) return;
    f('cp-save').disabled = true;
    try {
      const r = await api('/auth/change-password', { method: 'PUT', body: { current_password: f('cp-old').value, new_password: f('cp-new').value } });
      closeModal();
      toast(t(r.message), 'success');
    } catch (err) {
      toast(err.message, 'error');
      f('cp-save').disabled = false;
    }
  });
}

function showError(el, err) {
  el.innerHTML = `<div class="alert alert-error">${esc(err.message || err)}</div>`;
}
