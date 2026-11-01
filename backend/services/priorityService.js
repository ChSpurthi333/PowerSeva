/*
 * Emergency priority system.
 *
 * Every new complaint is read automatically. A complaint is an EMERGENCY when
 *   - its fault type is dangerous to life (fallen pole, broken wire), or
 *   - the citizen's words describe danger: sparks, fire, explosion, smoke, electric shock,
 *     hanging or exposed wires, a damaged pole, water near live equipment ...
 * (English and Telugu words are both understood).
 * Emergencies become CRITICAL priority and get a 2 hour deadline at most.
 * Words about people at risk (children, school, hospital, animals) raise a normal complaint to HIGH.
 */
const RANK = { low: 1, medium: 2, high: 3, critical: 4 };
const EMERGENCY_HOURS = 2;

// [pattern, short label shown to the department]
const DANGER_RULES = [
  [/spark|నిప్పురవ్వ|స్పార్క్/i, 'sparks'],
  [/\b(fire|flames?|burning|burnt|burned|on fire)\b|నిప్పు|మంటలు|మంట|అగ్ని/i, 'fire'],
  [/explo|blast|burst|boom|పేలు|పేలిన|పేలుడు/i, 'explosion'],
  [/smok|పొగ/i, 'smoke'],
  [/shock|electrocut|current (is )?passing|షాక్/i, 'electric shock'],
  [
    /(exposed|bare|naked|open|live|hanging|dangling|snapped|broken|fallen|loose|cut)\s+(electric\s+|power\s+|current\s+)?(wire|cable|line|conductor)s?|(wire|cable|line|conductor)s?\s+(is|are|has|have|got)?\s*(hanging|dangling|snapped|broken|fallen|down|touching|exposed|cut)|(తెగిన|వేలాడే|వేలాడుతున్న|పడిన|తెగి)\s*(కరెంటు\s*)?(తీగ|తీగలు|వైరు|వైర్)|(తీగ|తీగలు|వైరు|వైర్)[^.\n]{0,20}(తెగ|వేలాడ|పడ)/i,
    'exposed or hanging wire'
  ],
  [
    /pole[^.\n]{0,25}(fell|fallen|down|broken|collapsed|leaning|tilted|bent|damaged)|(fallen|broken|collapsed|leaning|tilted|bent|damaged)\s+(electric\s+|electricity\s+|current\s+)?pole|(విరిగిన|కూలిన|పడిన|వంగిన)\s*(కరెంటు\s*)?(స్తంభం|పోల్)|(స్తంభం|పోల్)[^.\n]{0,20}(విరి|కూల|పడ|వంగ)/i,
    'damaged pole'
  ],
  [/water[^.\n]{0,20}(wire|cable|pole|transformer|meter)|(wire|cable|pole|transformer)[^.\n]{0,20}water|flood|waterlogged/i, 'water near live equipment']
];

const RISK_RULES = [
  [/child|children|kids?|school|college|hospital|clinic|injur|died|death|dead|cattle|cow|buffalo|animal|పిల్లలు|పాఠశాల|స్కూల్|ఆసుపత్రి|హాస్పిటల్|పశువులు|ఆవు|గేదె/i, 'people or animals at risk']
];

/**
 * faultType: { name, default_priority, expected_resolution_hrs, is_hazardous }
 * text: the citizen's title + description
 */
function assess(faultType, text) {
  const body = String(text || '');
  const danger = [];
  const risk = [];
  DANGER_RULES.forEach(([re, name]) => { if (re.test(body) && !danger.includes(name)) danger.push(name); });
  RISK_RULES.forEach(([re, name]) => { if (re.test(body) && !risk.includes(name)) risk.push(name); });

  const hazardous = !!Number(faultType.is_hazardous);
  const emergency = hazardous || danger.length > 0;
  let priority = faultType.default_priority || 'medium';
  const why = [];

  if (emergency) {
    priority = 'critical';
    if (hazardous) why.push(String(faultType.name).toLowerCase() + ' is a danger to life');
    if (danger.length) why.push('danger words: ' + danger.join(', '));
    if (risk.length) why.push('risk: ' + risk.join(', '));
  } else if (risk.length && RANK[priority] < RANK.high) {
    priority = 'high';
    why.push('risk: ' + risk.join(', '));
  }

  const baseHours = Number(faultType.expected_resolution_hrs) || 24;
  const dueHours = emergency ? Math.min(baseHours, EMERGENCY_HOURS) : baseHours;

  return {
    priority,
    is_emergency: emergency,
    reason: why.length ? (emergency ? 'Emergency: ' : '') + why.join('; ') : null,
    due_hours: dueHours,
    danger,
    risk
  };
}

module.exports = { assess, RANK, EMERGENCY_HOURS };
