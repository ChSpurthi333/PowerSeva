/*
 * Fault hotspots (heatmap data) and AI-based fault prediction.
 *
 * Prediction is a transparent statistical forecasting model, not a black box. For every area it
 * learns from the last 180 days of complaints:
 *   - recency-weighted risk: recent and severe faults count more (half-life 21 days)
 *   - weekly trend: exponentially smoothed weekly counts + a straight-line slope
 *   - 30-day forecast: the smoothed level extended along the trend for the next 4 weeks
 *   - repeat pattern: average gap between faults, and when the next one is due
 * Areas are ranked 0-100 (55% recency-weighted risk, 45% forecast), compared with each other.
 */
const PRIORITY_WEIGHT = { critical: 2, high: 1.5, medium: 1, low: 0.6 };
const HEAT_WEIGHT = { critical: 1, high: 0.75, medium: 0.5, low: 0.3 };
const HALF_LIFE_DAYS = 21;
const WEEKS = 12;
const ALPHA = 0.4;

const ADVICE = {
  'Power Outage': 'Inspect feeders, insulators and fuses on the lines serving this area.',
  'Fallen Electric Pole': 'Survey pole condition and foundations; replace leaning or rusted poles before the next storm.',
  'Broken Wire': 'Replace old conductors, tighten spans and trim trees near the lines.',
  'Transformer Failure': 'Check transformer load, oil level and earthing; consider adding capacity or a spare unit nearby.',
  'Voltage Fluctuation': 'Balance the load between phases and inspect loose connections and long low-voltage lines.',
  'Street Light Fault': 'Service street light circuits and replace failing lamps and timers in one visit.',
  'Meter Problem': 'Run a meter inspection drive and replace damaged or ageing meters.'
};

function linearSlope(ys) {
  const n = ys.length;
  const xm = (n - 1) / 2;
  const ym = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => { num += (x - xm) * (y - ym); den += (x - xm) ** 2; });
  return den === 0 ? 0 : num / den;
}

function ewma(ys) {
  let level = ys.slice(0, 3).reduce((s, v) => s + v, 0) / Math.min(3, ys.length);
  ys.forEach((y) => { level = ALPHA * y + (1 - ALPHA) * level; });
  return level;
}

async function predictFaults(pool) {
  const [rows] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(c.area), ''), 'Unknown') AS area, ft.name AS fault_type, c.priority, c.is_emergency,
            c.latitude, c.longitude, DATEDIFF(NOW(), c.reported_at) AS days_ago
       FROM complaints c JOIN fault_types ft ON ft.fault_type_id = c.fault_type_id
      WHERE c.reported_at >= DATE_SUB(NOW(), INTERVAL 180 DAY)`
  );

  const byArea = new Map();
  rows.forEach((r) => {
    if (!byArea.has(r.area)) byArea.set(r.area, []);
    byArea.get(r.area).push({ ...r, days_ago: Number(r.days_ago) });
  });

  const areas = [];
  byArea.forEach((list, area) => {
    const weekly = new Array(WEEKS).fill(0);
    let raw = 0;
    let last30 = 0;
    let prev30 = 0;
    let emergencies = 0;
    const faultWeight = new Map();
    const faultCount = new Map();
    const lats = [];
    const lngs = [];

    list.forEach((r) => {
      const decay = Math.pow(0.5, r.days_ago / HALF_LIFE_DAYS);
      const w = (PRIORITY_WEIGHT[r.priority] || 1) * (Number(r.is_emergency) ? 1.25 : 1) * decay;
      raw += w;
      faultWeight.set(r.fault_type, (faultWeight.get(r.fault_type) || 0) + w);
      faultCount.set(r.fault_type, (faultCount.get(r.fault_type) || 0) + 1);
      const wk = Math.floor(r.days_ago / 7);
      if (wk < WEEKS) weekly[WEEKS - 1 - wk] += 1;
      if (r.days_ago < 30) last30 += 1; else if (r.days_ago < 60) prev30 += 1;
      if (Number(r.is_emergency)) emergencies += 1;
      if (r.latitude && r.longitude) { lats.push(Number(r.latitude)); lngs.push(Number(r.longitude)); }
    });

    const level = ewma(weekly);
    const slope = linearSlope(weekly);
    let forecast4 = 0;
    for (let k = 1; k <= 4; k++) forecast4 += Math.max(0, level + slope * k);
    const forecast30 = forecast4 * (30 / 28);

    const days = list.map((r) => r.days_ago).sort((a, b) => b - a);
    const avgGap = list.length >= 3 ? (days[0] - days[days.length - 1]) / (list.length - 1) : null;
    const sinceLast = days[days.length - 1];

    const top = Array.from(faultCount.entries())
      .map(([name, count]) => ({ name, count, weight: faultWeight.get(name), share: Math.round((count / list.length) * 100) }))
      .sort((a, b) => b.weight - a.weight);

    const trend = slope > 0.05 ? 'rising' : slope < -0.05 ? 'falling' : 'stable';
    const confidence = list.length >= 15 ? 'high' : list.length >= 6 ? 'medium' : 'low';

    const reasons = [];
    reasons.push(`${list.length} complaint${list.length > 1 ? 's' : ''} in the last 180 days`);
    reasons.push(`${last30} in the last 30 days, ${prev30} in the 30 days before`);
    if (top.length) reasons.push(`most likely fault: ${top[0].name} (${top[0].count} complaint${top[0].count > 1 ? 's' : ''})`);
    if (emergencies) reasons.push(`${emergencies} emergency complaint${emergencies > 1 ? 's' : ''}`);
    if (avgGap !== null) reasons.push(`a fault about every ${Math.max(1, Math.round(avgGap))} day${Math.round(avgGap) > 1 ? 's' : ''}`);

    areas.push({
      area,
      raw,
      forecast30,
      trend,
      confidence,
      total: list.length,
      last30,
      prev30,
      emergencies,
      likely_fault: top.length ? top[0].name : null,
      top_faults: top.slice(0, 3).map(({ name, count, share }) => ({ name, count, share })),
      avg_gap_days: avgGap === null ? null : Math.round(avgGap * 10) / 10,
      next_expected_in_days: avgGap === null ? null : Math.max(0, Math.round(avgGap - sinceLast)),
      weekly,
      reasons,
      recommendation: top.length ? ADVICE[top[0].name] || 'Inspect the lines and equipment in this area.' : null,
      lat: lats.length ? lats.reduce((s, v) => s + v, 0) / lats.length : null,
      lng: lngs.length ? lngs.reduce((s, v) => s + v, 0) / lngs.length : null
    });
  });

  const maxRaw = Math.max(0.0001, ...areas.map((a) => a.raw));
  const maxFc = Math.max(0.0001, ...areas.map((a) => a.forecast30));
  areas.forEach((a) => {
    a.risk_score = Math.round(100 * (0.55 * (a.raw / maxRaw) + 0.45 * (a.forecast30 / maxFc)));
    a.risk_level = a.risk_score >= 60 ? 'high' : a.risk_score >= 30 ? 'medium' : 'low';
    a.forecast_30d = Math.round(a.forecast30 * 10) / 10;
    delete a.raw;
    delete a.forecast30;
  });
  areas.sort((a, b) => b.risk_score - a.risk_score);

  return {
    generated_at: new Date().toISOString(),
    model: 'Recency-weighted frequency + exponential smoothing + linear trend (last 180 days)',
    areas
  };
}

// Points for the heatmap and a ranking of areas with the most faults
async function hotspots(pool, { days = 90, faultTypeId = null } = {}) {
  const params = [];
  let where = 'WHERE c.reported_at >= DATE_SUB(NOW(), INTERVAL ? DAY)';
  params.push(Number(days) > 0 ? Number(days) : 90);
  if (faultTypeId) { where += ' AND c.fault_type_id = ?'; params.push(faultTypeId); }

  const [rows] = await pool.query(
    `SELECT c.complaint_number, c.title, c.priority, c.is_emergency, c.latitude, c.longitude, c.reported_at,
            COALESCE(NULLIF(TRIM(c.area), ''), 'Unknown') AS area, ft.name AS fault_type
       FROM complaints c JOIN fault_types ft ON ft.fault_type_id = c.fault_type_id ${where}`,
    params
  );

  const points = rows
    .filter((r) => r.latitude && r.longitude)
    .map((r) => ({
      lat: Number(r.latitude),
      lng: Number(r.longitude),
      weight: (HEAT_WEIGHT[r.priority] || 0.5) + (Number(r.is_emergency) ? 0.25 : 0),
      number: r.complaint_number,
      title: r.title,
      priority: r.priority,
      fault_type: r.fault_type,
      area: r.area,
      reported_at: r.reported_at
    }));

  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.area)) map.set(r.area, { area: r.area, count: 0, critical: 0, emergencies: 0, lats: [], lngs: [], types: new Map(), last: r.reported_at });
    const a = map.get(r.area);
    a.count += 1;
    if (r.priority === 'critical') a.critical += 1;
    if (Number(r.is_emergency)) a.emergencies += 1;
    if (r.latitude && r.longitude) { a.lats.push(Number(r.latitude)); a.lngs.push(Number(r.longitude)); }
    a.types.set(r.fault_type, (a.types.get(r.fault_type) || 0) + 1);
    if (String(r.reported_at) > String(a.last)) a.last = r.reported_at;
  });

  const areas = Array.from(map.values()).map((a) => {
    const topType = Array.from(a.types.entries()).sort((x, y) => y[1] - x[1])[0];
    return {
      area: a.area,
      count: a.count,
      critical: a.critical,
      emergencies: a.emergencies,
      top_fault: topType ? topType[0] : null,
      last_reported: a.last,
      lat: a.lats.length ? a.lats.reduce((s, v) => s + v, 0) / a.lats.length : null,
      lng: a.lngs.length ? a.lngs.reduce((s, v) => s + v, 0) / a.lngs.length : null
    };
  }).sort((x, y) => y.count - x.count);

  return { days: Number(days) || 90, total: rows.length, mapped: points.length, points, areas };
}

module.exports = { predictFaults, hotspots };
