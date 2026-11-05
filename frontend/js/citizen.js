/* ===== PowerSeva - citizen pages ===== */
function complaintRows(list) {
  if (!list.length) return `<tr><td colspan="7" class="empty">${esc(t('No complaints found'))}</td></tr>`;
  return list.map((c) => {
    const link = `/citizen/track-complaint.html?number=${encodeURIComponent(c.complaint_number)}`;
    const open = OPEN_STATES.includes(c.current_status);
    return `
    <tr>
      <td><a href="${link}"><b>${esc(c.complaint_number)}</b></a></td>
      <td>${esc(c.title)} ${emergencyBadge(c)}<div class="muted">${esc(t(c.fault_type))}</div></td>
      <td>${priorityBadge(c.priority)}</td>
      <td>${statusBadge(c.current_status)}</td>
      <td>${open && c.estimated_restoration ? `${fmtDate(c.estimated_restoration)}<div class="muted">${esc(etaText(c.estimated_restoration))}</div>` : '-'}</td>
      <td>${fmtDate(c.reported_at)}</td>
      <td><a class="btn btn-sm btn-outline" href="${link}">${esc(t('Track'))}</a></td>
    </tr>`;
  }).join('');
}

const complaintHead = () => `<thead><tr><th>${esc(t('Number'))}</th><th>${esc(t('Complaint'))}</th><th>${esc(t('Priority'))}</th><th>${esc(t('Status'))}</th><th>${esc(t('Power back by'))}</th><th>${esc(t('Reported'))}</th><th></th></tr></thead>`;

const SAFETY_TIPS = [
  'Stay at least 10 metres away from fallen or hanging wires. Treat every wire as live.',
  'Do not touch anyone who is in contact with a wire. Switch off the main supply if it is safe to do so.',
  'Keep children and animals away and warn neighbours.',
  'Call the electricity emergency helpline 1912 or the national emergency number 112 now.'
];

const Citizen = {
  async dashboard() {
    const user = renderLayout('citizen', 'Dashboard');
    if (!user) return;
    const el = document.getElementById('content');
    el.innerHTML = `<div class="empty">${esc(t('Loading...'))}</div>`;
    try {
      const [list, alerts] = await Promise.all([api('/complaints/my'), api('/complaints/alerts')]);
      const n = (fn) => list.filter(fn).length;
      const awaiting = list.filter((c) => c.current_status === 'repaired');

      el.innerHTML = `
        <div class="page-title">
          <div><h1>${esc(t('Welcome, {name}', { name: user.name.split(' ')[0] }))}</h1><div class="muted">${esc(t('Report electricity faults and follow each repair.'))}</div></div>
          <a class="btn" href="/citizen/report-fault.html">${esc(t('Report a Fault'))}</a>
        </div>
        ${alerts.length ? `<div class="mb"><div class="card-header" style="margin-bottom:8px"><h2>&#9888; ${esc(t('Power alerts near you'))}</h2><a href="/citizen/alerts.html">${esc(t('View all'))}</a></div>
          ${alerts.slice(0, 2).map(alertCard).join('')}</div>` : ''}
        ${!user.area && !user.latitude ? `<div class="alert alert-info">${esc(t('Tell us your village or area to get power outage alerts near you.'))}
          <button class="btn btn-sm" id="set-area">${esc(t('Set my area'))}</button></div>` : ''}
        ${awaiting.length ? `<div class="alert alert-info"><b>${esc(t('{n} repair(s) waiting for your confirmation:', { n: awaiting.length }))}</b>
          ${awaiting.map((c) => `<a href="/citizen/track-complaint.html?number=${encodeURIComponent(c.complaint_number)}">${esc(c.complaint_number)}</a>`).join(', ')}</div>` : ''}
        <div class="stats">
          <div class="stat"><div class="num">${list.length}</div><div class="lbl">${esc(t('Total complaints'))}</div></div>
          <div class="stat amber"><div class="num">${n((c) => ['submitted', 'verified'].includes(c.current_status))}</div><div class="lbl">${esc(t('Pending'))}</div></div>
          <div class="stat purple"><div class="num">${n((c) => ['assigned', 'in_progress', 'reopened', 'escalated'].includes(c.current_status))}</div><div class="lbl">${esc(t('In progress'))}</div></div>
          <div class="stat green"><div class="num">${n((c) => ['repaired', 'closed'].includes(c.current_status))}</div><div class="lbl">${esc(t('Repaired or closed'))}</div></div>
        </div>
        <div class="card">
          <div class="card-header"><h2>${esc(t('Recent complaints'))}</h2><a href="/citizen/my-complaints.html">${esc(t('View all'))}</a></div>
          <div class="table-wrap"><table>${complaintHead()}<tbody>${complaintRows(list.slice(0, 5))}</tbody></table></div>
        </div>`;
      const b = document.getElementById('set-area');
      if (b) b.addEventListener('click', () => openProfile(() => Citizen.dashboard()));
    } catch (err) { showError(el, err); }
  },

  async alerts() {
    if (!renderLayout('citizen', 'Power Alerts')) return;
    const el = document.getElementById('content');
    el.innerHTML = `<div class="empty">${esc(t('Loading...'))}</div>`;
    try {
      const list = await api('/complaints/alerts');
      const u = Auth.user;
      el.innerHTML = `
        <div class="page-title"><div><h1>${esc(t('Power alerts near you'))}</h1>
          <div class="muted">${esc(t('Major faults and planned maintenance in your area.'))}
          ${u.area ? esc(t('Your area')) + ': <b>' + esc(u.area) + '</b>' : ''}</div></div>
          <button class="btn btn-outline" id="set-area">${esc(t('Change my area'))}</button></div>
        ${list.length ? list.map(alertCard).join('') : `<div class="card empty">${esc(t('No power alerts for your area right now.'))}</div>`}`;
      document.getElementById('set-area').addEventListener('click', () => openProfile(() => Citizen.alerts()));
    } catch (err) { showError(el, err); }
  },

  async reportFault() {
    const user = renderLayout('citizen', 'Report a Fault');
    if (!user) return;
    const select = document.getElementById('fault_type_id');
    const hint = document.getElementById('fault-hint');
    let types = [];
    try {
      types = await api('/complaints/fault-types');
      select.innerHTML = `<option value="">${esc(t('Select the type of fault'))}</option>` +
        types.map((ft) => `<option value="${ft.fault_type_id}">${esc(t(ft.name))}</option>`).join('');
    } catch (err) { toast(err.message, 'error'); }

    const areaInput = document.getElementById('area');
    if (user.area) areaInput.value = user.area;
    api('/complaints/areas').then((list) => {
      document.getElementById('area-list').innerHTML = list.map((a) => `<option value="${esc(a)}">`).join('');
    }).catch(() => {});

    select.addEventListener('change', () => {
      const ft = types.find((x) => String(x.fault_type_id) === select.value);
      hint.textContent = ft
        ? t(ft.description) + '. ' + t('Priority: {p}. Target fix time: {h} hours.', { p: label(ft.default_priority), h: ft.expected_resolution_hrs })
        : '';
      assess();
    });

    /* --- Live emergency check: dangerous words are detected while the citizen types or speaks --- */
    const box = document.getElementById('emergency-box');
    let timer = null;
    let seq = 0;
    async function assess() {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!select.value) { box.classList.add('hidden'); return; }
        const my = ++seq;
        try {
          const r = await api('/complaints/assess', {
            method: 'POST',
            body: { fault_type_id: select.value, title: document.getElementById('title').value, description: document.getElementById('description').value }
          });
          if (my !== seq) return;
          if (r.is_emergency) {
            box.classList.remove('hidden');
            box.innerHTML = `<h3>&#9888; ${esc(t('This looks like an emergency'))}</h3>
              <p>${esc(t('It will be marked critical and sent to the nearest technician straight away.'))}</p>
              <ul>${SAFETY_TIPS.map((s) => `<li>${esc(t(s))}</li>`).join('')}</ul>`;
          } else {
            box.classList.add('hidden');
          }
        } catch (e) { /* the check is only a helper */ }
      }, 500);
    }
    ['title', 'description'].forEach((id) => document.getElementById(id).addEventListener('input', assess));

    /* --- Duplicate check: the same fault already reported close by? Join it instead of filing again --- */
    const dupBox = document.getElementById('dup-box');
    const dismissed = new Set();
    let dupTimer = null;
    let dupSeq = 0;
    const checkDup = () => {
      clearTimeout(dupTimer);
      dupTimer = setTimeout(async () => {
        if (!select.value || !navigator.onLine) { dupBox.classList.add('hidden'); return; }
        const my = ++dupSeq;
        try {
          const list = (await api('/complaints/duplicates', {
            method: 'POST',
            body: { fault_type_id: select.value, latitude: document.getElementById('latitude').value, longitude: document.getElementById('longitude').value, area: areaInput.value }
          })).filter((d) => !dismissed.has(d.complaint_number));
          if (my !== dupSeq) return;
          if (!list.length) { dupBox.classList.add('hidden'); return; }
          dupBox.classList.remove('hidden');
          dupBox.innerHTML = `<h3>${esc(t('Is this the same fault?'))}</h3>
            <p>${esc(t('A similar fault was already reported nearby. Joining it gets you every update, and many reports make the repair faster.'))}</p>
            ${list.map((d) => `<div class="dup-item">
              <div><b>${esc(d.complaint_number)}</b> - ${esc(d.title)}
                <div class="muted">${statusBadge(d.current_status)} ${d.distance_m !== null ? esc(t('{n} m away', { n: d.distance_m })) + ' - ' : ''}${esc(t('{n} other(s) also reported', { n: d.support_count }))}</div></div>
              <div class="dup-actions">
                ${d.is_own || d.already_supported
                  ? `<a class="btn btn-sm btn-outline" href="/citizen/track-complaint.html?number=${encodeURIComponent(d.complaint_number)}">${esc(d.is_own ? t('This is my complaint') : t('Already joined - track'))}</a>`
                  : `<button type="button" class="btn btn-sm" data-join="${d.complaint_id}" data-num="${esc(d.complaint_number)}">${esc(t('Yes, same problem - join'))}</button>`}
                <button type="button" class="btn btn-sm btn-outline" data-skip="${esc(d.complaint_number)}">${esc(t('No, mine is different'))}</button>
              </div></div>`).join('')}`;
        } catch (e) { /* only a helper */ }
      }, 600);
    };
    dupBox.addEventListener('click', async (e) => {
      const skip = e.target.closest('[data-skip]');
      if (skip) { dismissed.add(skip.dataset.skip); checkDup(); return; }
      const join = e.target.closest('[data-join]');
      if (!join) return;
      join.disabled = true;
      try {
        const r = await api(`/complaints/${join.dataset.join}/support`, { method: 'POST', body: { note: document.getElementById('description').value.slice(0, 255) } });
        document.getElementById('form-wrap').innerHTML = `
          <div class="alert alert-success"><h2>${esc(t('You joined the existing complaint'))}</h2><p>${esc(t(r.message))}</p></div>
          <div class="mt"><a class="btn" href="/citizen/track-complaint.html?number=${encodeURIComponent(r.complaint_number)}">${esc(t('Track this complaint'))}</a>
          <a class="btn btn-outline" href="/citizen/report-fault.html">${esc(t('Report another fault'))}</a></div>`;
      } catch (err) { toast(err.message, 'error'); join.disabled = false; }
    });
    select.addEventListener('change', checkDup);
    areaInput.addEventListener('input', checkDup);

    // Citizens who signed up with Google have no phone number yet
    const needsPhone = !user.phone;
    document.getElementById('phone-group').classList.toggle('hidden', !needsPhone);

    /* --- Map: click to mark the fault, or use the phone's GPS --- */
    const lat = document.getElementById('latitude');
    const lng = document.getElementById('longitude');
    if (user.latitude && user.longitude && !lat.value) { lat.value = user.latitude; lng.value = user.longitude; }
    const pick = MapKit.picker('fault-map', lat, lng, () => {
      document.getElementById('geo-status').textContent = t('Location captured');
      checkDup();
    });
    document.getElementById('geo-btn').addEventListener('click', () =>
      MapKit.locate((a, b) => {
        if (pick) pick.put(a, b, true); else { lat.value = a.toFixed(7); lng.value = b.toFixed(7); }
        document.getElementById('geo-status').textContent = t('Location captured');
      }));

    const fileInput = document.getElementById('images');
    fileInput.addEventListener('change', () => {
      const prev = document.getElementById('preview');
      prev.innerHTML = '';
      if (fileInput.files.length > 5) {
        toast(t('You can upload at most 5 photos'), 'error');
        fileInput.value = '';
        return;
      }
      Array.from(fileInput.files).forEach((f) => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        img.alt = t('Photo');
        prev.appendChild(img);
      });
    });

    document.getElementById('fault-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const rules = {
        fault_type_id: [[Validate.required, t('Select a fault type')]],
        title: [[Validate.required, t('Give your complaint a short title')]],
        description: [[(v) => Validate.minLen(v.trim(), 10), t('Please describe the problem (at least 10 characters)')]],
        location_address: [[Validate.required, t('Enter the fault location')]]
      };
      if (needsPhone) rules.phone = [[Validate.phone, t('Enter a valid phone number (10-15 digits)')]];
      if (!validateForm(rules)) return;

      const btn = document.getElementById('submit-btn');
      btn.disabled = true;
      btn.textContent = t('Submitting...');
      try {
        const fd = new FormData(e.target);
        if (!needsPhone) fd.delete('phone');
        const res = await api('/complaints', { method: 'POST', body: fd });
        if (needsPhone) Auth.save(Auth.token, { ...user, phone: document.getElementById('phone').value.trim() });
        const track = `/citizen/track-complaint.html?number=${encodeURIComponent(res.complaint_number)}`;
        document.getElementById('form-wrap').innerHTML = `
          <div class="alert ${res.is_emergency ? 'alert-error' : 'alert-success'}">
            <h2>${esc(res.is_emergency ? t('Emergency complaint received') : t('Complaint submitted'))}</h2>
            <p>${t('Your complaint number is {n}. Keep it to track the repair.', { n: '<b>' + esc(res.complaint_number) + '</b>' })}</p>
          </div>
          <div class="detail-grid">
            <div class="item"><span>${esc(t('Priority'))}</span><b>${priorityBadge(res.priority)} ${res.is_emergency ? emergencyBadge({ is_emergency: 1 }) : ''}</b></div>
            <div class="item"><span>${esc(t('Technician'))}</span><b>${res.auto_assigned ? esc(res.technician_name) + ' <span class="muted">(' + esc(t('assigned automatically')) + ')</span>' : esc(t('Will be assigned shortly'))}</b></div>
          </div>
          ${res.estimated_restoration ? `<div class="eta-box"><div class="eta-label">${esc(t('Estimated restoration time'))}</div>
            <div class="eta-time">${fmtDate(res.estimated_restoration)}</div><div class="eta-rel">${esc(etaText(res.estimated_restoration))}</div></div>` : ''}
          ${res.is_emergency ? `<div class="emergency-box"><ul>${SAFETY_TIPS.map((s) => `<li>${esc(t(s))}</li>`).join('')}</ul></div>` : ''}
          <div class="mt">
            <a class="btn" href="${track}">${esc(t('Track this complaint'))}</a>
            <button class="btn btn-outline" data-receipt="${esc(res.complaint_number)}">&#128196; ${esc(t('Download receipt (PDF)'))}</button>
            <a class="btn btn-outline" href="/citizen/report-fault.html">${esc(t('Report another fault'))}</a>
          </div>`;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        if (err.offline && window.PWA) {
          // No network: keep the complaint (photos too) on this phone and send it automatically later
          try {
            const fd = new FormData(e.target);
            if (!needsPhone) fd.delete('phone');
            await PWA.queueComplaint(fd);
            document.getElementById('form-wrap').innerHTML = `
              <div class="alert alert-warn"><h2>${esc(t('Saved on your phone'))}</h2>
              <p>${esc(t('There is no network right now. Your complaint will be sent automatically as soon as you are back online. Keep this page or the app installed.'))}</p></div>
              <div class="mt"><a class="btn btn-outline" href="/citizen/report-fault.html">${esc(t('Report another fault'))}</a></div>`;
            return;
          } catch (qe) { /* fall through to the normal error */ }
        }
        toast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = t('Submit Complaint');
      }
    });
  },

  async myComplaints() {
    if (!renderLayout('citizen', 'My Complaints')) return;
    const el = document.getElementById('content');
    el.innerHTML = `<div class="empty">${esc(t('Loading...'))}</div>`;
    try {
      const list = await api('/complaints/my');
      el.innerHTML = `
        <div class="card">
          <div class="filters">
            <input type="search" id="f-search" placeholder="${esc(t('Search by number or title'))}">
            <select id="f-status">
              <option value="">${esc(t('All statuses'))}</option>
              ${['submitted', 'verified', 'assigned', 'in_progress', 'repaired', 'closed', 'rejected', 'escalated', 'reopened']
                .map((s) => `<option value="${s}">${esc(label(s))}</option>`).join('')}
            </select>
          </div>
          <div class="table-wrap"><table>${complaintHead()}<tbody id="rows"></tbody></table></div>
        </div>`;
      const draw = () => {
        const s = document.getElementById('f-search').value.toLowerCase();
        const st = document.getElementById('f-status').value;
        document.getElementById('rows').innerHTML = complaintRows(list.filter((c) =>
          (!st || c.current_status === st) &&
          (!s || c.complaint_number.toLowerCase().includes(s) || c.title.toLowerCase().includes(s))));
      };
      document.getElementById('f-search').addEventListener('input', draw);
      document.getElementById('f-status').addEventListener('change', draw);
      draw();
    } catch (err) { showError(el, err); }
  },

  async track() {
    if (!renderLayout('citizen', 'Track Complaint')) return;
    const result = document.getElementById('result');
    const input = document.getElementById('number');

    const load = async (number) => {
      if (!number) return;
      const data = await showTrack(number, result);
      if (data && data.complaint.current_status === 'repaired' && !data.confirmation) {
        result.insertAdjacentHTML('beforeend', Citizen.confirmForm());
        enableVoice(result);
        Citizen.wireConfirm(data.complaint.complaint_id, number);
      }
    };

    document.getElementById('track-form').addEventListener('submit', (e) => {
      e.preventDefault();
      load(input.value);
    });
    const preset = qs('number');
    if (preset) { input.value = preset; load(preset); }
  },

  confirmForm() {
    const starRow = (id) => `<div class="star-input" id="${id}">${[1, 2, 3, 4, 5].map((i) => `<span data-v="${i}" role="button" aria-label="${i}">&#9733;</span>`).join('')}</div>`;
    return `
      <hr style="margin:24px 0;border:0;border-top:1px solid var(--line)">
      <h2>${esc(t('Is the fault fixed?'))}</h2>
      <p class="muted mb">${esc(t('The technician marked this repair as complete. Please confirm so we can close the complaint.'))}</p>
      <div class="form-group">
        <label><input type="radio" name="resolved" value="true" checked>${esc(t('Yes, the fault is fixed'))}</label>
        <label><input type="radio" name="resolved" value="false">${esc(t('No, the problem still exists'))}</label>
      </div>
      <div class="form-row">
        <div class="form-group"><label>${esc(t('Rate the service'))}</label>${starRow('stars-service')}</div>
        <div class="form-group"><label>${esc(t("Rate the technician's work"))}</label>${starRow('stars-tech')}</div>
      </div>
      <div class="form-group"><label for="feedback">${esc(t('Feedback (optional)'))}</label><textarea id="feedback" maxlength="500" data-voice></textarea></div>
      <button class="btn btn-green" id="confirm-btn">${esc(t('Submit confirmation'))}</button>`;
  },

  wireConfirm(id, number) {
    const ratings = { service: 0, tech: 0 };
    const wire = (rowId, key) => {
      const row = document.querySelectorAll('#' + rowId + ' span');
      row.forEach((s) => s.addEventListener('click', () => {
        ratings[key] = Number(s.dataset.v);
        row.forEach((x) => x.classList.toggle('on', Number(x.dataset.v) <= ratings[key]));
      }));
    };
    wire('stars-service', 'service');
    wire('stars-tech', 'tech');
    document.getElementById('confirm-btn').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const res = await api(`/complaints/${id}/confirm`, {
          method: 'POST',
          body: {
            is_resolved: document.querySelector('input[name=resolved]:checked').value === 'true',
            rating: ratings.service || null,
            technician_rating: ratings.tech || null,
            feedback: document.getElementById('feedback').value
          }
        });
        toast(t(res.message), 'success');
        setTimeout(() => (location.href = '/citizen/track-complaint.html?number=' + encodeURIComponent(number)), 900);
      } catch (err) {
        toast(err.message, 'error');
        e.target.disabled = false;
      }
    });
  }
};
