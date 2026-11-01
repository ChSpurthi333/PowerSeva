/* ===== PowerSeva - shared complaint tracking view (used by citizen, admin and technician) ===== */
const STEPS = [
  ['submitted', 'Submitted'],
  ['assigned', 'Assigned'],
  ['in_progress', 'In progress'],
  ['repaired', 'Repaired'],
  ['closed', 'Closed']
];

const OPEN_STATES = ['submitted', 'verified', 'assigned', 'in_progress', 'escalated', 'reopened'];

function stepIndex(c, assignments) {
  const map = { submitted: 0, verified: 0, assigned: 1, in_progress: 2, repaired: 3, closed: 4, reopened: 2 };
  if (c.current_status === 'escalated') return assignments.length ? 1 : 0;
  return map[c.current_status] ?? 0;
}

function renderProgress(c, assignments) {
  if (c.current_status === 'rejected') {
    return `<div class="alert alert-warn">${esc(t('This complaint was rejected by the department.'))}</div>`;
  }
  const idx = stepIndex(c, assignments);
  return `<div class="progress">${STEPS.map(([, text], i) =>
    `<div class="step-dot ${i < idx ? 'done' : ''} ${i === idx ? 'done current' : ''}">${esc(t(text))}</div>`).join('')}</div>`;
}

function imgTag(url) {
  return `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${esc(t('Photo'))}" onerror="this.parentNode.style.display='none'"></a>`;
}

function stars(n) {
  n = Math.max(0, Math.min(5, Number(n) || 0));
  return `<span class="stars" aria-label="${n} / 5">${'&#9733;'.repeat(n)}${'&#9734;'.repeat(5 - n)}</span>`;
}

function emergencyBadge(c) {
  return Number(c.is_emergency) ? `<span class="badge emergency-badge">&#9888; ${esc(t('EMERGENCY'))}</span>` : '';
}

// "about 2 hours" style text for a restoration time
function etaText(when) {
  if (!when) return '';
  const target = new Date(String(when).replace(' ', 'T'));
  if (isNaN(target)) return '';
  const mins = Math.round((target - new Date()) / 60000);
  if (mins <= 0) return t('Any moment now');
  if (mins < 60) return t('in about {n} minutes', { n: Math.max(5, Math.round(mins / 5) * 5) });
  const h = Math.round((mins / 60) * 2) / 2;
  return h < 24 ? t('in about {n} hours', { n: h }) : t('in about {n} days', { n: Math.round(h / 24) });
}

// Restoration-time card shown to the citizen on an open complaint
function renderEta(c) {
  if (!OPEN_STATES.includes(c.current_status) || !c.estimated_restoration) return '';
  const src = c.eta_source === 'technician' ? t('Updated by the technician') : t('Estimated from fault severity and the repair queue');
  return `<div class="eta-box">
      <div class="eta-label">${esc(t('Estimated restoration time'))}</div>
      <div class="eta-time">${fmtDate(c.estimated_restoration)}</div>
      <div class="eta-rel">${esc(etaText(c.estimated_restoration))}</div>
      <div class="muted">${esc(src)}</div>
    </div>`;
}

// Downloads the PDF receipt (needs the login token, so it cannot be a plain link)
async function downloadReceipt(number, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(API + '/complaints/receipt/' + encodeURIComponent(number), {
      headers: { Authorization: 'Bearer ' + Auth.token }
    });
    if (!res.ok) {
      let msg = 'Request failed';
      try { msg = (await res.json()).message || msg; } catch (e) { /* ignore */ }
      throw new Error(t(msg));
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'PowerSeva-Receipt-' + number + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-receipt]');
  if (b) downloadReceipt(b.dataset.receipt, b);
});

function renderComplaintDetail(d) {
  const c = d.complaint;
  const overdue = c.due_by && !['closed', 'rejected', 'repaired'].includes(c.current_status) &&
    new Date(String(c.due_by).replace(' ', 'T')) < new Date();
  const person = (name, phone) => esc(name) + (phone ? ', ' + esc(phone) : '');
  const conf = d.confirmation;

  return `
    <div class="card-header">
      <div>
        <h2>${esc(c.complaint_number)}</h2>
        <div class="muted">${esc(c.title)}</div>
      </div>
      <div>${emergencyBadge(c)} ${statusBadge(c.current_status)} ${priorityBadge(c.priority)}</div>
    </div>

    ${Number(c.is_emergency) ? `<div class="alert alert-error"><b>${esc(t('Emergency complaint'))}</b> - ${esc(t('this was marked dangerous and is being handled first.'))}
      ${c.priority_reason ? `<div class="muted">${esc(t(c.priority_reason))}</div>` : ''}</div>` : ''}

    ${renderProgress(c, d.assignments)}
    ${renderEta(c)}

    <div class="detail-grid">
      <div class="item"><span>${esc(t('Fault type'))}</span><b>${esc(t(c.fault_type))}</b></div>
      <div class="item"><span>${esc(t('Reported on'))}</span><b>${fmtDate(c.reported_at)}</b></div>
      <div class="item"><span>${esc(t('Location'))}</span><b>${esc(c.location_address)}</b></div>
      <div class="item"><span>${esc(t('Area'))}</span><b>${esc(t(c.area || '-'))}</b></div>
      <div class="item"><span>${esc(t('Landmark'))}</span><b>${esc(c.landmark || '-')}</b></div>
      <div class="item"><span>${esc(t('Expected fix by'))}</span><b>${fmtDate(c.due_by)}${overdue ? `<span class="overdue-tag">${esc(t('OVERDUE'))}</span>` : ''}</b></div>
      <div class="item"><span>${esc(t('Resolved on'))}</span><b>${fmtDate(c.resolved_at)}</b></div>
      <div class="item"><span>${esc(t('Reported by'))}</span><b>${person(c.citizen_name, c.citizen_phone)}</b></div>
      <div class="item"><span>${esc(t('Department'))}</span><b>${esc(t(c.department_name || '-'))}</b></div>
    </div>

    <div class="section-label">${esc(t('Description'))}</div>
    <p>${esc(c.description)}</p>

    ${d.images.length ? `<div class="section-label">${esc(t('Photos from citizen'))}</div><div class="gallery">${d.images.map((i) => imgTag(i.image_url)).join('')}</div>` : ''}

    ${d.assignments.length ? `<div class="section-label">${esc(t('Technician'))}</div>${d.assignments.map((a) => `
      <div class="sub-card">
        <b>${person(a.technician_name, a.technician_phone)}</b><br>
        ${esc(label(a.assignment_status))}
        <div class="muted">${esc(t('Assigned on'))} ${fmtDate(a.assigned_at)}${a.scheduled_visit ? ', ' + esc(t('visit on')) + ' ' + fmtDate(a.scheduled_visit) : ''}</div>
        ${a.remarks ? `<div class="muted">${esc(t(a.remarks))}</div>` : ''}
      </div>`).join('')}` : ''}

    ${d.updates && d.updates.length ? `<div class="section-label">${esc(t('Work updates from the technician'))}</div>
      <ul class="timeline">${d.updates.map((u) => `
        <li><b>${esc(u.message)}</b>
          <div class="when">${fmtDate(u.created_at)}${u.eta_minutes ? ' - ' + esc(t('about {n} more minutes', { n: u.eta_minutes })) : ''}</div>
          <div class="by">${esc(t('by'))} ${esc(u.technician_name)}</div></li>`).join('')}</ul>` : ''}

    ${d.evidence.length ? `<div class="section-label">${esc(t('Repair evidence'))}</div>
      <div class="sub-card">
        <b>${esc(d.evidence[0].work_description || '')}</b>
        <div class="muted">${esc(t('Materials used'))}: ${esc(d.evidence[0].materials_used || '-')}<br>${esc(t('Completed on'))} ${fmtDate(d.evidence[0].repair_completed_at)}</div>
        <div class="gallery">${d.evidence.map((e) => imgTag(e.image_url)).join('')}</div>
      </div>` : ''}

    ${conf ? `<div class="section-label">${esc(t('Citizen feedback'))}</div>
      <div class="sub-card">${esc(conf.is_resolved ? t('Confirmed fixed') : t('Reported not fixed'))}
        ${conf.rating ? `<br>${esc(t('Service'))}: ${stars(conf.rating)}` : ''}
        ${conf.technician_rating ? `<br>${esc(t('Technician'))}: ${stars(conf.technician_rating)}` : ''}
        ${conf.feedback ? '<br>' + esc(conf.feedback) : ''}</div>` : ''}

    <div class="section-label">${esc(t('Status history'))}</div>
    <ul class="timeline">${d.history.map((h) => `
      <li>
        <b>${esc(label(h.new_status))}</b>
        <div class="when">${fmtDate(h.changed_at)}</div>
        ${h.remarks ? `<div>${esc(t(h.remarks))}</div>` : ''}
        <div class="by">${h.changed_by ? esc(t('by')) + ' ' + esc(h.changed_by) : esc(t('by system'))}</div>
      </li>`).join('')}
    </ul>

    <div class="mt no-print">
      <button class="btn btn-outline" data-receipt="${esc(c.complaint_number)}">&#128196; ${esc(t('Download receipt (PDF)'))}</button>
    </div>`;
}

// Fetches a complaint by number and draws it into `el`; returns the data
async function showTrack(number, el) {
  el.innerHTML = `<div class="empty">${esc(t('Loading...'))}</div>`;
  try {
    const data = await api('/complaints/track/' + encodeURIComponent(number.trim()));
    el.innerHTML = renderComplaintDetail(data);
    return data;
  } catch (err) {
    showError(el, err);
    return null;
  }
}

/* ----- Outage alert cards (citizen dashboard and alerts page) ----- */
function alertCard(a) {
  const maint = a.alert_type === 'maintenance';
  return `<div class="outage ${maint ? 'maint' : 'fault'}">
      <div class="outage-icon">${maint ? '&#128295;' : '&#9889;'}</div>
      <div>
        <b>${esc(t(a.title))}</b>
        <span class="badge ${maint ? 'st-verified' : 'st-escalated'}">${esc(maint ? t('Scheduled maintenance') : t('Major fault'))}</span>
        <div>${esc(t(a.message))}</div>
        <div class="muted">${esc(t(a.area || ''))}${a.radius_km ? ' - ' + esc(t('within {n} km', { n: Number(a.radius_km) })) : ''}
          - ${fmtDate(a.starts_at)}${a.ends_at ? ' &rarr; ' + fmtDate(a.ends_at) : ''}</div>
      </div>
    </div>`;
}
