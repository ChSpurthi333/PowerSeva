/* ===== PowerSeva - technician pages ===== */
function jobCard(a) {
  const done = a.assignment_status === 'completed';
  return `
    <div class="card job p-${esc(a.priority)}">
      <div class="card-header" style="margin-bottom:6px">
        <h3>${esc(a.complaint_number)}</h3>
        <div>${emergencyBadge(a)} ${priorityBadge(a.priority)} ${statusBadge(a.current_status)}</div>
      </div>
      <b>${esc(a.title)}</b>
      <div class="meta">${esc(t(a.fault_type))}</div>
      ${Number(a.is_emergency) ? `<div class="alert alert-error" style="margin:8px 0">${esc(t('Emergency - go there first. Keep people away from the fault.'))}</div>` : ''}
      <p>${esc(a.description)}</p>
      <div class="detail-grid" style="margin:10px 0">
        <div class="item"><span>${esc(t('Location'))}</span><b>${esc(a.location_address)}</b></div>
        <div class="item"><span>${esc(t('Landmark'))}</span><b>${esc(a.landmark || '-')}</b></div>
        <div class="item"><span>${esc(t('Citizen'))}</span><b>${esc(a.citizen_name)}${a.citizen_phone ? ', ' + esc(a.citizen_phone) : ''}</b></div>
        <div class="item"><span>${esc(t('Area'))}</span><b>${esc(t(a.area || '-'))}</b></div>
        <div class="item"><span>${esc(t('Fix before'))}</span><b>${fmtDate(a.due_by)}</b></div>
        ${!done && a.estimated_restoration ? `<div class="item"><span>${esc(t('Estimated restoration time'))}</span><b>${fmtDate(a.estimated_restoration)}</b></div>` : ''}
        ${a.last_update ? `<div class="item"><span>${esc(t('Your last update'))}</span><b>${esc(a.last_update)}</b></div>` : ''}
        ${a.scheduled_visit ? `<div class="item"><span>${esc(t('Scheduled visit'))}</span><b>${fmtDate(a.scheduled_visit)}</b></div>` : ''}
        ${a.remarks ? `<div class="item"><span>${esc(t('Note from admin'))}</span><b>${esc(t(a.remarks))}</b></div>` : ''}
      </div>
      ${a.latitude && a.longitude ? `<a href="https://www.google.com/maps?q=${esc(a.latitude)},${esc(a.longitude)}" target="_blank" rel="noopener">${esc(t('Open in maps'))}</a>` : ''}
      <div class="actions">
        ${a.assignment_status === 'assigned' ? `<button class="btn btn-sm btn-dark" data-accept="${a.assignment_id}">${esc(t('Accept and start work'))}</button>` : ''}
        ${!done ? `<button class="btn btn-sm btn-outline" data-post="${a.assignment_id}" data-num="${esc(a.complaint_number)}">${esc(t('Post update'))}</button>` : ''}
        ${!done ? `<a class="btn btn-sm" href="/technician/update-repair.html?id=${a.assignment_id}">${esc(t('Update repair'))}</a>` : `<span class="badge st-closed">${esc(t('Repair submitted'))}</span>`}
      </div>
    </div>`;
}

const Technician = {
  async dashboard() {
    const user = renderLayout('technician', 'Dashboard');
    if (!user) return;
    const el = document.getElementById('content');
    el.innerHTML = `<div class="empty">${esc(t('Loading...'))}</div>`;
    try {
      const [s, list, fb] = await Promise.all([api('/technician/stats'), api('/technician/assignments'), api('/technician/feedback')]);
      const active = list.filter((a) => a.assignment_status !== 'completed').slice(0, 4);
      el.innerHTML = `
        <div class="page-title"><div><h1>${esc(t('Hello, {name}', { name: user.name.split(' ')[0] }))}</h1><div class="muted">${esc(t('Your repair jobs at a glance.'))}</div></div>
          <div class="avail-box">
            <label class="switch"><input type="checkbox" id="avail" ${s.is_available ? 'checked' : ''}><span>${esc(t('Available for new jobs'))}</span></label>
            <button class="btn btn-sm btn-outline" id="base-btn">${esc(t('My base location'))}</button>
          </div></div>
        <div class="stats">
          <div class="stat amber"><div class="num">${s.new_jobs || 0}</div><div class="lbl">${esc(t('New jobs'))}</div></div>
          <div class="stat purple"><div class="num">${s.in_progress || 0}</div><div class="lbl">${esc(t('In progress'))}</div></div>
          <div class="stat green"><div class="num">${s.completed || 0}</div><div class="lbl">${esc(t('Completed'))}</div></div>
          <div class="stat"><div class="num">${s.total || 0}</div><div class="lbl">${esc(t('Total assigned'))}</div></div>
          <div class="stat amber"><div class="num">${s.avg_rating ? Number(s.avg_rating).toFixed(1) : '-'}</div><div class="lbl">${esc(t('Average rating'))} (${s.rating_count || 0})</div></div>
        </div>
        <div class="card-header"><h2>${esc(t('Jobs to do'))}</h2><a href="/technician/assigned-complaints.html">${esc(t('View all'))}</a></div>
        ${active.length ? `<div class="job-grid" id="jobs">${active.map(jobCard).join('')}</div>` : `<div class="card empty">${esc(t('No pending jobs. Great work!'))}</div>`}
        <div class="card mt"><div class="card-header"><h2>${esc(t('Citizen ratings and feedback'))}</h2></div>
          ${fb.items.length ? fb.items.slice(0, 6).map((f) => `<div class="sub-card">${f.technician_rating ? stars(f.technician_rating) : ''} <b>${esc(f.complaint_number)}</b>
            <div>${f.feedback ? esc(f.feedback) : `<span class="muted">${esc(t('No written feedback'))}</span>`}</div><div class="muted">${fmtDate(f.confirmed_at)}</div></div>`).join('')
            : `<div class="empty">${esc(t('No ratings yet.'))}</div>`}</div>`;
      Technician.wireAccept(el);
      document.getElementById('avail').addEventListener('change', async (e) => {
        try {
          const r = await api('/auth/profile', { method: 'PUT', body: { area: user.area, latitude: user.latitude, longitude: user.longitude, is_available: e.target.checked } });
          Auth.save(Auth.token, { ...user, ...r.user });
          toast(e.target.checked ? t('You are available for new jobs') : t('You will not get new jobs automatically'), 'success');
        } catch (err) { toast(err.message, 'error'); e.target.checked = !e.target.checked; }
      });
      document.getElementById('base-btn').addEventListener('click', () => openProfile(() => Technician.dashboard()));
    } catch (err) { showError(el, err); }
  },

  async assigned() {
    if (!renderLayout('technician', 'Assigned Complaints')) return;
    const el = document.getElementById('content');
    const load = async () => {
      try {
        const list = await api('/technician/assignments');
        el.innerHTML = list.length ? `<div class="job-grid">${list.map(jobCard).join('')}</div>`
          : `<div class="card empty">${esc(t('No complaints have been assigned to you yet.'))}</div>`;
      } catch (err) { showError(el, err); }
    };
    Technician.wireAccept(el, load);
    load();
  },

  postUpdate(id, number, reload) {
    const body = openModal(`
      <h2>${esc(t('Update for the citizen'))}: ${esc(number)}</h2>
      <p class="muted mb">${esc(t('The citizen gets this message and the restoration time is updated.'))}</p>
      <div class="form-group"><label for="u-msg">${esc(t('What is happening?'))}</label>
        <textarea id="u-msg" maxlength="500" data-voice placeholder="${esc(t('For example: Reached the site, replacing the fuse'))}"></textarea>
        <div class="error-text" id="u-msg-err"></div></div>
      <div class="form-group"><label for="u-eta">${esc(t('How many more minutes until power is back? (optional)'))}</label>
        <input id="u-eta" type="number" min="5" max="2880" step="5" inputmode="numeric"></div>
      <button class="btn" id="u-send">${esc(t('Send update'))}</button>`);
    body.querySelector('#u-send').addEventListener('click', async (e) => {
      const msg = body.querySelector('#u-msg').value.trim();
      if (msg.length < 3) { body.querySelector('#u-msg-err').textContent = t('Write a short update for the citizen'); return; }
      e.target.disabled = true;
      try {
        const r = await api(`/technician/assignments/${id}/update`, {
          method: 'POST', body: { message: msg, eta_minutes: body.querySelector('#u-eta').value || null }
        });
        closeModal();
        toast(t(r.message), 'success');
        if (reload) reload(); else setTimeout(() => location.reload(), 600);
      } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
    });
  },

  wireAccept(el, reload) {
    el.addEventListener('click', async (e) => {
      const p = e.target.closest('[data-post]');
      if (p) { Technician.postUpdate(p.dataset.post, p.dataset.num, reload); return; }
      const b = e.target.closest('[data-accept]');
      if (!b) return;
      b.disabled = true;
      try {
        const r = await api(`/technician/assignments/${b.dataset.accept}/accept`, { method: 'PUT' });
        toast(t(r.message), 'success');
        if (reload) reload(); else location.reload();
      } catch (err) {
        toast(err.message, 'error');
        b.disabled = false;
      }
    });
  },

  async updateRepair() {
    if (!renderLayout('technician', 'Update Repair')) return;
    const el = document.getElementById('content');
    el.innerHTML = `<div class="empty">${esc(t('Loading...'))}</div>`;
    try {
      const list = (await api('/technician/assignments')).filter((a) => a.assignment_status !== 'completed');
      if (!list.length) {
        el.innerHTML = `<div class="card empty">${esc(t('You have no open jobs to update.'))}</div>`;
        return;
      }
      const preset = qs('id');
      el.innerHTML = `
        <div class="card" style="max-width:760px">
          <h2 class="mb">${esc(t('Submit repair details'))}</h2>
          <form id="repair-form" novalidate>
            <div class="form-group"><label for="assignment">${esc(t('Job'))}</label>
              <select id="assignment" name="assignment">
                ${list.map((a) => `<option value="${a.assignment_id}" ${String(a.assignment_id) === preset ? 'selected' : ''}>${esc(a.complaint_number)} - ${esc(a.title)}</option>`).join('')}
              </select></div>
            <div id="job-summary" class="sub-card"></div>
            <div class="form-group"><label for="work_description">${esc(t('Work done'))}</label>
              <textarea id="work_description" name="work_description" data-voice placeholder="${esc(t('Describe what you repaired or replaced'))}"></textarea>
              <div class="error-text" id="work_description-err"></div></div>
            <div class="form-group"><label for="materials_used">${esc(t('Materials used (optional)'))}</label>
              <input id="materials_used" name="materials_used" data-voice placeholder="${esc(t('For example: 1 fuse, 10 m cable'))}"></div>
            <div class="form-group"><label for="images">${esc(t('Repair photos (required, up to 5)'))}</label>
              <input type="file" id="images" name="images" accept="image/*" multiple>
              <div class="error-text" id="images-err"></div>
              <div class="preview-row" id="preview"></div></div>
            <button class="btn btn-green" id="submit-btn" type="submit">${esc(t('Mark as repaired'))}</button>
          </form>
        </div>`;
      enableVoice(el);

      const summary = () => {
        const a = list.find((x) => String(x.assignment_id) === document.getElementById('assignment').value);
        document.getElementById('job-summary').innerHTML = a
          ? `<b>${esc(a.title)}</b> ${priorityBadge(a.priority)}<br><span class="muted">${esc(a.location_address)}<br>${esc(a.citizen_name)}${a.citizen_phone ? ', ' + esc(a.citizen_phone) : ''}</span>` : '';
      };
      document.getElementById('assignment').addEventListener('change', summary);
      summary();

      const files = document.getElementById('images');
      files.addEventListener('change', () => {
        const box = document.getElementById('preview');
        box.innerHTML = '';
        if (files.files.length > 5) { toast(t('You can upload at most 5 photos'), 'error'); files.value = ''; return; }
        Array.from(files.files).forEach((f) => {
          const img = document.createElement('img');
          img.src = URL.createObjectURL(f);
          img.alt = t('Photo');
          box.appendChild(img);
        });
      });

      document.getElementById('repair-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const okText = validateForm({ work_description: [[(v) => Validate.minLen(v.trim(), 10), t('Describe the work (at least 10 characters)')]] });
        const okImg = files.files.length > 0;
        document.getElementById('images-err').textContent = okImg ? '' : t('Upload at least one repair photo');
        if (!okText || !okImg) return;

        const fd = new FormData();
        fd.append('work_description', document.getElementById('work_description').value);
        fd.append('materials_used', document.getElementById('materials_used').value);
        Array.from(files.files).forEach((f) => fd.append('images', f));

        const btn = document.getElementById('submit-btn');
        btn.disabled = true;
        try {
          const r = await api(`/technician/assignments/${document.getElementById('assignment').value}/repair`, { method: 'POST', body: fd });
          toast(t(r.message), 'success');
          setTimeout(() => (location.href = '/technician/assigned-complaints.html'), 1000);
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
        }
      });
    } catch (err) { showError(el, err); }
  }
};
