/* ===== PowerSeva - eye button on every password field (show / hide the password) =====
 * Works for fields on the page and for fields that appear later (pop-ups). */
(function () {
  const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.9 10.9 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  const tx = (s) => (typeof t === 'function' ? t(s) : s);

  const css = document.createElement('style');
  css.textContent = '.pw-wrap{position:relative;display:block}.pw-wrap>input{padding-right:44px!important;width:100%}' +
    '.pw-eye{position:absolute;top:50%;right:6px;transform:translateY(-50%);width:34px;height:34px;display:flex;align-items:center;justify-content:center;' +
    'background:transparent;border:0;border-radius:6px;color:#5b6b7d;cursor:pointer;padding:0}.pw-eye:hover{color:#0b5cad;background:#eaf2fa}';
  document.head.appendChild(css);

  function decorate(input) {
    if (input.dataset.eye || input.type !== 'password') return;
    input.dataset.eye = '1';
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-eye';
    btn.innerHTML = EYE;
    btn.setAttribute('aria-label', tx('Show password'));
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute('aria-label', tx(show ? 'Hide password' : 'Show password'));
      input.focus();
    });
    wrap.appendChild(btn);
  }
  const scan = (root) => (root.querySelectorAll ? root.querySelectorAll('input[type=password]') : []).forEach(decorate);

  document.addEventListener('DOMContentLoaded', () => {
    scan(document);
    new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => {
      if (n.nodeType === 1) { if (n.matches && n.matches('input[type=password]')) decorate(n); else scan(n); }
    }))).observe(document.body, { childList: true, subtree: true });
  });
})();
