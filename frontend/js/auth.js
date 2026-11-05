/* ===== PowerSeva - login, registration and "Continue with Google" ===== */
const GOOGLE_G = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function showFormAlert(type, message) {
  document.getElementById('form-alert').innerHTML = `<div class="alert alert-${type}">${esc(message)}</div>`;
}

async function onGoogleCredential(response) {
  try {
    const data = await api('/auth/google', { method: 'POST', body: { credential: response.credential } });
    Auth.save(data.token, data.user);
    location.href = dashboardPath(data.user.role);
  } catch (err) {
    showFormAlert('error', err.message);
  }
}

// Draws Google's own "Continue with Google" button. Until a Google Client ID is added
// to backend/.env, a plain button explains what is missing instead.
async function setupGoogle() {
  const box = document.getElementById('google-btn');
  if (!box) return;

  const fallback = (message) => {
    box.innerHTML = `<button type="button" class="btn btn-google">${GOOGLE_G}<span>${esc(t('Continue with Google'))}</span></button>`;
    box.querySelector('button').addEventListener('click', () => toast(t(message), 'error'));
  };

  let clientId = null;
  try { clientId = (await api('/auth/config')).googleClientId; } catch (e) { /* server message shown elsewhere */ }
  if (!clientId) return fallback('Google sign-in is not set up yet. Ask the administrator to add the Google Client ID.');

  try {
    await loadScript('https://accounts.google.com/gsi/client');
  } catch (e) {
    return fallback('Could not load Google sign-in. Check your internet connection.');
  }
  google.accounts.id.initialize({ client_id: clientId, callback: onGoogleCredential });
  box.innerHTML = '';
  google.accounts.id.renderButton(box, {
    theme: 'outline', size: 'large', shape: 'rectangular', text: 'continue_with', logo_alignment: 'left',
    width: Math.min(400, Math.max(240, box.clientWidth || 340)), locale: getLang()
  });
}

function initLogin() {
  if (Auth.token && Auth.user) { location.href = dashboardPath(Auth.user.role); return; }
  setupGoogle();

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = validateForm({
      email: [[Validate.required, t('Email is required')], [Validate.gmail, t('Enter a valid Gmail address (example@gmail.com)')]],
      password: [[Validate.required, t('Password is required')]]
    });
    if (!ok) return;

    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.textContent = t('Signing in...');
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: { email: document.getElementById('email').value, password: document.getElementById('password').value }
      });
      Auth.save(data.token, data.user);
      location.href = dashboardPath(data.user.role);
    } catch (err) {
      showFormAlert('error', err.message);
      btn.disabled = false;
      btn.textContent = t('Login');
    }
  });
}

function initRegister() {
  if (Auth.token && Auth.user) { location.href = dashboardPath(Auth.user.role); return; }
  setupGoogle();

  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = validateForm({
      full_name: [[Validate.required, t('Full name is required')]],
      email: [[Validate.required, t('Email is required')], [Validate.gmail, t('Enter a valid Gmail address (example@gmail.com)')]],
      phone: [[Validate.required, t('Phone is required')], [Validate.phone, t('Enter a valid phone number (10-15 digits)')]],
      password: [[(v) => Validate.minLen(v, 6), t('Password must be at least 6 characters')]],
      confirm: [[(v) => v === document.getElementById('password').value, t('Passwords do not match')]]
    });
    if (!ok) return;

    const btn = document.getElementById('register-btn');
    btn.disabled = true;
    try {
      await api('/auth/register', {
        method: 'POST',
        body: {
          full_name: document.getElementById('full_name').value,
          email: document.getElementById('email').value,
          phone: document.getElementById('phone').value,
          address: document.getElementById('address').value,
          password: document.getElementById('password').value
        }
      });
      showFormAlert('success', t('Account created! Redirecting to login...'));
      setTimeout(() => (location.href = '/login.html'), 1400);
    } catch (err) {
      showFormAlert('error', err.message);
      btn.disabled = false;
    }
  });
}

function initForgot() {
  document.getElementById('forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = validateForm({
      email: [[Validate.required, t('Email is required')], [Validate.gmail, t('Enter a valid Gmail address (example@gmail.com)')]]
    });
    if (!ok) return;
    const btn = document.getElementById('forgot-btn');
    btn.disabled = true;
    try {
      const data = await api('/auth/forgot-password', { method: 'POST', body: { email: document.getElementById('email').value } });
      showFormAlert('success', data.message);
    } catch (err) {
      showFormAlert('error', err.message);
    }
    btn.disabled = false;
  });
}

function initReset() {
  const token = new URLSearchParams(location.search).get('token');
  if (!token) showFormAlert('error', t('This reset link is invalid or has expired'));
  document.getElementById('reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = validateForm({
      password: [[(v) => Validate.minLen(v, 6), t('Password must be at least 6 characters')]],
      confirm: [[(v) => v === document.getElementById('password').value, t('Passwords do not match')]]
    });
    if (!ok || !token) return;
    const btn = document.getElementById('reset-btn');
    btn.disabled = true;
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password: document.getElementById('password').value } });
      showFormAlert('success', t('Password updated. Redirecting to login...'));
      setTimeout(() => (location.href = '/login.html'), 1500);
    } catch (err) {
      showFormAlert('error', err.message);
      btn.disabled = false;
    }
  });
}
