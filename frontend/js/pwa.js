/* ===== PowerSeva - installable app + offline support =====
 * 1. registers the service worker (app opens without network)
 * 2. keeps the last answers of a few read-only calls, so fault types / my complaints still show offline
 * 3. complaints reported while offline are saved on the phone (IndexedDB, photos included) and sent automatically later
 */
(function () {
  const CACHE_PREFIX = 'efrs_cache:';
  const CACHEABLE = /^\/complaints\/(fault-types|areas|my|alerts|track\/[^/]+)$/;
  const tt = (s, v) => (typeof t === 'function' ? t(s, v) : s);
  const say = (m, type) => { if (typeof toast === 'function') toast(m, type || 'info'); };
  const userId = () => { try { return (window.Auth && Auth.user && Auth.user.id) || 0; } catch (e) { return 0; } };

  /* ---- Service worker ---- */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  /* ---- Offline banner ---- */
  function banner() {
    let el = document.getElementById('offline-banner');
    if (!navigator.onLine) {
      if (!el) {
        el = document.createElement('div');
        el.id = 'offline-banner';
        el.setAttribute('role', 'status');
        el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#7a1a15;color:#fff;text-align:center;padding:8px 12px;font:600 0.9rem system-ui,sans-serif';
        document.body.appendChild(el);
      }
      el.textContent = tt('You are offline. You can still report a fault - it will be sent when the network returns.');
    } else if (el) {
      el.remove();
    }
  }
  window.addEventListener('online', () => { banner(); PWA.flush(); });
  window.addEventListener('offline', banner);
  document.addEventListener('DOMContentLoaded', () => { banner(); PWA.flush(); });

  /* ---- Saved copies of read-only API answers (per user, cleared on logout) ---- */
  function remember(path, data) {
    if (!CACHEABLE.test(path.split('?')[0])) return;
    try { localStorage.setItem(CACHE_PREFIX + userId() + ':' + path, JSON.stringify(data)); } catch (e) { /* storage full or blocked */ }
  }
  function recall(path) {
    if (!CACHEABLE.test(path.split('?')[0])) return undefined;
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + userId() + ':' + path);
      return raw === null ? undefined : JSON.parse(raw);
    } catch (e) { return undefined; }
  }
  let staleShown = false;
  function notifyStale() {
    if (staleShown) return;
    staleShown = true;
    say(tt('You are offline. Showing the information saved on this phone.'), 'info');
  }
  function clearPrivateData() {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
  }

  /* ---- Outbox: complaints written offline ---- */
  function db() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('powerseva', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }
  const run = (mode, fn) => db().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction('outbox', mode);
    const req = fn(tx.objectStore('outbox'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  }));

  async function queueComplaint(formData) {
    const fields = [];
    formData.forEach((v, k) => fields.push([k, v])); // File / Blob values are stored as they are
    await run('readwrite', (s) => s.add({ userId: userId(), fields, savedAt: Date.now() }));
    PWA.updateCount();
  }

  let flushing = false;
  async function flush() {
    if (flushing || !navigator.onLine || !window.Auth || !Auth.token || !('indexedDB' in window)) return;
    flushing = true;
    try {
      const all = await run('readonly', (s) => s.getAll());
      for (const item of all.filter((i) => i.userId === userId())) {
        const fd = new FormData();
        item.fields.forEach(([k, v]) => fd.append(k, v));
        let res;
        try {
          res = await fetch('/api/complaints', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
        } catch (e) { break; } // still no network: try again later
        if (res.status === 401) break;
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          say(tt('Your saved complaint was sent. Complaint number: {n}', { n: data.complaint_number || '' }), 'success');
        } else if (res.status >= 500) {
          break; // server problem: keep it and retry later
        } else {
          say(tt('A saved complaint could not be sent. Please report it again.'), 'error'); // rejected for good (e.g. validation)
        }
        await run('readwrite', (s) => s.delete(item.id));
      }
    } catch (e) { /* IndexedDB unavailable */ }
    flushing = false;
    PWA.updateCount();
  }

  async function pendingCount() {
    try { return (await run('readonly', (s) => s.getAll())).filter((i) => i.userId === userId()).length; } catch (e) { return 0; }
  }
  async function updateCount() {
    const n = await pendingCount();
    let el = document.getElementById('outbox-note');
    if (!n) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'outbox-note';
      el.style.cssText = 'position:fixed;right:12px;bottom:48px;z-index:9998;background:#fff9db;border:1px solid #f2c200;border-radius:10px;padding:8px 12px;font:600 0.85rem system-ui,sans-serif;color:#4a3b00';
      document.body.appendChild(el);
    }
    el.textContent = tt('{n} complaint(s) waiting to be sent', { n });
  }

  /* ---- "Install app" button ---- */
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (document.getElementById('install-btn') || sessionStorage.getItem('efrs_install_dismissed')) return;
    const b = document.createElement('button');
    b.id = 'install-btn';
    b.textContent = tt('Install PowerSeva app');
    b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9998;background:#0a2540;color:#fff;border:0;border-radius:999px;padding:10px 16px;font:600 0.9rem system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)';
    b.addEventListener('click', async () => {
      b.remove();
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
    });
    document.body.appendChild(b);
    setTimeout(() => { try { sessionStorage.setItem('efrs_install_dismissed', '1'); } catch (x) { /* ignore */ } b.remove(); }, 20000);
  });

  window.PWA = { remember, recall, notifyStale, clearPrivateData, queueComplaint, flush, updateCount, pendingCount };
})();
