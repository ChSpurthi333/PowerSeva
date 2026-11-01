/* ===== PowerSeva - admin pages ===== */
const ALL_STATUSES = ['submitted', 'verified', 'assigned', 'in_progress', 'repaired', 'closed', 'rejected', 'escalated', 'reopened'];

function adminRows(list) {
  if (!list.length) return `<tr><td colspan="8" class="empty">${esc(t('No complaints found'))}</td></tr>`;
  return list.map((c) => `
    <tr>
      <td><a href="#" data-view="${esc(c.complaint_number)}"><b>${esc(c.complaint_number)}</b></a></td>
      <td>${esc(c.title)} ${emergencyBadge(c)}<div class="muted">${esc(t(c.fault_type))}<br>${esc(c.location_address)}${c.area ? ' (' + esc(t(c.area)) + ')' : ''}</div></td>
      <td>${esc(c.citizen_name)}<div class="muted">${esc(c.citizen_phone || '-')}</div></td>
      <td>${priorityBadge(c.priority)}</td>
      <td>${statusBadge(c.current_status)}${Number(c.is_overdue) ? `<span class="overdue-tag">${esc(t('OVERDUE'))}</span>` : ''}</td>
      <td>${esc(c.technician_name || '-')}${Number(c.auto_assigned) && c.technician_name ? `<div class="muted">${esc(t('auto'))}</div>` : ''}</td>
      <td>${fmtDate(c.reported_at)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-outline" data-view="${esc(c.complaint_number)}">${esc(t('View'))}</button>
        <button class="btn btn-sm btn-dark" data-status="${c.complaint_id}" data-num="${esc(c.complaint_number)}" data-cur="${esc(c.current_status)}">${esc(t('Status'))}</button>
        <a class="btn btn-sm" href="/admin/assign-technician.html?id=${c.complaint_id}">${esc(t('Assign'))}</a>
      </td>
    </tr>`).join('');
}
const adminHead = () => `<thead><tr><th>${esc(t('Number'))}</th><th>${esc(t('Complaint'))}</th><th>${esc(t('Citizen'))}</th><th>${esc(t('Priority'))}</th><th>${esc(t('Status'))}</th><th>${esc(t('Technician'))}</th><th>${esc(t('Reported'))}</th><th></th></tr></thead>`;

// Wires the View / Status buttons inside a container
function wireComplaintActions(container, reload) {
  container.addEventListener('click', async (e) => {
    const view = e.target.closest('[data-view]');
    if (view) {
      e.preventDefault();
      const body = openModal(`<div class="empty">${esc(t('Loading...'))}</div>`);
      await showTrack(view.dataset.view, body);
      return;
    }
    const st = e.target.closest('[data-status]');
    if (st) {
      const body = openModal(`
        <h2>${esc(t('Change status'))}: ${esc(st.dataset.num)}</h2>
        <div class="form-group mt"><label for="new-status">${esc(t('New status'))}</label>
          <select id="new-status">${ALL_STATUSES.map((s) => `<option value="${s}" ${s === st.dataset.cur ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}</select></div>
        <div class="form-group"><label for="remarks">${esc(t('Remarks'))}</label><textarea id="remarks" data-voice placeholder="${esc(t('Reason or note shown in the history'))}"></textarea></div>
        <button class="btn" id="save-status">${esc(t('Update status'))}</button>`);
      body.querySelector('#save-status').addEventListener('click', async () => {
        try {
          await api(`/admin/complaints/${st.dataset.status}/status`, {
            method: 'PUT',
            body: { status: body.querySelector('#new-status').value, remarks: body.querySelector('#remarks').value }
          });
          closeModal();
          toast(t('Status updated'), 'success');
          reload();
        } catch (err) { toast(err.message, 'error'); }
      });
    }
  });
}


/* ----- Risk card used by the admin dashboard and the predictions page ----- */
function sparkline(values) {
  const max = Math.max(1, ...values);
  return `<svg class="spark" viewBox="0 0 ${values.length * 8} 24" preserveAspectRatio="none" aria-hidden="true">${values.map((v, i) =>
    `<rect x="${i * 8 + 1}" y="${24 - (v / max) * 22}" width="6" height="${Math.max(1, (v / max) * 22)}" rx="1"/>`).join('')}</svg>`;
}
function riskCard(a) {
  const trendIcon = { rising: '&#8599;', falling: '&#8600;', steady: '&#8594;' }[a.trend] || '';
  return `<div class="risk risk-${esc(a.risk_level)}">
    <div class="risk-head"><b>${esc(t(a.area))}</b><span class="badge risk-badge">${esc(label(a.risk_level))} ${esc(t('risk'))}</span></div>
    <div class="score"><div class="score-bar"><div style="width:${a.risk_score}%"></div></div><b>${a.risk_score}</b></div>
    <div class="muted">${esc(t('Likely fault'))}: <b>${esc(t(a.likely_fault || '-'))}</b></div>
    <div class="muted">${esc(t('Expected in next 30 days'))}: <b>${a.forecast_30d}</b> ${trendIcon} ${esc(label(a.trend))}</div>
    ${sparkline(a.weekly || [])}
  </div>`;
}

const Admin = {
  async dashboard() {
    const user = renderLayout('admin', 'Dashboard');
    if (!user) return;
    const el = document.getElementById('content');
    el.innerHTML = `<div class="empty">${esc(t('Loading...'))}</div>`;

    const load = async () => {
      try {
        const [s, list, escs, pred] = await Promise.all([
          api('/admin/stats'), api('/admin/complaints'), api('/admin/escalations'), api('/admin/predictions').catch(() => ({ areas: [] }))
        ]);
        const risky = (pred.areas || []).filter((a) => a.risk_level === 'high' || a.risk_level === 'medium').slice(0, 4);
        const attention = list.filter((c) => Number(c.is_emergency) && OPEN_STATES.includes(c.current_status) || Number(c.is_overdue) || c.current_status === 'escalated' ||
          (['submitted', 'verified', 'reopened'].includes(c.current_status))).slice(0, 8);
        const openEsc = escs.filter((x) => x.escalation_status !== 'resolved');

        el.innerHTML = `
          <div class="page-title">
            <div><h1>${esc(t('Operations overview'))}</h1><div class="muted">${esc(t('Live status of all fault complaints.'))}</div></div>
            <div><button class="btn btn-outline" id="auto-all">${esc(t('Auto-assign all waiting'))}</button>
            <button class="btn btn-dark" id="run-esc">${esc(t('Escalate overdue complaints'))}</button></div>
          </div>
          <div class="stats">
            <div class="stat"><div class="num">${s.total}</div><div class="lbl">${esc(t('Total complaints'))}</div></div>
            <div class="stat red"><div class="num">${s.emergencies || 0}</div><div class="lbl">${esc(t('Open emergencies'))}</div></div>
            <div class="stat amber"><div class="num">${s.unassigned || 0}</div><div class="lbl">${esc(t('Waiting for a technician'))}</div></div>
            <div class="stat purple"><div class="num">${s.active_alerts || 0}</div><div class="lbl">${esc(t('Active outage alerts'))}</div></div>
            <div class="stat amber"><div class="num">${s.pending || 0}</div><div class="lbl">${esc(t('Awaiting action'))}</div></div>
            <div class="stat purple"><div class="num">${s.in_progress || 0}</div><div class="lbl">${esc(t('In progress'))}</div></div>
            <div class="stat red"><div class="num">${s.overdue || 0}</div><div class="lbl">${esc(t('Overdue'))}</div></div>
            <div class="stat red"><div class="num">${s.escalated || 0}</div><div class="lbl">${esc(t('Escalated'))}</div></div>
            <div class="stat green"><div class="num">${s.resolved || 0}</div><div class="lbl">${esc(t('Repaired or closed'))}</div></div>
            <div class="stat"><div class="num">${s.technicians || 0}</div><div class="lbl">${esc(t('Technicians'))}</div></div>
            <div class="stat"><div class="num">${s.citizens || 0}</div><div class="lbl">${esc(t('Citizens'))}</div></div>
          </div>
          ${risky.length ? `<div class="card mb"><div class="card-header"><h2>${esc(t('Areas likely to have faults soon'))}</h2><a href="/admin/predictions.html">${esc(t('Open predictions'))}</a></div>
            <div class="risk-grid">${risky.map(riskCard).join('')}</div></div>` : ''}
          <div class="card mb">
            <div class="card-header"><h2>${esc(t('Needs attention'))}</h2><a href="/admin/manage-complaints.html">${esc(t('Manage all'))}</a></div>
            <div class="table-wrap"><table>${adminHead()}<tbody id="rows">${adminRows(attention)}</tbody></table></div>
          </div>
          <div class="card">
            <div class="card-header"><h2>${esc(t('Open escalations ({n})', { n: openEsc.length }))}</h2></div>
            <div class="table-wrap"><table>
              <thead><tr><th>${esc(t('Complaint'))}</th><th>${esc(t('Level'))}</th><th>${esc(t('Reason'))}</th><th>${esc(t('Escalated on'))}</th><th>${esc(t('Status'))}</th><th></th></tr></thead>
              <tbody>${openEsc.length ? openEsc.map((x) => `
                <tr><td><b>${esc(x.complaint_number)}</b><div class="muted">${esc(x.title)}</div></td>
                <td>${x.escalation_level}</td><td>${esc(t(x.reason))}</td><td>${fmtDate(x.escalated_at)}</td>
                <td>${esc(label(x.escalation_status))}</td>
                <td><button class="btn btn-sm btn-green" data-resolve="${x.escalation_id}">${esc(t('Mark resolved'))}</button></td></tr>`).join('')
                : `<tr><td colspan="6" class="empty">${esc(t('No open escalations'))}</td></tr>`}</tbody></table></div>
          </div>`;

        document.getElementById('auto-all').addEventListener('click', async () => {
          try { const r = await api('/admin/auto-assign-all', { method: 'POST' }); toast(t(r.message), 'success'); load(); }
          catch (err) { toast(err.message, 'error'); }
        });
        document.getElementById('run-esc').addEventListener('click', async () => {
          try {
            const r = await api('/admin/escalations/run', { method: 'POST' });
            toast(t(r.message), 'success');
            load();
          } catch (err) { toast(err.message, 'error'); }
        });
        el.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', async () => {
          try {
            await api(`/admin/escalations/${b.dataset.resolve}/resolve`, { method: 'PUT', body: { note: 'Reviewed by admin' } });
            toast(t('Escalation resolved'), 'success');
            load();
          } catch (err) { toast(err.message, 'error'); }
        }));
      } catch (err) { showError(el, err); }
    };
    wireComplaintActions(el, load);
    load();
  },

  async manageComplaints() {
    if (!renderLayout('admin', 'Manage Complaints')) return;
    const el = document.getElementById('content');
    el.innerHTML = `
      <div class="card">
        <div class="filters">
          <input type="search" id="f-search" placeholder="${esc(t('Search number, title or location'))}">
          <select id="f-status"><option value="">${esc(t('All statuses'))}</option>${ALL_STATUSES.map((s) => `<option value="${s}">${esc(label(s))}</option>`).join('')}</select>
          <select id="f-priority"><option value="">${esc(t('All priorities'))}</option>
            ${['critical', 'high', 'medium', 'low'].map((p) => `<option value="${p}">${esc(label(p))}</option>`).join('')}</select>
          <label class="check"><input type="checkbox" id="f-emergency">${esc(t('Emergencies only'))}</label>
          <label class="check"><input type="checkbox" id="f-unassigned">${esc(t('No technician yet'))}</label>
        </div>
        <div class="table-wrap"><table>${adminHead()}<tbody id="rows"><tr><td colspan="8" class="empty">${esc(t('Loading...'))}</td></tr></tbody></table></div>
      </div>`;
    const load = async () => {
      const p = new URLSearchParams();
      ['search', 'status', 'priority'].forEach((k) => {
        const v = document.getElementById('f-' + k).value;
        if (v) p.set(k, v);
      });
      if (document.getElementById('f-emergency').checked) p.set('emergency', '1');
      if (document.getElementById('f-unassigned').checked) p.set('unassigned', '1');
      try {
        document.getElementById('rows').innerHTML = adminRows(await api('/admin/complaints?' + p.toString()));
      } catch (err) { toast(err.message, 'error'); }
    };
    let timer;
    document.getElementById('f-search').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
    document.getElementById('f-status').addEventListener('change', load);
    document.getElementById('f-priority').addEventListener('change', load);
    document.getElementById('f-emergency').addEventListener('change', load);
    document.getElementById('f-unassigned').addEventListener('change', load);
    wireComplaintActions(el, load);
    load();
  },

  async assignTechnician() {
    if (!renderLayout('admin', 'Assign Technician')) return;
    const el = document.getElementById('content');
    el.innerHTML = `<div class="empty">${esc(t('Loading...'))}</div>`;
    try {
      const all = await api('/admin/complaints');
      const open = all.filter((c) => !['closed', 'rejected', 'repaired'].includes(c.current_status));
      const preset = qs('id');

      el.innerHTML = `
        <div class="card mb" style="max-width:980px">
          <h2 class="mb">${esc(t('Assign a technician to a complaint'))}</h2>
          <p class="muted mb">${esc(t('Technicians are ranked by expertise, distance, current workload and availability.'))}</p>
          <div class="form-group"><label for="complaint">${esc(t('Complaint'))}</label>
            <select id="complaint">
              <option value="">${esc(t('Select a complaint'))}</option>
              ${open.map((c) => `<option value="${c.complaint_id}" ${String(c.complaint_id) === preset ? 'selected' : ''}>
                ${Number(c.is_emergency) ? '[!] ' : ''}${esc(c.complaint_number)} - ${esc(c.title)} (${esc(label(c.priority))})${c.technician_name ? ' - ' + esc(t('now')) + ': ' + esc(c.technician_name) : ''}</option>`).join('')}
            </select><div class="error-text" id="complaint-err"></div></div>
          <div id="ranking"></div>
        </div>
        <div class="card" style="max-width:980px">
          <h2 class="mb">${esc(t('Visit details'))}</h2>
          <div class="form-group"><label for="visit">${esc(t('Scheduled visit (optional)'))}</label><input type="datetime-local" id="visit"></div>
          <div class="form-group"><label for="remarks">${esc(t('Instructions for the technician'))}</label><textarea id="remarks" data-voice></textarea></div>
          <div class="muted">${esc(t('These are sent along when you press Assign next to a technician.'))}</div>
        </div>`;
      enableVoice(el);

      const sel = document.getElementById('complaint');
      const box = document.getElementById('ranking');
      const show = async () => {
        if (!sel.value) { box.innerHTML = ''; return; }
        box.innerHTML = `<div class="empty">${esc(t('Loading...'))}</div>`;
        try {
          const list = await api(`/admin/complaints/${sel.value}/suggestions`);
          const best = list.find((x) => x.eligible);
          box.innerHTML = `
            <div class="card-header"><h3>${esc(t('Suggested technicians'))}</h3>
              <button class="btn btn-green" id="auto-one" ${best ? '' : 'disabled'}>${esc(t('Auto-assign best match'))}</button></div>
            <div class="table-wrap"><table>
              <thead><tr><th>${esc(t('Technician'))}</th><th>${esc(t('Match score'))}</th><th>${esc(t('Why'))}</th><th>${esc(t('Rating'))}</th><th></th></tr></thead>
              <tbody>${list.length ? list.map((x, i) => `
                <tr class="${x.eligible ? '' : 'dim'}">
                  <td><b>${esc(x.name)}</b>${i === 0 && x.eligible ? ` <span class="badge st-closed">${esc(t('Best match'))}</span>` : ''}<div class="muted">${esc(x.phone || '')}</div></td>
                  <td style="min-width:150px"><div class="score"><div class="score-bar"><div style="width:${x.score}%"></div></div><b>${x.score}</b></div>
                    <div class="muted mini">${esc(t('Skill'))} ${x.breakdown.expertise} - ${esc(t('Distance'))} ${x.breakdown.distance} - ${esc(t('Workload'))} ${x.breakdown.workload}</div></td>
                  <td>${x.reasons.map((r) => esc(t(r))).join(', ')}</td>
                  <td>${x.avg_rating ? stars(Math.round(x.avg_rating)) + ' ' + x.avg_rating : '-'}</td>
                  <td><button class="btn btn-sm" data-pick="${x.technician_id}">${esc(t('Assign'))}</button></td>
                </tr>`).join('') : `<tr><td colspan="5" class="empty">${esc(t('No technicians yet. Add one from Manage Users.'))}</td></tr>`}</tbody></table></div>`;
        } catch (err) { showError(box, err); }
      };
      sel.addEventListener('change', show);
      show();

      const done = (r) => { toast(t(r.message), 'success'); setTimeout(() => (location.href = '/admin/manage-complaints.html'), 900); };
      box.addEventListener('click', async (e) => {
        const pick = e.target.closest('[data-pick]');
        const auto = e.target.closest('#auto-one');
        try {
          if (pick) {
            done(await api(`/admin/complaints/${sel.value}/assign`, {
              method: 'POST',
              body: {
                technician_id: pick.dataset.pick,
                scheduled_visit: document.getElementById('visit').value || null,
                remarks: document.getElementById('remarks').value
              }
            }));
          } else if (auto) {
            done(await api(`/admin/complaints/${sel.value}/auto-assign`, { method: 'POST' }));
          }
        } catch (err) { toast(err.message, 'error'); }
      });
    } catch (err) { showError(el, err); }
  },

  async manageUsers() {
    if (!renderLayout('admin', 'Manage Users')) return;
    const el = document.getElementById('content');
    let types = [];
    try { types = await api('/complaints/fault-types'); } catch (e) { /* skills picker stays empty */ }
    const skillBoxes = (selected, prefix) => `<div class="skill-grid">${types.map((ft) => `
      <label class="check"><input type="checkbox" class="${prefix}" value="${ft.fault_type_id}" ${selected.includes(ft.fault_type_id) ? 'checked' : ''}>${esc(t(ft.name))}</label>`).join('')}</div>`;

    el.innerHTML = `
      <div class="card mb">
        <div class="card-header"><h2>${esc(t('Add a technician or admin'))}</h2></div>
        <form id="user-form" novalidate>
          <div class="form-row">
            <div class="form-group"><label for="full_name">${esc(t('Full name'))}</label><input id="full_name" data-voice><div class="error-text" id="full_name-err"></div></div>
            <div class="form-group"><label for="role">${esc(t('Role'))}</label><select id="role"><option value="technician">${esc(t('Technician'))}</option><option value="admin">${esc(t('Admin'))}</option></select></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label for="email">${esc(t('Gmail address'))}</label><input id="email" type="email" placeholder="name@gmail.com"><div class="error-text" id="email-err"></div></div>
            <div class="form-group"><label for="phone">${esc(t('Phone'))}</label><input id="phone" type="tel"><div class="error-text" id="phone-err"></div></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label for="password">${esc(t('Temporary password'))}</label><input id="password" type="password"><div class="error-text" id="password-err"></div></div>
            <div class="form-group" id="area-group"><label for="area">${esc(t('Home area of the technician'))}</label><input id="area" maxlength="100" data-voice></div>
          </div>
          <div class="form-group" id="skill-group"><label>${esc(t('Expertise (fault types this technician can repair)'))}</label>${skillBoxes([], 'new-skill')}</div>
          <button class="btn" type="submit">${esc(t('Create account'))}</button>
          <span class="muted">${esc(t('After creating a technician, use Edit to mark the exact base location on the map.'))}</span>
        </form>
      </div>
      <div class="card">
        <div class="filters">
          <select id="f-role"><option value="">${esc(t('All roles'))}</option><option value="citizen">${esc(t('Citizens'))}</option><option value="technician">${esc(t('Technicians'))}</option><option value="admin">${esc(t('Admins'))}</option></select>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>${esc(t('Name'))}</th><th>${esc(t('Email'))}</th><th>${esc(t('Phone'))}</th><th>${esc(t('Role'))}</th><th>${esc(t('Area'))}</th><th>${esc(t('Status'))}</th><th></th></tr></thead>
          <tbody id="rows"></tbody></table></div>
      </div>`;
    enableVoice(el);

    const roleSel = document.getElementById('role');
    const toggleTech = () => ['area-group', 'skill-group'].forEach((id) =>
      document.getElementById(id).classList.toggle('hidden', roleSel.value !== 'technician'));
    roleSel.addEventListener('change', toggleTech);
    toggleTech();

    const me = Auth.user;
    let users = [];
    const draw = () => {
      document.getElementById('rows').innerHTML = users.length ? users.map((u) => `
        <tr><td><b>${esc(u.full_name)}</b>${u.role === 'technician' && u.avg_rating ? `<div class="muted">${stars(Math.round(u.avg_rating))} ${u.avg_rating}</div>` : ''}</td>
        <td>${esc(u.email)}</td><td>${esc(u.phone || '-')}</td>
        <td>${esc(label(u.role))}${u.role === 'technician' ? `<div class="muted">${esc(Number(u.is_available) ? t('Available') : t('On leave'))}</div>` : ''}</td>
        <td>${esc(t(u.area || '-'))}</td>
        <td><span class="badge ${u.is_active ? 'st-closed' : 'st-rejected'}">${esc(u.is_active ? t('Active') : t('Inactive'))}</span></td>
        <td style="white-space:nowrap">${u.role === 'technician' ? `<button class="btn btn-sm btn-outline" data-edit="${u.user_id}">${esc(t('Edit'))}</button> ` : ''}
          ${u.user_id === me.id ? '' : `<button class="btn btn-sm ${u.is_active ? 'btn-red' : 'btn-green'}" data-toggle="${u.user_id}" data-active="${u.is_active ? 0 : 1}">${esc(u.is_active ? t('Deactivate') : t('Activate'))}</button>`}</td></tr>`).join('')
        : `<tr><td colspan="7" class="empty">${esc(t('No users'))}</td></tr>`;
    };
    const load = async () => {
      const role = document.getElementById('f-role').value;
      try { users = await api('/admin/users' + (role ? '?role=' + role : '')); draw(); } catch (err) { toast(err.message, 'error'); }
    };
    document.getElementById('f-role').addEventListener('change', load);

    document.getElementById('rows').addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-edit]');
      if (ed) {
        const u = users.find((x) => String(x.user_id) === ed.dataset.edit);
        const body = openModal(`
          <h2>${esc(t('Edit technician'))}: ${esc(u.full_name)}</h2>
          <div class="form-group"><label for="e-area">${esc(t('Home area of the technician'))}</label><input id="e-area" value="${esc(u.area || '')}" maxlength="100" data-voice></div>
          <div class="form-group"><label><input type="checkbox" id="e-avail" ${Number(u.is_available) ? 'checked' : ''}>${esc(t('Available for new jobs'))}</label></div>
          <div class="form-group"><label>${esc(t('Expertise (fault types this technician can repair)'))}</label>${skillBoxes(u.skills || [], 'e-skill')}</div>
          <div class="form-group"><label>${esc(t('Base location (click the map)'))}</label><div id="e-map" class="map map-sm"></div>
            <input type="hidden" id="e-lat" value="${u.latitude ?? ''}"><input type="hidden" id="e-lng" value="${u.longitude ?? ''}"></div>
          <button class="btn" id="e-save">${esc(t('Save'))}</button>`);
        const pick = MapKit.picker('e-map', body.querySelector('#e-lat'), body.querySelector('#e-lng'));
        setTimeout(() => { if (pick) pick.map.invalidateSize(); }, 250);
        body.querySelector('#e-save').addEventListener('click', async () => {
          try {
            await api(`/admin/users/${u.user_id}/technician`, {
              method: 'PUT',
              body: {
                area: body.querySelector('#e-area').value,
                latitude: body.querySelector('#e-lat').value || null,
                longitude: body.querySelector('#e-lng').value || null,
                is_available: body.querySelector('#e-avail').checked,
                fault_type_ids: Array.from(body.querySelectorAll('.e-skill:checked')).map((x) => Number(x.value))
              }
            });
            closeModal();
            toast(t('Technician updated'), 'success');
            load();
          } catch (err) { toast(err.message, 'error'); }
        });
        return;
      }
      const b = e.target.closest('[data-toggle]');
      if (!b) return;
      try {
        await api(`/admin/users/${b.dataset.toggle}/active`, { method: 'PUT', body: { is_active: b.dataset.active === '1' } });
        load();
      } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const ok = validateForm({
        full_name: [[Validate.required, t('Name is required')]],
        email: [[Validate.gmail, t('Enter a valid Gmail address (example@gmail.com)')]],
        phone: [[Validate.phone, t('Enter a valid phone number (10-15 digits)')]],
        password: [[(v) => Validate.minLen(v, 6), t('Password must be at least 6 characters')]]
      });
      if (!ok) return;
      try {
        const r = await api('/admin/users', {
          method: 'POST',
          body: {
            ...['full_name', 'role', 'email', 'phone', 'password', 'area'].reduce((o, k) => ({ ...o, [k]: document.getElementById(k).value }), {}),
            fault_type_ids: Array.from(document.querySelectorAll('.new-skill:checked')).map((x) => Number(x.value))
          }
        });
        toast(t(r.message), 'success');
        e.target.reset();
        toggleTech();
        load();
      } catch (err) { toast(err.message, 'error'); }
    });
    load();
  },

  async reports() {
    if (!renderLayout('admin', 'Reports')) return;
    const el = document.getElementById('content');
    el.innerHTML = `<div class="empty">${esc(t('Loading...'))}</div>`;
    try {
      const r = await api('/admin/reports');
      const bars = (rows) => {
        const max = Math.max(1, ...rows.map((x) => Number(x.count)));
        return rows.length ? rows.map((x) => `
          <div class="bar-row"><span>${esc(label(x.label))}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(Number(x.count) / max) * 100}%"></div></div>
          <b>${x.count}</b></div>`).join('') : `<div class="empty">${esc(t('No data yet'))}</div>`;
      };
      const s = r.summary || {};
      el.innerHTML = `
        <div class="page-title"><div><h1>${esc(t('Reports'))}</h1><div class="muted">${esc(t('Performance summary of the fault management system.'))}</div></div>
          <div class="no-print"><button class="btn btn-outline" id="print-btn">${esc(t('Print'))}</button>
          <button class="btn btn-dark" id="csv-btn">${esc(t('Download complaints CSV'))}</button></div></div>
        <div class="stats">
          <div class="stat"><div class="num">${s.avg_resolution_hours ?? '-'}</div><div class="lbl">${esc(t('Average fix time (hours)'))}</div></div>
          <div class="stat amber"><div class="num">${s.avg_rating ?? '-'}</div><div class="lbl">${esc(t('Average citizen rating (out of 5)'))}</div></div>
          <div class="stat amber"><div class="num">${s.avg_technician_rating ?? '-'}</div><div class="lbl">${esc(t('Average technician rating (out of 5)'))}</div></div>
          <div class="stat red"><div class="num">${s.total_emergencies ?? 0}</div><div class="lbl">${esc(t('Emergency complaints'))}</div></div>
          <div class="stat"><div class="num">${s.auto_assigned ?? 0}</div><div class="lbl">${esc(t('Assigned automatically'))}</div></div>
          <div class="stat red"><div class="num">${s.total_escalations ?? 0}</div><div class="lbl">${esc(t('Total escalations'))}</div></div>
        </div>
        <div class="report-grid">
          <div class="card"><h2 class="mb">${esc(t('Complaints by status'))}</h2>${bars(r.byStatus)}</div>
          <div class="card"><h2 class="mb">${esc(t('Complaints by fault type'))}</h2>${bars(r.byFaultType)}</div>
          <div class="card"><h2 class="mb">${esc(t('Complaints by priority'))}</h2>${bars(r.byPriority)}</div>
          <div class="card"><h2 class="mb">${esc(t('Complaints by area'))}</h2>${bars(r.byArea || [])}</div>
          <div class="card"><h2 class="mb">${esc(t('Technician performance'))}</h2>
            <div class="table-wrap"><table><thead><tr><th>${esc(t('Technician'))}</th><th>${esc(t('Completed'))}</th><th>${esc(t('Active'))}</th><th>${esc(t('Rating'))}</th></tr></thead><tbody>
            ${r.technicianPerformance.length ? r.technicianPerformance.map((tp) => `<tr><td>${esc(tp.label)}</td><td>${tp.completed || 0}</td><td>${tp.active || 0}</td><td>${tp.avg_rating ? stars(Math.round(tp.avg_rating)) + ' ' + tp.avg_rating + ' (' + tp.rating_count + ')' : '-'}</td></tr>`).join('')
              : `<tr><td colspan="4" class="empty">${esc(t('No technicians'))}</td></tr>`}</tbody></table></div></div>
        </div>`;
      document.getElementById('print-btn').addEventListener('click', () => window.print());
      document.getElementById('csv-btn').addEventListener('click', async () => {
        const list = await api('/admin/complaints');
        const cols = ['complaint_number', 'title', 'fault_type', 'priority', 'current_status', 'citizen_name', 'technician_name', 'reported_at', 'due_by'];
        const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csv = '﻿' + [cols.join(','), ...list.map((c) => cols.map((k) => cell(c[k])).join(','))].join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = 'complaints.csv';
        a.click();
      });
    } catch (err) { showError(el, err); }
  },

  /* ----- Fault hotspot heatmap ----- */
  async hotspots() {
    if (!renderLayout('admin', 'Fault Hotspots')) return;
    const el = document.getElementById('content');
    let types = [];
    try { types = await api('/complaints/fault-types'); } catch (e) { /* filter stays empty */ }
    el.innerHTML = `
      <div class="page-title"><div><h1>${esc(t('Fault hotspots'))}</h1>
        <div class="muted">${esc(t('Areas with frequent electricity faults. Warmer colours mean more complaints.'))}</div></div></div>
      <div class="card mb">
        <div class="filters">
          <select id="h-days">${[[30, 'Last 30 days'], [90, 'Last 90 days'], [180, 'Last 6 months'], [365, 'Last year']].map(([v, l]) => `<option value="${v}" ${v === 90 ? 'selected' : ''}>${esc(t(l))}</option>`).join('')}</select>
          <select id="h-type"><option value="">${esc(t('All fault types'))}</option>${types.map((ft) => `<option value="${ft.fault_type_id}">${esc(t(ft.name))}</option>`).join('')}</select>
        </div>
        <div id="heat-map" class="map map-lg"></div>
        <div class="heat-legend"><span>${esc(t('Fewer faults'))}</span><i></i><span>${esc(t('More faults'))}</span></div>
      </div>
      <div class="card"><div class="card-header"><h2>${esc(t('Problem-prone areas'))}</h2><span class="muted" id="h-summary"></span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>${esc(t('Area'))}</th><th>${esc(t('Complaints'))}</th><th></th><th>${esc(t('Critical'))}</th><th>${esc(t('Emergencies'))}</th><th>${esc(t('Most common fault'))}</th><th>${esc(t('Last reported'))}</th></tr></thead>
          <tbody id="h-rows"></tbody></table></div></div>`;

    const map = MapKit.create('heat-map', DEFAULT_CENTER, 10);
    let layer = null;
    const load = async () => {
      const p = new URLSearchParams({ days: document.getElementById('h-days').value });
      if (document.getElementById('h-type').value) p.set('fault_type_id', document.getElementById('h-type').value);
      try {
        const d = await api('/admin/hotspots?' + p.toString());
        if (map) {
          if (layer) map.removeLayer(layer);
          layer = MapKit.heat(map, d.points);
        }
        document.getElementById('h-summary').textContent = t('{n} complaints, {m} with a map position', { n: d.total, m: d.mapped });
        const max = Math.max(1, ...d.areas.map((a) => Number(a.count)));
        document.getElementById('h-rows').innerHTML = d.areas.length ? d.areas.map((a) => `
          <tr><td><b>${esc(t(a.area))}</b></td><td>${a.count}</td>
          <td style="min-width:120px"><div class="bar-track"><div class="bar-fill hot" style="width:${(a.count / max) * 100}%"></div></div></td>
          <td>${a.critical}</td><td>${a.emergencies}</td><td>${esc(t(a.top_fault || '-'))}</td><td>${fmtDate(a.last_reported)}</td></tr>`).join('')
          : `<tr><td colspan="7" class="empty">${esc(t('No complaints in this period'))}</td></tr>`;
      } catch (err) { toast(err.message, 'error'); }
    };
    document.getElementById('h-days').addEventListener('change', load);
    document.getElementById('h-type').addEventListener('change', load);
    load();
  },

  /* ----- Fault prediction ----- */
  async predictions() {
    if (!renderLayout('admin', 'Fault Prediction')) return;
    const el = document.getElementById('content');
    el.innerHTML = `<div class="empty">${esc(t('Loading...'))}</div>`;
    try {
      const d = await api('/admin/predictions');
      el.innerHTML = `
        <div class="page-title"><div><h1>${esc(t('Fault prediction'))}</h1>
          <div class="muted">${esc(t('Past complaints are analysed to find areas where faults are likely to happen again soon.'))}</div></div></div>
        <div class="alert alert-info">${esc(t('How it works'))}: ${esc(t('The forecast combines how recent the complaints are, how fast they are growing and how often faults repeat in each area. It is a statistical estimate to help plan inspections, not a certainty.'))}</div>
        ${d.areas.length ? `<div class="risk-grid mb">${d.areas.map((a) => `<div class="risk-wrap">${riskCard(a)}
          <details><summary>${esc(t('Details and advice'))}</summary>
            <ul class="plain">${a.reasons.map((r) => `<li>${esc(t(r))}</li>`).join('')}</ul>
            ${a.next_expected_in_days !== null && a.next_expected_in_days !== undefined ? `<div class="muted">${esc(t('Next fault expected in about {n} days', { n: Math.max(0, Math.round(a.next_expected_in_days)) }))}</div>` : ''}
            ${a.recommendation ? `<div class="sub-card"><b>${esc(t('Suggested action'))}:</b> ${esc(t(a.recommendation))}</div>` : ''}
            <div class="muted">${esc(t('Confidence'))}: ${esc(label(a.confidence))}</div></details></div>`).join('')}</div>`
          : `<div class="card empty">${esc(t('Not enough complaint history yet.'))}</div>`}
        <div class="muted">${esc(t('Generated'))}: ${fmtDate(d.generated_at)}</div>`;
    } catch (err) { showError(el, err); }
  },

  /* ----- Outage alerts and maintenance notices ----- */
  async alerts() {
    if (!renderLayout('admin', 'Outage Alerts')) return;
    const el = document.getElementById('content');
    const now = new Date();
    const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    el.innerHTML = `
      <div class="card mb">
        <div class="card-header"><h2>${esc(t('Send a power outage alert'))}</h2></div>
        <p class="muted mb">${esc(t('Citizens in the affected area are notified straight away. Emergency faults create an alert automatically.'))}</p>
        <form id="alert-form" novalidate>
          <div class="form-row">
            <div class="form-group"><label for="a-type">${esc(t('Alert type'))}</label>
              <select id="a-type"><option value="fault">${esc(t('Major fault'))}</option><option value="maintenance">${esc(t('Scheduled maintenance'))}</option></select></div>
            <div class="form-group"><label for="a-area">${esc(t('Affected area'))}</label><input id="a-area" list="a-areas" maxlength="100" data-voice><datalist id="a-areas"></datalist>
              <div class="error-text" id="a-area-err"></div></div>
          </div>
          <div class="form-group"><label for="a-title">${esc(t('Title'))}</label><input id="a-title" maxlength="150" data-voice><div class="error-text" id="a-title-err"></div></div>
          <div class="form-group"><label for="a-msg">${esc(t('Message for citizens'))}</label><textarea id="a-msg" maxlength="500" data-voice></textarea><div class="error-text" id="a-msg-err"></div></div>
          <div class="form-row">
            <div class="form-group"><label for="a-start">${esc(t('Starts'))}</label><input type="datetime-local" id="a-start" value="${local(now)}"></div>
            <div class="form-group"><label for="a-end">${esc(t('Ends (optional)'))}</label><input type="datetime-local" id="a-end"></div>
          </div>
          <div class="form-group"><label for="a-radius">${esc(t('Also alert citizens within (km) of their saved location'))}</label><input id="a-radius" type="number" min="0" max="50" step="0.5" value="3"></div>
          <button class="btn" type="submit">${esc(t('Send alert'))}</button>
        </form>
      </div>
      <div class="card"><div class="card-header"><h2>${esc(t('Recent alerts'))}</h2></div>
        <div class="table-wrap"><table>
          <thead><tr><th>${esc(t('Alert'))}</th><th>${esc(t('Area'))}</th><th>${esc(t('When'))}</th><th>${esc(t('Status'))}</th><th></th></tr></thead>
          <tbody id="a-rows"></tbody></table></div></div>`;
    enableVoice(el);
    api('/complaints/areas').then((list) => {
      document.getElementById('a-areas').innerHTML = list.map((a) => `<option value="${esc(a)}">`).join('');
    }).catch(() => {});

    const load = async () => {
      try {
        const list = await api('/admin/alerts');
        document.getElementById('a-rows').innerHTML = list.length ? list.map((a) => {
          const st = !Number(a.is_active) ? ['Cancelled', 'st-rejected'] : Number(a.is_running) ? ['Running', 'st-escalated'] : Number(a.is_upcoming) ? ['Upcoming', 'st-verified'] : ['Ended', 'st-closed'];
          return `<tr><td><b>${esc(t(a.title))}</b> ${Number(a.is_auto) ? `<span class="badge st-assigned">${esc(t('automatic'))}</span>` : ''}
            <div class="muted">${esc(a.alert_type === 'maintenance' ? t('Scheduled maintenance') : t('Major fault'))}</div></td>
            <td>${esc(t(a.area || '-'))}</td><td>${fmtDate(a.starts_at)}${a.ends_at ? '<br>&rarr; ' + fmtDate(a.ends_at) : ''}</td>
            <td><span class="badge ${st[1]}">${esc(t(st[0]))}</span></td>
            <td>${Number(a.is_active) ? `<button class="btn btn-sm btn-red" data-cancel="${a.alert_id}">${esc(t('Cancel'))}</button>` : ''}</td></tr>`;
        }).join('') : `<tr><td colspan="5" class="empty">${esc(t('No alerts yet'))}</td></tr>`;
      } catch (err) { toast(err.message, 'error'); }
    };
    document.getElementById('a-rows').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-cancel]');
      if (!b) return;
      try { await api(`/admin/alerts/${b.dataset.cancel}/cancel`, { method: 'PUT' }); toast(t('Alert cancelled'), 'success'); load(); }
      catch (err) { toast(err.message, 'error'); }
    });
    document.getElementById('alert-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const ok = validateForm({
        'a-area': [[Validate.required, t('Enter the affected area')]],
        'a-title': [[Validate.required, t('Enter a title')]],
        'a-msg': [[Validate.required, t('Write a message for citizens')]]
      });
      if (!ok) return;
      try {
        const r = await api('/admin/alerts', {
          method: 'POST',
          body: {
            alert_type: document.getElementById('a-type').value,
            area: document.getElementById('a-area').value,
            title: document.getElementById('a-title').value,
            message: document.getElementById('a-msg').value,
            starts_at: document.getElementById('a-start').value || null,
            ends_at: document.getElementById('a-end').value || null,
            radius_km: document.getElementById('a-radius').value || null
          }
        });
        toast(t(r.message), 'success');
        e.target.reset();
        document.getElementById('a-start').value = local(new Date());
        load();
      } catch (err) { toast(err.message, 'error'); }
    });
    load();
  }
};
