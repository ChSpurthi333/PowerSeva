/*
 * Downloadable complaint receipt (PDF).
 * Shows the complaint ID, location, reported date, fault description and resolution details.
 * The PDF is written in English: the standard PDF fonts cannot draw Telugu script.
 */
const PDFDocument = require('pdfkit');

const INK = '#12263f';
const BLUE = '#1f6fb5';
const MUTED = '#5d6b7a';
const LINE = '#d9e2ec';
const WASH = '#eef5fb';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '2026-11-01 07:54:00' -> '01 Nov 2026, 07:54'
function fmt(d) {
  if (!d) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(d));
  if (!m) return String(d);
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}, ${m[4]}:${m[5]}`;
}

const cap = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function buildReceipt(res, d) {
  const c = d.complaint;
  const doc = new PDFDocument({ size: 'A4', margin: 46, info: { Title: `PowerSeva receipt ${c.complaint_number}`, Author: 'PowerSeva' } });
  doc.pipe(res);

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  // ----- header band
  doc.rect(0, 0, doc.page.width, 92).fill(WASH);
  doc.rect(0, 92, doc.page.width, 3).fill(BLUE);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(24).text('PowerSeva', left, 30);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Electricity Fault Reporting & Tracking System', left, 60);
  doc.font('Helvetica-Bold').fontSize(15).fillColor(BLUE).text('COMPLAINT RECEIPT', left, 34, { width, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Generated ' + fmt(new Date().toISOString().replace('T', ' ')), left, 58, { width, align: 'right' });

  doc.y = 116;

  // ----- complaint id box
  doc.roundedRect(left, doc.y, width, 54, 6).lineWidth(1).strokeColor(LINE).stroke();
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('COMPLAINT ID', left + 16, doc.y + 10);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text(c.complaint_number, left + 16, doc.y + 4);
  const statusText = cap(c.current_status) + (Number(c.is_emergency) ? '  |  EMERGENCY' : '');
  doc.font('Helvetica-Bold').fontSize(11).fillColor(Number(c.is_emergency) ? '#b3261e' : BLUE)
    .text(statusText, left, doc.y - 26, { width: width - 16, align: 'right' });
  doc.y += 40;

  const section = (title) => {
    doc.moveDown(0.9);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BLUE).text(title.toUpperCase(), left, doc.y);
    doc.moveTo(left, doc.y + 2).lineTo(left + width, doc.y + 2).lineWidth(0.7).strokeColor(LINE).stroke();
    doc.moveDown(0.5);
  };
  const row = (k, v) => {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(k, left, y, { width: 130 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(String(v === null || v === undefined || v === '' ? '-' : v), left + 135, y, { width: width - 135 });
    doc.moveDown(0.35);
  };

  section('Complaint details');
  row('Fault type', c.fault_type);
  row('Priority', cap(c.priority) + (c.priority_reason ? '  (' + c.priority_reason + ')' : ''));
  row('Reported on', fmt(c.reported_at));
  row('Reported by', c.citizen_name + (c.citizen_phone ? ', ' + c.citizen_phone : ''));
  row('Location', c.location_address);
  row('Village / area', c.area);
  row('Landmark', c.landmark);
  if (c.latitude && c.longitude) row('GPS position', `${Number(c.latitude).toFixed(5)}, ${Number(c.longitude).toFixed(5)}`);
  row('Department', c.department_name);
  row('Expected fix by', fmt(c.due_by));

  section('Fault description');
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(c.title, left, doc.y, { width });
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(c.description, left, doc.y, { width });

  section('Resolution details');
  const done = ['repaired', 'closed'].includes(c.current_status);
  const tech = d.assignments.find((a) => a.assignment_status === 'completed') || d.assignments[0];
  if (done) {
    row('Status', cap(c.current_status));
    row('Resolved on', fmt(c.resolved_at));
    row('Technician', tech ? tech.technician_name : '-');
    if (d.evidence.length) {
      row('Work done', d.evidence[0].work_description);
      row('Materials used', d.evidence[0].materials_used);
      row('Repair completed', fmt(d.evidence[0].repair_completed_at));
    }
    if (d.confirmation) {
      row('Citizen confirmation', d.confirmation.is_resolved ? 'Confirmed fixed' : 'Reported not fixed');
      if (d.confirmation.rating) row('Service rating', d.confirmation.rating + ' / 5');
      if (d.confirmation.technician_rating) row('Technician rating', d.confirmation.technician_rating + ' / 5');
      if (d.confirmation.feedback) row('Feedback', d.confirmation.feedback);
    }
  } else {
    row('Status', cap(c.current_status) + ' (not resolved yet)');
    if (tech) row('Technician', tech.technician_name + (tech.technician_phone ? ', ' + tech.technician_phone : ''));
    row('Estimated restoration', c.estimated_restoration ? fmt(c.estimated_restoration) + (c.eta_source === 'technician' ? '  (updated by technician)' : '  (system estimate)') : '-');
    if (d.updates.length) row('Latest update', d.updates[d.updates.length - 1].message);
  }

  section('Status history');
  d.history.forEach((h) => {
    if (doc.y > doc.page.height - 90) doc.addPage();
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(fmt(h.changed_at), left, y, { width: 105 });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(cap(h.new_status), left + 110, y, { width: 90 });
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(h.remarks || '', left + 205, y, { width: width - 205 });
    doc.moveDown(0.3);
  });

  // ----- footer
  const footY = doc.page.height - 56;
  doc.moveTo(left, footY).lineTo(left + width, footY).lineWidth(0.7).strokeColor(LINE).stroke();
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(
    'This receipt was generated by PowerSeva. Quote the complaint ID when you contact the electricity department.',
    left, footY + 8, { width, align: 'center' });

  doc.end();
}

module.exports = { buildReceipt };
