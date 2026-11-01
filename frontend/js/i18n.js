/* ===== PowerSeva - language (English / Telugu) and voice typing =====
 *
 * Every visible text in the site is written in English and passed through t().
 * When the language is Telugu, t() looks the English text up in TE_DICT (lang-te.js).
 * A missing translation simply shows the English text, so nothing breaks.
 */
const LANG_KEY = 'powerseva_lang';

function getLang() {
  try { return localStorage.getItem(LANG_KEY) === 'te' ? 'te' : 'en'; } catch (e) { return 'en'; }
}

function setLang(lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* ignore */ }
  location.reload();
}

function cap(s) { return String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()); }

/* Texts that the server stores in the database (notifications, status history ...)
 * contain complaint numbers and names, so they are matched with patterns. */
const TE_PATTERNS = (function () {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const list = [];

  const endings = {
    'has been submitted': 'సమర్పించబడింది',
    'has been verified by the department': 'విభాగం ద్వారా ధృవీకరించబడింది',
    'has been assigned to a technician': 'టెక్నీషియన్‌కు కేటాయించబడింది',
    'is being worked on': 'పని జరుగుతోంది',
    'has been marked repaired - please confirm the repair': 'మరమ్మత్తు పూర్తయినట్లు నమోదు చేయబడింది, దయచేసి మరమ్మత్తును నిర్ధారించండి',
    'has been closed': 'మూసివేయబడింది',
    'was rejected': 'తిరస్కరించబడింది',
    'has been escalated to a senior officer': 'పై అధికారికి పంపబడింది',
    'has been reopened': 'మళ్లీ తెరవబడింది'
  };
  Object.keys(endings).forEach((en) => {
    list.push([new RegExp('^Your complaint (\\S+) ' + esc(en) + '\\.$'), (m) => 'మీ ఫిర్యాదు ' + m[1] + ' ' + endings[en] + '.']);
  });

  list.push([/^Complaint (\S+) update$/, (m) => 'ఫిర్యాదు ' + m[1] + ' నవీకరణ']);
  list.push([/^Complaint (\S+) received$/, (m) => 'ఫిర్యాదు ' + m[1] + ' అందింది']);
  list.push([/^We received your report "(.*)"\. Track it with number (\S+)\.$/,
    (m) => 'మీ నివేదిక "' + m[1] + '" అందింది. ' + m[2] + ' నంబర్‌తో దీనిని ట్రాక్ చేయండి.']);
  list.push([/^New (\w+) priority complaint (\S+): (.*)$/,
    (m) => 'కొత్త ' + t(cap(m[1])) + ' ప్రాధాన్యత ఫిర్యాదు ' + m[2] + ': ' + m[3]]);
  list.push([/^You have been assigned complaint (\S+)\.$/, (m) => 'మీకు ఫిర్యాదు ' + m[1] + ' కేటాయించబడింది.']);
  list.push([/^Complaint (\S+) was repaired\. Open it and confirm whether the fault is fixed\.$/,
    (m) => 'ఫిర్యాదు ' + m[1] + ' మరమ్మత్తు చేయబడింది. దయచేసి తెరిచి సమస్య పరిష్కారమైందో లేదో నిర్ధారించండి.']);
  list.push([/^Citizen reported that complaint (\S+) is not fixed\.$/,
    (m) => 'ఫిర్యాదు ' + m[1] + ' ఇంకా పరిష్కారం కాలేదని పౌరుడు తెలిపారు.']);
  list.push([/^Complaint (\S+) \((\w+) priority\) is overdue and has been escalated\.$/,
    (m) => 'ఫిర్యాదు ' + m[1] + ' (' + t(cap(m[2])) + ' ప్రాధాన్యత) గడువు దాటింది, పై అధికారికి పంపబడింది.']);
  list.push([/^Assigned to (.+)$/, (m) => m[1] + ' కు కేటాయించబడింది']);
  list.push([/^(\d+) overdue complaint\(s\) escalated$/, (m) => m[1] + ' గడువు దాటిన ఫిర్యాదులు పై అధికారికి పంపబడ్డాయి']);

  /* --- emergency priority, technician assignment, alerts, predictions --- */
  // translates one short phrase; also finds "fallen electric pole" for the entry "Fallen Electric Pole"
  const phrase = (s) => {
    const dict = window.TE_DICT || {};
    if (Object.prototype.hasOwnProperty.call(dict, s)) return dict[s];
    const low = s.toLowerCase();
    const hit = Object.keys(dict).find((k) => k.toLowerCase() === low);
    return hit ? dict[hit] : s;
  };
  const items = (s) => s.split(', ').map(phrase).join(', ');
  const reason = (s) => s.replace(/^Emergency: /, 'అత్యవసరం: ').split('; ').map((part) => {
    let m = /^(?:అత్యవసరం: )?(.+) is a danger to life$/.exec(part);
    if (m) return (part.indexOf('అత్యవసరం: ') === 0 ? 'అత్యవసరం: ' : '') + phrase(m[1]) + ' ప్రాణాలకు ప్రమాదకరం';
    m = /^(?:అత్యవసరం: )?danger words: (.*)$/.exec(part);
    if (m) return (part.indexOf('అత్యవసరం: ') === 0 ? 'అత్యవసరం: ' : '') + 'ప్రమాద సూచక పదాలు: ' + items(m[1]);
    m = /^risk: (.*)$/.exec(part);
    if (m) return 'ప్రమాద అవకాశం: ' + items(m[1]);
    return part;
  }).join('; ');
  const reasonList = (s) => s.split(', ').map((x) => t(x)).join(', ');

  list.push([/^Emergency: .*$/, (m) => reason(m[0])]);
  list.push([/^(danger words|risk): .*$/, (m) => reason(m[0])]);
  list.push([/^Emergency complaint (\S+): (.*?)\. (Emergency: .*)$/, (m) => 'అత్యవసర ఫిర్యాదు ' + m[1] + ': ' + m[2] + '. ' + reason(m[3])]);
  list.push([/^Work update on (\S+)$/, (m) => 'ఫిర్యాదు ' + m[1] + ' పై పని నవీకరణ']);
  list.push([/^([\s\S]*) \(about (\d+) more minutes\)$/, (m) => m[1] + ' (ఇంకా సుమారు ' + m[2] + ' నిమిషాలు)']);
  list.push([/^A citizen rated your work on complaint (\S+): (\d) out of 5\.$/, (m) => 'ఫిర్యాదు ' + m[1] + ' పై మీ పనికి పౌరుడు 5కి ' + m[2] + ' రేటింగ్ ఇచ్చారు.']);
  list.push([/^Auto-assigned to (.+)$/, (m) => m[1] + ' కు స్వయంచాలకంగా కేటాయించబడింది']);
  list.push([/^Auto-assigned (\d+) of (\d+) complaint\(s\)$/, (m) => m[2] + ' ఫిర్యాదులలో ' + m[1] + ' స్వయంచాలకంగా కేటాయించబడ్డాయి']);
  list.push([/^Auto-assigned \(score (\d+)\): (.*)$/, (m) => 'స్వయంచాలకంగా కేటాయించబడింది (స్కోరు ' + m[1] + '): ' + reasonList(m[2])]);
  list.push([/^(technician|admin) account created$/, (m) => (m[1] === 'admin' ? 'అడ్మిన్' : 'టెక్నీషియన్') + ' ఖాతా సృష్టించబడింది']);
  list.push([/^Alert sent to (\d+) citizen\(s\)$/, (m) => m[1] + ' మంది పౌరులకు హెచ్చరిక పంపబడింది']);
  list.push([/^Emergency repair near (.+)$/, (m) => m[1] + ' దగ్గర అత్యవసర మరమ్మత్తు']);
  list.push([/^A dangerous electrical fault was reported near (.+)\. A crew has been alerted\. Stay away from fallen poles and hanging wires, and keep children indoors\.$/,
    (m) => m[1] + ' దగ్గర ప్రమాదకరమైన విద్యుత్ లోపం నివేదించబడింది. సిబ్బందికి సమాచారం ఇచ్చాం. పడిపోయిన స్తంభాలు, వేలాడే తీగలకు దూరంగా ఉండండి, పిల్లలను ఇంట్లోనే ఉంచండి.']);
  list.push([/^([\d.]+) km away$/, (m) => m[1] + ' కి.మీ. దూరంలో']);
  list.push([/^(\d+) active jobs?$/, (m) => m[1] + ' ప్రస్తుత పనులు']);
  list.push([/^(\d+) complaints? in the last 180 days$/, (m) => 'గత 180 రోజుల్లో ' + m[1] + ' ఫిర్యాదులు']);
  list.push([/^(\d+) in the last 30 days, (\d+) in the 30 days before$/, (m) => 'గత 30 రోజుల్లో ' + m[1] + ', అంతకు ముందు 30 రోజుల్లో ' + m[2]]);
  list.push([/^most likely fault: (.+) \((\d+) complaints?\)$/, (m) => 'ఎక్కువ అవకాశం ఉన్న లోపం: ' + phrase(m[1]) + ' (' + m[2] + ' ఫిర్యాదులు)']);
  list.push([/^(\d+) emergency complaints?$/, (m) => m[1] + ' అత్యవసర ఫిర్యాదులు']);
  list.push([/^a fault about every (\d+) days?$/, (m) => 'సుమారు ప్రతి ' + m[1] + ' రోజులకు ఒక లోపం']);
  return list;
})();

/* t('English text', { name: value })  ->  text in the chosen language ({name} is replaced) */
function t(key, vars) {
  let s = key;
  if (getLang() === 'te' && typeof key === 'string') {
    const dict = window.TE_DICT || {};
    if (Object.prototype.hasOwnProperty.call(dict, key)) {
      s = dict[key];
    } else {
      let hit = false;
      for (const [re, fn] of TE_PATTERNS) {
        const m = re.exec(key);
        if (m) { s = fn(m); hit = true; break; }
      }
      // developer check: set window.__tMiss = [] to collect English texts that have no Telugu yet
      if (!hit && window.__tMiss && /[A-Za-z]{3}/.test(key)) window.__tMiss.push(key);
    }
  }
  if (vars) s = String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : '{' + k + '}'));
  return s;
}

/* ----- Static pages: data-i18n="English text" ----- */
function applyStaticI18n(root) {
  (root || document).querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
  (root || document).querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
  (root || document).querySelectorAll('[data-i18n-label]').forEach((el) => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-label'))); });
}

function setPageTitle(english) {
  document.title = t(english) + ' - PowerSeva';
}

/* ----- English | తెలుగు switch ----- */
function mountLangSwitch(el) {
  if (!el) return;
  const l = getLang();
  el.innerHTML =
    '<div class="lang-switch" role="group" aria-label="Language">' +
    '<button type="button" data-lang="en" class="' + (l === 'en' ? 'on' : '') + '">English</button>' +
    '<button type="button" data-lang="te" class="' + (l === 'te' ? 'on' : '') + '">తెలుగు</button></div>';
  el.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => { if (b.dataset.lang !== getLang()) setLang(b.dataset.lang); }));
}

/* ----- Voice typing: a microphone button inside fields marked data-voice ----- */
const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>' +
  '<path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let activeRec = null;
let activeBtn = null;

function stopVoice() {
  if (activeRec) { try { activeRec.stop(); } catch (e) { /* ignore */ } }
}

function startVoice(field, btn) {
  if (!SpeechRec) {
    toast(t('Voice typing is not supported in this browser. Please use Google Chrome or Microsoft Edge.'), 'error');
    return;
  }
  const sameButton = activeBtn === btn;
  if (activeRec) { stopVoice(); if (sameButton) return; }

  const rec = new SpeechRec();
  rec.lang = getLang() === 'te' ? 'te-IN' : 'en-IN';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  const base = field.value ? field.value.replace(/\s+$/, '') + ' ' : '';
  const put = (text) => {
    let v = (base + text).replace(/\s+/g, ' ').replace(/^\s+/, '');
    if (field.maxLength > 0) v = v.slice(0, field.maxLength);
    field.value = v;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };

  rec.onresult = (e) => {
    let finalText = '';
    let interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + ' '; else interim += r[0].transcript;
    }
    put(finalText + interim);
  };
  rec.onerror = (e) => {
    const msg = {
      'not-allowed': 'Microphone is blocked. Allow microphone access in your browser and try again.',
      'service-not-allowed': 'Microphone is blocked. Allow microphone access in your browser and try again.',
      'audio-capture': 'No microphone was found on this device.',
      'network': 'Voice typing needs an internet connection.',
      'language-not-supported': 'This browser cannot type in the selected language by voice.'
    }[e.error];
    if (msg) toast(t(msg), 'error');
  };
  rec.onend = () => {
    btn.classList.remove('listening');
    btn.setAttribute('aria-pressed', 'false');
    if (activeRec === rec) { activeRec = null; activeBtn = null; }
  };

  try {
    rec.start();
    activeRec = rec;
    activeBtn = btn;
    btn.classList.add('listening');
    btn.setAttribute('aria-pressed', 'true');
    toast(t('Listening... speak now'), 'info');
  } catch (err) {
    toast(t('Could not start the microphone. Try again.'), 'error');
  }
}

function enableVoice(root) {
  (root || document).querySelectorAll('input[data-voice], textarea[data-voice]').forEach((field) => {
    if (field.dataset.voiceReady) return;
    field.dataset.voiceReady = '1';
    const wrap = document.createElement('div');
    wrap.className = 'voice-wrap' + (field.tagName === 'TEXTAREA' ? ' is-textarea' : '');
    field.parentNode.insertBefore(wrap, field);
    wrap.appendChild(field);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mic';
    btn.innerHTML = MIC_SVG;
    btn.title = t('Speak to type');
    btn.setAttribute('aria-label', t('Speak to type'));
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => startVoice(field, btn));
    wrap.appendChild(btn);
  });
}

/* ----- Runs on every page ----- */
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.lang = getLang() === 'te' ? 'te' : 'en';
  applyStaticI18n();
  document.querySelectorAll('.lang-slot').forEach(mountLangSwitch);
  const title = document.documentElement.getAttribute('data-title');
  if (title) setPageTitle(title);
  enableVoice();
});
