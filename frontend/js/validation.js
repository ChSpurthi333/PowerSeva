/* ===== PowerSeva - client-side form validation ===== */
const Validate = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()),
  gmail: (v) => /^[a-z0-9._%+-]+@gmail\.com$/i.test(String(v).trim()),
  phone: (v) => /^[0-9+\-\s]{10,15}$/.test(String(v).trim()),
  required: (v) => String(v || '').trim().length > 0,
  minLen: (v, n) => String(v || '').length >= n
};

// rules: { fieldId: [[testFn, 'message'], ...] }  (messages must already be translated with t())
function validateForm(rules) {
  let ok = true;
  Object.keys(rules).forEach((id) => {
    const input = document.getElementById(id);
    const errBox = document.getElementById(id + '-err');
    let msg = '';
    for (const [test, text] of rules[id]) {
      if (!test(input.value)) { msg = text; break; }
    }
    input.classList.toggle('invalid', !!msg);
    if (errBox) errBox.textContent = msg;
    if (msg) ok = false;
  });
  return ok;
}
