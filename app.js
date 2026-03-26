// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const OPERATOR_PASSWORD = 'VANTAGE_OPS_2026'; // Change this
const STRIPE_URL = 'https://buy.stripe.com/YOUR_STRIPE_LINK_HERE'; // Replace with your Stripe link

const HABIT_WEIGHTS = { critical: 3.0, high: 3.0, medium: 1.0, low: 0.5 };
const STAKES = {
  low:      { label: 'LOW',  cls: 'stake-low'  },
  medium:   { label: 'MED',  cls: 'stake-med'  },
  high:     { label: 'HIGH', cls: 'stake-high' },
  critical: { label: 'CRIT', cls: 'stake-crit' }
};
const MONTHS = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
const DEFAULT_HABITS = ['Set daily goals','Caffeine cut-off','Nutrient dense meals','Train / Recover','1 gallon of water'];
const DEFAULT_HABIT_STAKES = { 'Set daily goals':'high','Caffeine cut-off':'medium','Nutrient dense meals':'medium','Train / Recover':'critical','1 gallon of water':'low' };

// ─── STATE ────────────────────────────────────────────────────────────────────
let S = {
  month: new Date().getMonth()+1, year: new Date().getFullYear(),
  habits: [...DEFAULT_HABITS], habitStakes: {...DEFAULT_HABIT_STAKES},
  goals: [], groqKey: '', days: {},
  lastWeeklyReview: null, lastMonthlyRecap: null,
  lastWeekDelta: '', weeklyRecaps: {},
  monthlyAudits: {}, dailyFrictionQuestion: '', monthDelta: '',
  weeklyNonNeg: [], weeklyNonNegStatus: {}, weeklyNonNegBonusGiven: {},
};
let currentUser = null;
let authMode = 'login';
let calViewMonth = new Date().getMonth()+1;
let calViewYear  = new Date().getFullYear();
let calSelectedDate = null;

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().split('T')[0]; }
function dateKey(d,m,y) { return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function daysInMonth(m,y) { return new Date(y,m,0).getDate(); }
function getDay(dk) { return S.days[dk] || {habits:{},mood:7,weight:null,cals:null,protein:null,sleep:null,win:'',log:''}; }

let toastTimer;
function showToast(msg, dur=2200, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' '+type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), dur);
}

// ─── EXECUTION SCORE ──────────────────────────────────────────────────────────
function calcDailyScore(dk) {
  const day = S.days[dk] || { habits: {} };
  let totalW = 0, doneW = 0;
  S.habits.forEach(h => {
    const w = HABIT_WEIGHTS[S.habitStakes[h] || 'medium'];
    totalW += w;
    if (day.habits[h]) doneW += w;
  });
  return totalW > 0 ? Math.round((doneW / totalW) * 100) : 0;
}

function getScoreColor(pct) {
  if (pct >= 80) return 'var(--green)';
  if (pct >= 50) return 'var(--yellow)';
  return 'var(--accent)';
}

function getBreachedHabits(dk) {
  const day = S.days[dk] || { habits: {} };
  return S.habits.filter(h => {
    const s = S.habitStakes[h] || 'medium';
    return (s === 'critical' || s === 'high') && !day.habits[h];
  });
}

// ─── PAYWALL ──────────────────────────────────────────────────────────────────
function checkAccess() {
  const access = localStorage.getItem('vantage_access');
  const params = new URLSearchParams(window.location.search);
  if (params.get('success') === 'true') {
    localStorage.setItem('vantage_access', 'purchased');
    window.history.replaceState({}, '', window.location.pathname);
    return true;
  }
  return !!access;
}

function showPaywall() {
  document.getElementById('paywall-screen').style.display = 'flex';
  document.getElementById('auth-screen').style.display = 'none';
}

function operatorLogin() {
  const pw = prompt('Access code:');
  if (pw === null) return;
  if (pw === OPERATOR_PASSWORD) {
    localStorage.setItem('vantage_access', 'operator');
    document.getElementById('paywall-screen').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'flex';
  } else {
    setTimeout(() => alert('Invalid code.'), 100);
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function switchAuthTab(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((t,i) => t.classList.toggle('active', (i===0&&mode==='login')||(i===1&&mode==='signup')));
  document.getElementById('confirm-field').style.display = mode==='signup' ? 'block' : 'none';
  document.getElementById('auth-submit-btn').textContent = mode==='login' ? 'Sign In' : 'Create Account';
  document.getElementById('auth-err').textContent = '';
}

async function handleAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const pw    = document.getElementById('auth-password').value;
  const conf  = document.getElementById('auth-confirm').value;
  const btn   = document.getElementById('auth-submit-btn');
  const err   = document.getElementById('auth-err');
  err.textContent = '';
  if (!email || !pw) { err.textContent = 'Email and password required.'; return; }
  if (authMode==='signup' && pw !== conf) { err.textContent = 'Passwords do not match.'; return; }
  if (authMode==='signup' && pw.length < 6) { err.textContent = 'Minimum 6 characters.'; return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Working...';
  try {
    let res;
    if (authMode==='login') res = await sb.auth.signInWithPassword({ email, password: pw });
    else {
      res = await sb.auth.signUp({ email, password: pw });
      if (res.data?.user && !res.error) {
        err.style.color = 'var(--green)';
        err.textContent = 'Account created. Check your email to confirm.';
        switchAuthTab('login'); btn.disabled = false; btn.textContent = 'Sign In'; return;
      }
    }
    if (res.error) throw res.error;
    currentUser = res.data.user;
    await initApp();
  } catch(e) { err.style.color = 'var(--red)'; err.textContent = e.message || 'Something went wrong.'; }
  btn.disabled = false; btn.textContent = authMode==='login' ? 'Sign In' : 'Create Account';
}

async function handleLogout() {
  await sb.auth.signOut();
  currentUser = null; S.days = {};
  document.getElementById('app').classList.remove('visible');
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('auth-email').value = '';
  document.getElementById('auth-password').value = '';
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function initApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  document.getElementById('sidebar-email').textContent = currentUser.email;
  S.groqKey = localStorage.getItem('groq_key') || '';
  await loadUserSettings();
  await loadMonthLogs();
  updateSidebar();
  initToday(todayStr());
  calViewMonth = S.month; calViewYear = S.year;
  checkTemporalReviews();
  if (S.monthDelta) injectDeltaAnchor();
  setupEodTimer();

  // Operator controls
  if (localStorage.getItem('vantage_access') === 'operator') {
    document.getElementById('operator-panel').style.display = 'block';
  }
}

// ─── AUTO-SAVE ────────────────────────────────────────────────────────────────
let saveTimeout, saveCalTimeout;
function triggerAutoSaveDay() {
  const el = document.getElementById('auto-save-status');
  el.textContent = 'Saving...'; el.classList.remove('success'); el.classList.add('visible');
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    await saveDay();
    el.textContent = 'Saved'; el.classList.add('success');
    setTimeout(() => el.classList.remove('visible'), 1500);
  }, 1000);
}

function triggerAutoSaveCalDay() {
  const el = document.getElementById('cal-auto-save-status');
  el.textContent = 'Saving...'; el.classList.remove('success'); el.classList.add('visible');
  clearTimeout(saveCalTimeout);
  saveCalTimeout = setTimeout(async () => {
    await saveCalDay();
    el.textContent = 'Saved'; el.classList.add('success');
    setTimeout(() => el.classList.remove('visible'), 1500);
  }, 1000);
}

// ─── EOD TIMER ────────────────────────────────────────────────────────────────
function setupEodTimer() {
  const now = new Date(); const tenPM = new Date(); tenPM.setHours(22,0,0,0);
  const key = `eod_warned_${todayStr()}`;
  if (now >= tenPM && !localStorage.getItem(key)) {
    showToast('22:00 — Log your day and complete your habits.', 4000);
    localStorage.setItem(key, 'true');
  } else if (now < tenPM) {
    setTimeout(() => {
      if (!localStorage.getItem(key)) {
        showToast('22:00 — Log your day and complete your habits.', 4000);
        localStorage.setItem(key, 'true');
      }
    }, tenPM - now);
  }
}

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  document.getElementById('nav-'+name).classList.add('active');
  if (name==='today')    { renderHabitList(todayStr()); renderWeeklyGoals(); }
  if (name==='month')    { loadMonthLogs().then(renderMonthPage); }
  if (name==='calendar') { renderCalendar(); }
  if (name==='wins')     { loadMonthLogs().then(renderWinsPage); }
  if (name==='settings') { renderSettings(); }
}

// ─── TODAY PAGE ───────────────────────────────────────────────────────────────
function initToday(dk) {
  const d = getDay(dk);
  document.getElementById('inp-mood').value    = d.mood || 7;
  document.getElementById('mood-val').textContent = d.mood || 7;
  document.getElementById('inp-weight').value  = d.weight  || '';
  document.getElementById('inp-cals').value    = d.cals    || '';
  document.getElementById('inp-protein').value = d.protein || '';
  document.getElementById('inp-sleep').value   = d.sleep   || '';
  document.getElementById('inp-win').value     = d.win     || '';
  document.getElementById('text-log').value    = d.log     || '';
  document.getElementById('today-date-label').textContent =
    new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  renderHabitList(dk);
  renderWeeklyGoals();
  renderWeeklyNonNeg();
  injectDailyFrictionQuestion();
  generateBriefing();
}

function renderHabitList(dk) {
  const d    = getDay(dk);
  const list = document.getElementById('habit-list');
  list.innerHTML = '';
  let done = 0;

  const score    = calcDailyScore(dk);
  const breached = getBreachedHabits(dk);
  const scoreEl  = document.getElementById('today-score');
  const breachEl = document.getElementById('breach-banner');

  if (scoreEl) {
    scoreEl.textContent = score + '%';
    scoreEl.style.color = getScoreColor(score);
  }

  if (breachEl) {
    if (breached.length > 0) {
      breachEl.classList.add('visible');
      document.getElementById('breach-list').textContent = breached.join(' · ');
    } else {
      breachEl.classList.remove('visible');
    }
  }

  S.habits.forEach(h => {
    const checked = d.habits[h] || false;
    const stake   = S.habitStakes[h] || 'medium';
    const weight  = HABIT_WEIGHTS[stake];
    const isCrit  = stake === 'critical' || stake === 'high';
    if (checked) done++;
    const el = document.createElement('div');
    el.className = 'habit-item' + (checked ? ' done' : (isCrit && !checked ? ' breach' : ''));
    el.onclick = () => toggleHabit(dk, h, () => initToday(dk));
    el.innerHTML = `
      <div class="habit-left">
        <div class="habit-cb">${checked ? '✓' : ''}</div>
        <div class="habit-name">${h}</div>
      </div>
      <div class="habit-right">
        <span class="stake-tag ${STAKES[stake].cls}">${STAKES[stake].label}</span>
        <span style="font-size:0.58rem;font-family:'Space Mono',monospace;color:var(--muted);min-width:28px;text-align:right">${weight}×</span>
      </div>`;
    list.appendChild(el);
  });

  document.getElementById('habit-count-label').textContent = `${done}/${S.habits.length}`;
}

async function toggleHabit(dk, h, refresh) {
  if (!S.days[dk]) S.days[dk] = getDay(dk);
  S.days[dk].habits[h] = !S.days[dk].habits[h];
  await saveDayToDB(dk, S.days[dk]);
  if (refresh) refresh(); else renderHabitList(dk);
}

async function saveDay() {
  const dk = todayStr();
  if (!S.days[dk]) S.days[dk] = getDay(dk);
  const d = S.days[dk];
  d.mood    = parseInt(document.getElementById('inp-mood').value)    || 7;
  d.weight  = parseFloat(document.getElementById('inp-weight').value) || null;
  d.cals    = parseInt(document.getElementById('inp-cals').value)    || null;
  d.protein = parseInt(document.getElementById('inp-protein').value) || null;
  d.sleep   = parseFloat(document.getElementById('inp-sleep').value) || null;
  d.win     = document.getElementById('inp-win').value;
  d.log     = document.getElementById('text-log').value;
  await saveDayToDB(dk, d);
}

// ─── BRIEFING ─────────────────────────────────────────────────────────────────
async function generateBriefing() {
  const el = document.getElementById('briefing-text');
  if (!el) return;
  const key = `vantage_briefing_${todayStr()}`;
  const cached = localStorage.getItem(key);
  if (cached) { el.textContent = cached; return; }
  if (!S.groqKey) { el.innerHTML = '<em style="color:var(--muted)">Add a Groq API key in Settings to enable briefings.</em>'; return; }
  el.textContent = 'Compiling...';
  const dk    = todayStr();
  const yday  = new Date(); yday.setDate(yday.getDate()-1);
  const yk    = yday.toISOString().split('T')[0];
  const ydata = S.days[yk] || {};
  const score = calcDailyScore(yk);
  const missed = S.habits.filter(h => !ydata.habits?.[h] && (S.habitStakes[h]==='critical'||S.habitStakes[h]==='high'));
  try {
    const text = await callGroq([{ role:'user', content:`VANTAGE AI. Daily briefing. Be direct, 2-3 sentences max. Yesterday execution: ${score}%. Strategic failures: ${missed.join(', ')||'none'}. Weekly delta: "${S.lastWeekDelta||'not set'}". Monthly delta: "${S.monthDelta||'not set'}". What matters most today?` }], 120, 0.7);
    el.textContent = text;
    localStorage.setItem(key, text);
  } catch(e) { el.textContent = 'Briefing unavailable.'; }
}

// ─── WEEKLY GOALS ─────────────────────────────────────────────────────────────
function renderWeeklyGoals() {
  const now = new Date();
  const ws  = new Date(now); ws.setDate(now.getDate()-now.getDay());
  const we  = new Date(ws);  we.setDate(ws.getDate()+6);
  const fmt = d => d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  document.getElementById('weekly-goals-week').textContent = `${fmt(ws)} - ${fmt(we)}`;
  const weekly = S.goals.filter(g => g.type==='weekly');
  const list   = document.getElementById('weekly-goals-list');
  const empty  = document.getElementById('no-weekly-goals');
  list.innerHTML = '';
  if (!weekly.length) { empty.style.display='block'; return; }
  empty.style.display = 'none';
  weekly.forEach(g => list.appendChild(buildGoalItem(g, true)));
}

function renderMonthlyGoals() {
  const monthly = S.goals.filter(g => g.type==='monthly');
  const list    = document.getElementById('monthly-goals-list');
  const empty   = document.getElementById('no-monthly-goals');
  list.innerHTML = '';
  if (!monthly.length) { empty.style.display='block'; return; }
  empty.style.display = 'none';
  monthly.forEach(g => list.appendChild(buildGoalItem(g, true)));
}

function buildGoalItem(g, interactive) {
  const urg = getUrgency(g.deadline);
  const el  = document.createElement('div');
  el.className = 'goal-item' + (g._weeklyDelta||g._monthDelta ? ' delta' : '');
  el.dataset.goalId = g.id;
  let deadlineBadge = '';
  if (g.deadline) deadlineBadge = `<span class="goal-deadline ${deadlineBadgeClass(urg.cls)}">${urg.label}</span>`;
  let countdown = '';
  if (g.deadline && urg.days!==null && urg.days<=7)
    countdown = `<div class="goal-countdown ${countdownClass(urg.cls)}">${urg.level===4 ? 'Overdue by '+Math.abs(urg.days)+'d' : urg.label+' — '+new Date(g.deadline+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>`;
  const deltaTag = g._weeklyDelta
    ? `<span class="delta-badge">WEEKLY DELTA</span>`
    : g._monthDelta ? `<span class="delta-badge">MONTHLY DELTA</span>` : '';
  el.innerHTML = `
    <div class="goal-top">
      <div class="goal-name">${g.name}${deltaTag}</div>
      ${deadlineBadge}
    </div>
    <div class="goal-progress-row">
      <input type="range" min="0" max="10" value="${g.progress||0}" class="goal-slider" ${interactive?'':'disabled'}
        oninput="updateGoalProgress('${g.id}',this.value,this.closest('.goal-item').querySelector('.goal-score'))"
        onchange="persistGoalProgress('${g.id}',this.value)"/>
      <div class="goal-score">${g.progress||0}/10</div>
    </div>${countdown}`;
  return el;
}

function updateGoalProgress(id, val, scoreEl) {
  if (scoreEl) scoreEl.textContent = val+'/10';
  const g = S.goals.find(x => x.id===id); if (g) g.progress = parseInt(val);
}

async function persistGoalProgress(id, val) {
  const g = S.goals.find(x => x.id===id);
  if (g) {
    g.progress = parseInt(val);
    if (parseInt(val)===10) {
      showToast(`Goal complete: ${g.name}`, 3000, 'positive');
      fireConfetti();
    }
    await saveUserSettings();
  }
}

// ─── CONFETTI ─────────────────────────────────────────────────────────────────
function fireConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:99999;';
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const COLORS = ['#e11d48','#ff4d6d','#f59e0b','#22c55e','#38bdf8','#ffffff'];
  const pieces = Array.from({length:100}, () => ({
    x:Math.random()*canvas.width, y:-10-Math.random()*200,
    w:5+Math.random()*7, h:3+Math.random()*5,
    color:COLORS[Math.floor(Math.random()*COLORS.length)],
    rot:Math.random()*Math.PI*2, vx:(Math.random()-0.5)*4,
    vy:2+Math.random()*4, vr:(Math.random()-0.5)*0.2, opacity:1
  }));
  let frame = 0;
  function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    pieces.forEach(p => {
      p.x+=p.vx; p.y+=p.vy; p.rot+=p.vr; p.vy+=0.08;
      if (frame>80) p.opacity = Math.max(0, p.opacity-0.02);
      ctx.save(); ctx.globalAlpha=p.opacity; ctx.translate(p.x,p.y); ctx.rotate(p.rot);
      ctx.fillStyle=p.color; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); ctx.restore();
    });
    frame++;
    if (frame<130) requestAnimationFrame(draw); else canvas.remove();
  }
  draw();
}

// ─── GOAL URGENCY ─────────────────────────────────────────────────────────────
function getUrgency(deadline) {
  if (!deadline) return { level:0, label:'', days:null, cls:'ok' };
  const now = new Date(); now.setHours(0,0,0,0);
  const due = new Date(deadline+'T00:00:00');
  const diff = Math.round((due-now)/(1000*60*60*24));
  if (diff<0)  return { level:4, label:'Overdue',    days:diff, cls:'overdue'  };
  if (diff===0) return { level:3, label:'Due today',  days:0,    cls:'critical' };
  if (diff<=3)  return { level:2, label:`${diff}d`,   days:diff, cls:'urgent'   };
  if (diff<=7)  return { level:1, label:`${diff}d`,   days:diff, cls:'soon'     };
  return { level:0, label:`${diff}d`, days:diff, cls:'ok' };
}
function deadlineBadgeClass(cls) { return {ok:'deadline-ok',soon:'deadline-soon',urgent:'deadline-urgent',critical:'deadline-critical',overdue:'deadline-overdue'}[cls]||'deadline-ok'; }
function countdownClass(cls) { return {ok:'',soon:'urgent',urgent:'urgent',critical:'critical',overdue:'overdue'}[cls]||''; }

// ─── VOICE LOG ────────────────────────────────────────────────────────────────
let recognition = null, isRecording = false;
function toggleVoice() {
  if (!('webkitSpeechRecognition' in window||'SpeechRecognition' in window)) { showToast('Voice not supported in this browser'); return; }
  if (isRecording) { recognition&&recognition.stop(); return; }
  const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
  recognition = new SR(); recognition.continuous=true; recognition.interimResults=true; recognition.lang='en-US';
  recognition.onstart = () => { isRecording=true; document.getElementById('voice-btn').classList.add('recording'); document.getElementById('voice-label').textContent='Recording — tap to stop'; };
  recognition.onresult = e => {
    let final='',interim='';
    for (let i=e.resultIndex;i<e.results.length;i++) { if(e.results[i].isFinal) final+=e.results[i][0].transcript; else interim+=e.results[i][0].transcript; }
    const box=document.getElementById('transcript'); box.textContent=(final||interim)||'Listening...'; box.classList.toggle('has-text',!!(final||interim));
    if(final){const ta=document.getElementById('text-log');ta.value=(ta.value?ta.value+' ':'')+final;triggerAutoSaveDay();}
  };
  recognition.onend = () => { isRecording=false; document.getElementById('voice-btn').classList.remove('recording'); document.getElementById('voice-label').textContent='Tap to record — or type below'; };
  recognition.start();
}

// ─── AI FEEDBACK ──────────────────────────────────────────────────────────────
async function getAIFeedback() {
  const btn  = document.getElementById('analyze-btn');
  const box  = document.getElementById('feedback-text');
  const log  = document.getElementById('text-log').value || document.getElementById('transcript').textContent;
  const dk   = todayStr();
  const d    = getDay(dk);
  const score = calcDailyScore(dk);
  const breached = getBreachedHabits(dk);
  const done = S.habits.filter(h => d.habits[h]);
  const weeklyGoals  = S.goals.filter(g=>g.type==='weekly').map(g=>`${g.name} (${g.progress||0}/10)`).join(', ')||'none';
  const monthlyGoals = S.goals.filter(g=>g.type==='monthly').map(g=>`${g.name} (${g.progress||0}/10)`).join(', ')||'none';
  if (!S.groqKey) { box.innerHTML='<em style="color:var(--yellow)">Add your Groq API key in Settings.</em>'; return; }
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span>Analyzing...';
  box.textContent='Processing...';
  try {
    const text = await callGroq([{ role:'user', content:`VANTAGE AI. Be direct, specific, max 150 words.
Execution score today: ${score}%. Habits done (${done.length}/${S.habits.length}): ${done.join(', ')||'none'}.
SYSTEM BREACHES (critical/high habits missed): ${breached.join(', ')||'none'}.
Mood: ${document.getElementById('inp-mood').value}/10 | Sleep: ${document.getElementById('inp-sleep').value||'?'}h
Weekly goals: ${weeklyGoals}. Monthly goals: ${monthlyGoals}.
Weekly delta: "${S.lastWeekDelta||'not set'}". Monthly delta: "${S.monthDelta||'not set'}".
Log: "${log||'nothing logged'}"
1) Gap between execution and stated goals. 2) One actionable fix. 3) Call out any system breach.` }], 250, 0.7);
    box.textContent = text;
  } catch(e) { box.innerHTML=`<em style="color:var(--red)">Error: ${e.message}</em>`; }
  btn.disabled=false; btn.innerHTML='Analyze My Day';
}

// ─── WEEKLY NON-NEGOTIABLES ───────────────────────────────────────────────────
function getWeekSunday(date=new Date()) {
  const d = new Date(date); d.setHours(0,0,0,0); d.setDate(d.getDate()-d.getDay());
  return d.toISOString().split('T')[0];
}

function renderWeeklyNonNeg() {
  const card = document.getElementById('wnn-card');
  const list = document.getElementById('wnn-list');
  if (!card||!list) return;
  if (!S.weeklyNonNeg||!S.weeklyNonNeg.length) { card.style.display='none'; return; }
  card.style.display = 'block';
  const weekKey = getWeekSunday();
  const status  = (S.weeklyNonNegStatus&&S.weeklyNonNegStatus[weekKey])||{};
  const done    = S.weeklyNonNeg.filter(t => status[t]).length;
  document.getElementById('wnn-count').textContent = `${done}/${S.weeklyNonNeg.length}`;
  const daysLeft = 6 - new Date().getDay();
  document.getElementById('wnn-week-label').textContent = daysLeft===0 ? 'Resets tonight' : `${daysLeft}d left`;
  list.innerHTML = '';
  S.weeklyNonNeg.forEach(task => {
    const checked = status[task]||false;
    const el = document.createElement('div');
    el.className = 'habit-item'+(checked?' done':'');
    el.onclick = () => toggleWeeklyNonNeg(task);
    el.innerHTML = `
      <div class="habit-left">
        <div class="habit-cb">${checked?'✓':''}</div>
        <div class="habit-name">${task}</div>
      </div>
      <div class="habit-right">
        <span class="stake-tag stake-crit">N/N</span>
      </div>`;
    list.appendChild(el);
  });
}

async function toggleWeeklyNonNeg(task) {
  const weekKey = getWeekSunday();
  if (!S.weeklyNonNegStatus) S.weeklyNonNegStatus = {};
  if (!S.weeklyNonNegStatus[weekKey]) S.weeklyNonNegStatus[weekKey] = {};
  const prev = S.weeklyNonNegStatus[weekKey][task]||false;
  S.weeklyNonNegStatus[weekKey][task] = !prev;
  await saveUserSettings();
  renderWeeklyNonNeg();
}

function renderWnnSettings() {
  const ed = document.getElementById('wnn-editor');
  if (!ed) return;
  ed.innerHTML = '';
  if (!S.weeklyNonNeg||!S.weeklyNonNeg.length) {
    ed.innerHTML='<div style="font-size:0.75rem;color:var(--muted);padding:8px 0">No non-negotiables set.</div>'; return;
  }
  S.weeklyNonNeg.forEach((task,i) => {
    const row = document.createElement('div'); row.className='habit-edit-item';
    row.innerHTML=`<input type="text" class="inp" value="${task.replace(/"/g,'&quot;')}" id="wnn-${i}" style="flex:1;min-width:0"/>
      <button class="del-btn" onclick="removeWnn(${i})">✕</button>`;
    ed.appendChild(row);
  });
}

function removeWnn(i) { S.weeklyNonNeg.splice(i,1); renderWnnSettings(); }

async function saveWnn() {
  const inputs = document.querySelectorAll('#wnn-editor input[id^="wnn-"]');
  S.weeklyNonNeg = Array.from(inputs).map(el => el.value.trim()).filter(Boolean);
  await saveUserSettings();
  showToast('Non-negotiables saved', 2000, 'positive');
  renderWnnSettings(); renderWeeklyNonNeg();
}

function addWnnField() {
  if (!S.weeklyNonNeg) S.weeklyNonNeg=[];
  S.weeklyNonNeg.push(''); renderWnnSettings();
  setTimeout(()=>{const inputs=document.querySelectorAll('[id^="wnn-"]');if(inputs.length)inputs[inputs.length-1].focus();},50);
}

// ─── DAILY FRICTION QUESTION ──────────────────────────────────────────────────
function injectDailyFrictionQuestion() {
  const existing = document.getElementById('daily-friction-q');
  if (existing) existing.remove();
  if (!S.dailyFrictionQuestion) return;
  const el = document.createElement('div');
  el.id = 'daily-friction-q';
  el.innerHTML=`
    <div style="font-size:0.55rem;font-family:'Space Mono',monospace;color:var(--yellow);letter-spacing:2px;text-transform:uppercase;margin-bottom:5px">Daily Friction Check</div>
    <div style="font-size:0.78rem;color:var(--text);line-height:1.55;margin-bottom:8px">${S.dailyFrictionQuestion}</div>
    <div style="display:flex;gap:8px">
      <button onclick="logFrictionAnswer(true,this)" style="background:#081a08;border:1px solid var(--green);color:var(--green);border-radius:6px;padding:5px 14px;font-family:'Space Mono',monospace;font-size:0.65rem;cursor:pointer">Yes</button>
      <button onclick="logFrictionAnswer(false,this)" style="background:#0d0000;border:1px solid var(--red);color:var(--red);border-radius:6px;padding:5px 14px;font-family:'Space Mono',monospace;font-size:0.65rem;cursor:pointer">No</button>
    </div>`;
  const target = document.getElementById('wnn-card') || document.getElementById('weekly-goals-card');
  if (target) target.parentNode.insertBefore(el, target);
}

function logFrictionAnswer(yes, btn) {
  btn.parentElement.querySelectorAll('button').forEach(b => b.style.opacity='0.4');
  btn.style.opacity='1'; btn.style.fontWeight='700';
  if (!yes) showToast('Friction unresolved. Address it before tonight.', 3000, 'negative');
}

// ─── DELTA ANCHOR ─────────────────────────────────────────────────────────────
function injectDeltaAnchor() {
  const existing = document.getElementById('delta-anchor-bar');
  if (existing) existing.remove();
  if (!S.monthDelta) return;
  const bar = document.createElement('div');
  bar.id = 'delta-anchor-bar';
  bar.innerHTML=`<span style="color:var(--accent);font-weight:700;flex-shrink:0;font-family:'Space Mono',monospace">MONTHLY DELTA:</span><span style="font-style:italic;opacity:0.8">${S.monthDelta}</span>`;
  const main = document.querySelector('.main');
  if (main) main.insertBefore(bar, main.firstChild);
}

// ─── MONTH PAGE ───────────────────────────────────────────────────────────────
function renderMonthPage() {
  document.getElementById('month-label-header').textContent = MONTHS[S.month]+' '+S.year;
  const dim=daysInMonth(S.month,S.year);
  const moods=[],weights=[],cals=[],prots=[],completions=[];
  for (let d=1;d<=dim;d++) {
    const dk=dateKey(d,S.month,S.year); const day=S.days[dk]; if (!day) continue;
    if (day.mood) moods.push(day.mood);
    if (day.weight) weights.push({d,v:day.weight});
    if (day.cals) cals.push({d,v:day.cals});
    if (day.protein) prots.push({d,v:day.protein});
    completions.push(calcDailyScore(dk));
  }
  const avgMood = moods.length ? (moods.reduce((a,b)=>a+b,0)/moods.length).toFixed(1) : '-';
  const avgScore = completions.length ? Math.round(completions.reduce((a,b)=>a+b,0)/completions.length) : 0;
  const firstW=weights[0]?.v, lastW=weights[weights.length-1]?.v;
  const wChange = firstW&&lastW ? (lastW-firstW).toFixed(1) : null;
  const logged  = Object.keys(S.days).filter(k=>k.startsWith(`${S.year}-${String(S.month).padStart(2,'0')}`)).length;
  document.getElementById('month-stats').innerHTML=`
    <div class="card"><div class="card-label">Avg Mood</div><div class="stat-big" style="color:var(--pink)">${avgMood}<span style="font-size:1rem;color:var(--muted)">/10</span></div></div>
    <div class="card"><div class="card-label">Avg Execution</div><div class="stat-big" style="color:${getScoreColor(avgScore)}">${avgScore}%</div><span class="tag ${avgScore>=70?'tag-g':avgScore>=45?'tag-y':'tag-r'}">${avgScore>=70?'On Track':avgScore>=45?'Drifting':'Off Course'}</span></div>
    <div class="card"><div class="card-label">Weight Change</div><div class="stat-big" style="color:${wChange&&parseFloat(wChange)<0?'var(--green)':'var(--yellow)'}">${wChange!==null?(parseFloat(wChange)>0?'+':'')+wChange+' lbs':'-'}</div></div>
    <div class="card"><div class="card-label">Days Logged</div><div class="stat-big" style="color:var(--accent)">${logged}</div><div class="stat-sub">of ${dim} days</div></div>`;
  renderMoodChart(dim);
  renderWeightChart(weights, dim);
  renderHeatmap(dim);
  renderBarChart('cal-bars',cals,2800,'var(--yellow)','');
  renderBarChart('prot-bars',prots,300,'var(--pink)','g');
  renderMonthlyGoals();
}

function renderMoodChart(dim) {
  const mc=document.getElementById('month-mood-chart'); mc.innerHTML='';
  const colors=['#ef4444','#ef4444','#f59e0b','#f59e0b','#f59e0b','#22c55e','#22c55e','#22c55e','#22c55e','#6c63ff'];
  for (let d=1;d<=dim;d++) {
    const dk=dateKey(d,S.month,S.year); const m=S.days[dk]?.mood||null;
    const wrap=document.createElement('div'); wrap.className='mb-wrap';
    const bar=document.createElement('div'); bar.className='mb';
    bar.style.height=m?`${(m/10)*100}%`:'3px'; bar.style.background=m?(colors[m-1]||'#6c63ff'):'var(--border)';
    bar.title=`Day ${d}: ${m||'-'}`;
    const lbl=document.createElement('div'); lbl.className='mb-lbl'; lbl.textContent=d%7===1?d:'';
    wrap.appendChild(bar); wrap.appendChild(lbl); mc.appendChild(wrap);
  }
}

function renderWeightChart(weights, dim) {
  const svg=document.getElementById('weight-svg');
  if (weights.length>=2) {
    const W=300,H=70,P=6;
    const vals=weights.map(w=>w.v);
    const minV=Math.min(...vals)-0.5, maxV=Math.max(...vals)+0.5;
    const pts=weights.map(w=>{const x=P+(w.d-1)/(dim-1)*(W-P*2);const y=P+(1-(w.v-minV)/(maxV-minV))*(H-P*2);return `${x},${y}`;}).join(' ');
    svg.innerHTML=`<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`;
  } else { svg.innerHTML=`<text x="10" y="35" fill="#555" font-size="11" font-family="Space Mono">No weight data</text>`; }
}

function renderHeatmap(dim) {
  const hm=document.getElementById('month-heatmap'); hm.innerHTML='';
  S.habits.forEach(h => {
    const row=document.createElement('div'); row.className='heatmap-row';
    const lbl=document.createElement('div'); lbl.className='hm-label'; lbl.textContent=h; lbl.title=h;
    const dots=document.createElement('div'); dots.className='hm-dots';
    let cnt=0;
    for (let d=1;d<=dim;d++) {
      const dk=dateKey(d,S.month,S.year); const checked=S.days[dk]?.habits?.[h]||false;
      if(checked)cnt++;
      const dot=document.createElement('div'); dot.className='hm-dot';
      dot.style.background=checked?'var(--green)':'var(--border)';
      dot.title=`${h} — Day ${d}: ${checked?'Done':'Missed'}`;
      dots.appendChild(dot);
    }
    const pct=document.createElement('div'); pct.className='hm-pct';
    const p=Math.round((cnt/dim)*100);
    pct.style.color=p>=70?'var(--green)':p>=40?'var(--yellow)':'var(--red)';
    pct.textContent=p+'%';
    row.appendChild(lbl); row.appendChild(dots); row.appendChild(pct); hm.appendChild(row);
  });
}

function renderBarChart(id,data,maxDef,color,unit) {
  const cont=document.getElementById(id); cont.innerHTML='';
  const max=data.length?Math.max(...data.map(d=>d.v),maxDef):maxDef;
  if (!data.length) { cont.innerHTML='<div style="font-size:0.72rem;color:var(--muted);padding:8px">No data yet</div>'; return; }
  data.forEach(entry=>{
    const row=document.createElement('div'); row.className='bar-row-sm';
    const lbl=document.createElement('div'); lbl.className='bar-lbl-sm'; lbl.textContent=entry.d;
    const track=document.createElement('div'); track.className='bar-track';
    const fill=document.createElement('div'); fill.className='bar-fill';
    fill.style.width=`${(entry.v/max)*100}%`; fill.style.background=color; track.appendChild(fill);
    const val=document.createElement('div'); val.className='bar-val-sm';
    val.textContent=unit?entry.v+unit:entry.v.toLocaleString();
    row.appendChild(lbl); row.appendChild(track); row.appendChild(val); cont.appendChild(row);
  });
}

// ─── CALENDAR ─────────────────────────────────────────────────────────────────
function renderCalendar() {
  document.getElementById('cal-month-label').textContent = MONTHS[calViewMonth]+' '+calViewYear;
  const dim=daysInMonth(calViewMonth,calViewYear);
  const firstDay=new Date(calViewYear,calViewMonth-1,1).getDay();
  const grid=document.getElementById('cal-grid'); grid.innerHTML='';
  ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d=>{const h=document.createElement('div');h.className='cal-header';h.textContent=d;grid.appendChild(h);});
  for (let i=0;i<firstDay;i++){const e=document.createElement('div');e.className='cal-day empty';grid.appendChild(e);}
  const tf=todayStr();
  for (let d=1;d<=dim;d++) {
    const dk=dateKey(d,calViewMonth,calViewYear);
    const el=document.createElement('div');
    el.className='cal-day'+(dk===tf?' today':'')+(S.days[dk]?' has-log':'')+(dk===calSelectedDate?' selected':'');
    el.textContent=d; el.onclick=()=>openCalDay(dk,d); grid.appendChild(el);
  }
}
function calPrev(){calViewMonth--;if(calViewMonth<1){calViewMonth=12;calViewYear--;}renderCalendar();}
function calNext(){calViewMonth++;if(calViewMonth>12){calViewMonth=1;calViewYear++;}renderCalendar();}

async function openCalDay(dk,d) {
  calSelectedDate=dk; renderCalendar();
  if (!S.days[dk]) {
    const {data}=await sb.from('logs').select('*').eq('user_id',currentUser.id).eq('date',dk).single();
    if (data) S.days[dk]={habits:data.habits||{},mood:data.mood||7,weight:data.weight,cals:data.calories,protein:data.protein,sleep:data.sleep,win:data.win||'',log:data.log_text||''};
  }
  const day=getDay(dk);
  const editor=document.getElementById('cal-day-editor'); editor.style.display='block';
  document.getElementById('cal-editing-label').textContent=`Editing — ${MONTHS[calViewMonth]} ${d}, ${calViewYear}`;
  document.getElementById('cal-mood').value=day.mood||7;
  document.getElementById('cal-mood-val').textContent=day.mood||7;
  document.getElementById('cal-weight').value=day.weight||'';
  document.getElementById('cal-cals').value=day.cals||'';
  document.getElementById('cal-protein').value=day.protein||'';
  document.getElementById('cal-sleep').value=day.sleep||'';
  document.getElementById('cal-win').value=day.win||'';
  document.getElementById('cal-log').value=day.log||'';
  renderCalHabitList(dk);
  editor.scrollIntoView({behavior:'smooth',block:'start'});
}

function renderCalHabitList(dk) {
  const d=getDay(dk); const list=document.getElementById('cal-habit-list'); list.innerHTML='';
  S.habits.forEach(h=>{
    const checked=d.habits[h]||false; const stake=S.habitStakes[h]||'medium';
    const el=document.createElement('div'); el.className='habit-item'+(checked?' done':'');
    el.onclick=()=>toggleCalHabit(dk,h);
    el.innerHTML=`<div class="habit-left"><div class="habit-cb">${checked?'✓':''}</div><div class="habit-name">${h}</div></div><span class="stake-tag ${STAKES[stake].cls}">${STAKES[stake].label}</span>`;
    list.appendChild(el);
  });
}

async function toggleCalHabit(dk,h) {
  if (!S.days[dk]) S.days[dk]=getDay(dk);
  S.days[dk].habits[h]=!S.days[dk].habits[h];
  renderCalHabitList(dk);
}

async function saveCalDay() {
  if (!calSelectedDate) return;
  const dk=calSelectedDate;
  if (!S.days[dk]) S.days[dk]=getDay(dk);
  const d=S.days[dk];
  d.mood=parseInt(document.getElementById('cal-mood').value)||7;
  d.weight=parseFloat(document.getElementById('cal-weight').value)||null;
  d.cals=parseInt(document.getElementById('cal-cals').value)||null;
  d.protein=parseInt(document.getElementById('cal-protein').value)||null;
  d.sleep=parseFloat(document.getElementById('cal-sleep').value)||null;
  d.win=document.getElementById('cal-win').value;
  d.log=document.getElementById('cal-log').value;
  await saveDayToDB(dk,d); renderCalendar();
}

// ─── WINS ─────────────────────────────────────────────────────────────────────
function renderWinsPage() {
  const list=document.getElementById('wins-list'); list.innerHTML='';
  const dim=daysInMonth(S.month,S.year); let found=false;
  for (let d=dim;d>=1;d--) {
    const dk=dateKey(d,S.month,S.year); const day=S.days[dk];
    if (!day?.win) continue; found=true;
    const item=document.createElement('div'); item.className='win-item';
    item.innerHTML=`<div class="win-date">${MONTHS[S.month].slice(0,3)} ${d}</div><div>${day.win}</div>`;
    list.appendChild(item);
  }
  if (!found) list.innerHTML='<div style="color:var(--muted);font-size:0.85rem;padding:20px 0">No wins logged this month.</div>';
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function renderSettings() {
  document.getElementById('set-month').value=S.month;
  document.getElementById('set-year').value=S.year;
  document.getElementById('set-groq-key').value=S.groqKey||'';
  renderHabitsEditor();
  renderGoalsEditor();
  renderWnnSettings();
  renderEconomyStatus();
}

function renderHabitsEditor() {
  const ed=document.getElementById('habits-editor'); ed.innerHTML='';
  S.habits.forEach((h,i)=>{
    const stake=S.habitStakes[h]||'medium';
    const row=document.createElement('div'); row.className='habit-edit-item';
    row.innerHTML=`<input type="text" class="inp" value="${h.replace(/"/g,'&quot;')}" id="hf-${i}" style="flex:1;min-width:0"/>
      <select class="inp" id="hs-${i}" style="width:76px;font-family:'Space Mono',monospace;font-size:0.7rem;padding:8px 6px">
        <option value="low"      ${stake==='low'     ?'selected':''}>LOW</option>
        <option value="medium"   ${stake==='medium'  ?'selected':''}>MED</option>
        <option value="high"     ${stake==='high'    ?'selected':''}>HIGH</option>
        <option value="critical" ${stake==='critical'?'selected':''}>CRIT</option>
      </select>
      <button class="del-btn" onclick="removeHabit(${i})">✕</button>`;
    ed.appendChild(row);
  });
}

function removeHabit(i) { S.habits.splice(i,1); renderHabitsEditor(); }
function addHabitField() {
  S.habits.push('New habit'); S.habitStakes['New habit']='medium';
  renderHabitsEditor();
  setTimeout(()=>{const inputs=document.querySelectorAll('[id^="hf-"]');if(inputs.length)inputs[inputs.length-1].focus();},50);
}

async function saveHabits() {
  const nameInputs=document.querySelectorAll('[id^="hf-"]');
  const stakeInputs=document.querySelectorAll('[id^="hs-"]');
  const newHabits=[]; const newStakes={};
  nameInputs.forEach((el,i)=>{const name=el.value.trim();if(name){newHabits.push(name);newStakes[name]=stakeInputs[i]?.value||'medium';}});
  S.habits=newHabits; S.habitStakes=newStakes;
  await saveUserSettings();
  showToast('Habits saved', 2000, 'positive');
  renderHabitsEditor(); initToday(todayStr());
}

function renderGoalsEditor() {
  const ed=document.getElementById('goals-editor'); ed.innerHTML='';
  if (!S.goals.length) { ed.innerHTML='<div style="font-size:0.72rem;color:var(--muted);padding:8px 0">No goals yet.</div>'; return; }
  S.goals.forEach((g,i)=>{
    const item=document.createElement('div'); item.className='goal-edit-item';
    item.innerHTML=`<div class="goal-edit-row">
        <input type="text" class="inp" value="${g.name.replace(/"/g,'&quot;')}" id="gname-${i}" placeholder="Goal name" style="flex:1"/>
        <span class="goal-type-badge ${g.type==='weekly'?'type-weekly':'type-monthly'}">${g.type}</span>
        <button class="del-btn" onclick="removeGoal(${i})">✕</button>
      </div>
      <div class="goal-edit-row" style="align-items:center;gap:12px">
        <label style="font-size:0.6rem;color:var(--muted);font-family:'Space Mono',monospace;white-space:nowrap">Deadline</label>
        <input type="date" class="inp" value="${g.deadline||''}" id="gdate-${i}" style="flex:1;color-scheme:dark"/>
      </div>`;
    ed.appendChild(item);
  });
}

function addGoalField(type) {
  S.goals.push({id:'g_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),name:'',type,deadline:'',progress:0});
  renderGoalsEditor();
  setTimeout(()=>{const inputs=document.querySelectorAll('[id^="gname-"]');if(inputs.length)inputs[inputs.length-1].focus();},50);
}

function removeGoal(i) { S.goals.splice(i,1); renderGoalsEditor(); }

async function saveGoals() {
  const nameInputs=document.querySelectorAll('[id^="gname-"]');
  const dateInputs=document.querySelectorAll('[id^="gdate-"]');
  nameInputs.forEach((el,i)=>{if(S.goals[i]){S.goals[i].name=el.value.trim();S.goals[i].deadline=dateInputs[i]?.value||'';}});
  S.goals=S.goals.filter(g=>g.name);
  await saveUserSettings();
  showToast('Goals saved', 2000, 'positive');
  renderGoalsEditor(); renderWeeklyGoals(); initToday(todayStr());
}

async function saveGroqKey() {
  S.groqKey=document.getElementById('set-groq-key').value.trim();
  localStorage.setItem('groq_key',S.groqKey);
  await saveUserSettings();
  showToast('API key saved', 2000, 'positive');
}

async function saveMonthSettings() {
  S.month=parseInt(document.getElementById('set-month').value);
  S.year=parseInt(document.getElementById('set-year').value);
  await loadMonthLogs(); updateSidebar();
  showToast('Month updated', 1500, 'positive');
  calViewMonth=S.month; calViewYear=S.year;
}

async function clearMonthData() {
  if (!confirm('Clear all logged data for this month? Cannot be undone.')) return;
  const from=dateKey(1,S.month,S.year); const to=dateKey(daysInMonth(S.month,S.year),S.month,S.year);
  await sb.from('logs').delete().eq('user_id',currentUser.id).gte('date',from).lte('date',to);
  S.days={}; showToast('Data cleared'); initToday(todayStr());
}

function renderEconomyStatus() {
  const el=document.getElementById('execution-status-panel'); if (!el) return;
  const score=calcDailyScore(todayStr());
  const breached=getBreachedHabits(todayStr());
  el.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.7rem">
      <div><span style="color:var(--muted)">Today's score:</span><br><span style="color:${getScoreColor(score)};font-family:'Space Mono',monospace;font-weight:700">${score}%</span></div>
      <div><span style="color:var(--muted)">System breaches:</span><br><span style="color:${breached.length>0?'var(--red)':'var(--green)';font-family:'Space Mono',monospace">${breached.length>0?breached.join(', '):'None'}</span></div>
      <div><span style="color:var(--muted)">Weekly delta:</span><br><span style="color:var(--text);font-size:0.65rem">${S.lastWeekDelta||'Not set'}</span></div>
      <div><span style="color:var(--muted)">Monthly delta:</span><br><span style="color:var(--text);font-size:0.65rem">${S.monthDelta||'Not set'}</span></div>
    </div>`;
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function updateSidebar() {
  const dim=daysInMonth(S.month,S.year);
  document.getElementById('sidebar-month').textContent=MONTHS[S.month]+' '+S.year;
  document.getElementById('sidebar-day').textContent=`Day ${new Date().getDate()} of ${dim}`;
}

// ─── GROQ ─────────────────────────────────────────────────────────────────────
async function callGroq(messages, maxTokens=400, temperature=0.7) {
  if (!S.groqKey) throw new Error('No API key');
  const body=JSON.stringify({model:'llama-3.3-70b-versatile',messages,max_tokens:maxTokens,temperature});
  const headers={'Content-Type':'application/json','Authorization':'Bearer '+S.groqKey};
  let res=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers,body});
  if (res.status===429) { await new Promise(r=>setTimeout(r,2000)); res=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers,body}); }
  const data=await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content.trim();
}

// ─── TEMPORAL REVIEWS ─────────────────────────────────────────────────────────
function checkTemporalReviews() {
  const now=new Date(); const today=todayStr();
  if (now.getDay()===1 && S.lastWeeklyReview!==today) setTimeout(()=>showWeeklyReview(),800);
  if (now.getDate()===1) {
    const lastMonth = new Date(now.getFullYear(),now.getMonth()-1,1).toISOString().slice(0,7);
    if (S.lastMonthlyRecap!==lastMonth) setTimeout(()=>showMonthlyAudit(lastMonth+'_'+String(now.getMonth()).padStart(2,'0')),1200);
  }
}

// ─── WEEKLY DIAGNOSTIC ────────────────────────────────────────────────────────
function getHabitCategory(stake) {
  if (stake==='critical'||stake==='high') return {weight:3,label:'HIGH IMPACT'};
  if (stake==='medium') return {weight:1,label:'STANDARD'};
  return {weight:0.5,label:'MAINTENANCE'};
}

function calcWeightedScore(days) {
  let totalPlanned=0, totalAchieved=0;
  const catBreak={'HIGH IMPACT':{p:0,a:0},'STANDARD':{p:0,a:0},'MAINTENANCE':{p:0,a:0}};
  const perHabit=[];
  S.habits.forEach(h=>{
    const stake=S.habitStakes[h]||'medium';
    const cat=getHabitCategory(stake);
    const doneCount=days.filter(d=>(S.days[d.dk]||{habits:{}}).habits[h]).length;
    const pct=Math.round((doneCount/7)*100);
    totalPlanned+=7*cat.weight; totalAchieved+=doneCount*cat.weight;
    catBreak[cat.label].p+=7*cat.weight; catBreak[cat.label].a+=doneCount*cat.weight;
    const missedDays=7-doneCount;
    const opp = cat.label==='HIGH IMPACT'&&doneCount<5 ? { name:h, missedDays, statement:`Missed ${missedDays}/7 days. Estimated trajectory delay: ${Math.ceil(missedDays*0.75)}d.` } : null;
    perHabit.push({name:h,stake,doneCount,pct,cat,opp});
  });
  const weightedScore=totalPlanned>0?Math.round((totalAchieved/totalPlanned)*100):0;
  const oppCosts=perHabit.filter(ph=>ph.opp).map(ph=>ph.opp);
  const dangerHabits=perHabit.filter(ph=>ph.cat.label==='HIGH IMPACT'&&ph.pct<50);
  return {weightedScore,catBreak,oppCosts,perHabit,dangerHabits};
}

function recapGoTo(n) {
  [1,2,3].forEach(i=>{
    const card=document.getElementById('recap-card-'+i); if(card) card.style.display=i===n?'block':'none';
    const pip=document.getElementById('recap-pip-'+i);
    if(pip){pip.style.background=i<n?'var(--green)':i===n?'var(--accent)':'var(--border)';pip.style.transform=i===n?'scale(1.3)':'scale(1)';}
  });
}

function recapValidateCard2() {
  const f=document.getElementById('recap-friction').value.trim();
  const fl=document.getElementById('recap-flow').value.trim();
  if (!f){document.getElementById('recap-friction').style.borderColor='var(--red)';document.getElementById('recap-friction').focus();return;}
  if (!fl){document.getElementById('recap-flow').style.borderColor='var(--red)';document.getElementById('recap-flow').focus();return;}
  document.getElementById('recap-friction').style.borderColor='';
  document.getElementById('recap-flow').style.borderColor='';
  recapGoTo(3);
}

async function submitWeeklyRecap() {
  const delta=document.getElementById('recap-delta').value.trim();
  const errEl=document.getElementById('recap-card3-err');
  if (delta.length<10){errEl.textContent='Be specific. At least 10 characters.';document.getElementById('recap-delta').style.borderColor='var(--red)';return;}
  errEl.textContent=''; document.getElementById('recap-delta').style.borderColor='';
  const friction=document.getElementById('recap-friction').value.trim();
  const flow=document.getElementById('recap-flow').value.trim();
  const now=new Date(); const weekStart=new Date(now); weekStart.setDate(now.getDate()-now.getDay());
  const weekKey=weekStart.toISOString().split('T')[0];
  if (!S.weeklyRecaps) S.weeklyRecaps={};
  S.weeklyRecaps[weekKey]={friction,flow,delta,savedAt:new Date().toISOString()};
  S.lastWeekDelta=delta; S.lastWeeklyReview=todayStr();
  S.goals=S.goals.filter(g=>!g._weeklyDelta);
  const nextSunday=new Date(); nextSunday.setDate(nextSunday.getDate()+(7-nextSunday.getDay()));
  S.goals.unshift({id:'wdelta-'+weekKey,name:delta,deadline:nextSunday.toISOString().split('T')[0],progress:0,type:'weekly',_weeklyDelta:true});
  await saveUserSettings();
  renderWeeklyGoals(); renderGoalsEditor(); initToday(todayStr());
  const closeBtn=document.getElementById('recap-close-btn');
  closeBtn.style.display='block'; closeBtn.textContent='Recap Locked — Close';
  closeBtn.style.background='var(--green)'; closeBtn.style.color='#000'; closeBtn.style.border='none';
  showToast('Recap committed. Delta locked.', 2500, 'positive');
}

async function showWeeklyReview() {
  const modal=document.getElementById('weekly-review-modal');
  modal.classList.remove('hidden');
  document.getElementById('recap-close-btn').style.display='none';
  recapGoTo(1);
  const weekFrom=new Date(); weekFrom.setDate(weekFrom.getDate()-6); weekFrom.setHours(0,0,0,0);
  try {
    const {data:weekRows}=await sb.from('logs').select('*').eq('user_id',currentUser.id).gte('date',weekFrom.toISOString().split('T')[0]).lte('date',todayStr());
    if (weekRows) weekRows.forEach(row=>{S.days[row.date]={habits:row.habits||{},mood:row.mood||7,weight:row.weight,cals:row.calories,protein:row.protein,sleep:row.sleep,win:row.win||'',log:row.log_text||''};});
  } catch(e){}
  const DAYS_SHORT=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const days=[];
  for (let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const dk=d.toISOString().split('T')[0];days.push({dk,date:d});}
  const fmt=d=>d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  document.getElementById('recap-week-label').textContent=`${fmt(days[0].date)} — ${fmt(days[6].date)}`;
  document.getElementById('recap-prev-delta').innerHTML=S.lastWeekDelta?`
    <div style="background:#0a0800;border:1px solid rgba(245,158,11,0.4);border-radius:8px;padding:12px 16px;margin-bottom:16px">
      <div style="font-size:0.56rem;font-family:'Space Mono',monospace;color:var(--yellow);letter-spacing:2px;text-transform:uppercase;margin-bottom:5px">Last Week's Commitment</div>
      <div style="font-size:0.82rem;color:var(--text);line-height:1.5;font-style:italic">"${S.lastWeekDelta}"</div>
    </div>`:'';
  const {weightedScore,catBreak,oppCosts,perHabit,dangerHabits}=calcWeightedScore(days);
  const scoreColor=getScoreColor(weightedScore);
  const circ=2*Math.PI*38; const dash=circ-(weightedScore/100)*circ;
  document.getElementById('recap-score-section').innerHTML=`
    <div style="display:flex;align-items:center;gap:20px;margin-bottom:18px;flex-wrap:wrap">
      <div style="position:relative;width:88px;height:88px;flex-shrink:0">
        <svg width="88" height="88" viewBox="0 0 88 88" style="transform:rotate(-90deg)">
          <circle cx="44" cy="44" r="38" fill="none" stroke="#1a1a1a" stroke-width="7"/>
          <circle cx="44" cy="44" r="38" fill="none" stroke="${scoreColor}" stroke-width="7" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${dash.toFixed(1)}" stroke-linecap="round"/>
        </svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <span style="font-family:'Space Mono',monospace;font-size:1rem;font-weight:700;color:${scoreColor};line-height:1">${weightedScore}%</span>
          <span style="font-size:0.4rem;font-family:'Space Mono',monospace;color:var(--muted);letter-spacing:1px;margin-top:2px">WEIGHTED</span>
        </div>
      </div>
      <div style="flex:1;min-width:160px;display:flex;flex-direction:column;gap:7px">
        ${['HIGH IMPACT','STANDARD','MAINTENANCE'].map(cat=>{const b=catBreak[cat];const p=b.p>0?Math.round((b.a/b.p)*100):0;const c=getScoreColor(p);const lc=cat==='HIGH IMPACT'?'#fb923c':cat==='STANDARD'?'var(--blue)':'var(--muted)';const mult=cat==='HIGH IMPACT'?'3x':cat==='STANDARD'?'1x':'0.5x';
          return `<div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:0.53rem;font-family:'Space Mono',monospace;color:${lc};min-width:95px">${cat} <span style="color:var(--muted);font-size:0.48rem">${mult}</span></span>
            <div style="flex:1;background:var(--muted2);border-radius:3px;height:4px"><div style="width:${p}%;background:${c};height:100%;border-radius:3px"></div></div>
            <span style="font-size:0.58rem;font-family:'Space Mono',monospace;color:${c};min-width:28px;text-align:right">${p}%</span>
          </div>`}).join('')}
      </div>
    </div>`;
  document.getElementById('recap-danger-zones').innerHTML=dangerHabits.map(dh=>`
    <div style="background:#0d0000;border:1px solid rgba(225,29,72,0.4);border-radius:8px;padding:10px 14px;margin-bottom:8px">
      <div style="font-family:'Space Mono',monospace;font-size:0.68rem;color:var(--accent)">SYSTEM BREACH — ${dh.name} at ${dh.pct}% consistency</div>
    </div>`).join('');
  document.getElementById('recap-opp-costs').innerHTML=oppCosts.length?`
    <div style="font-size:0.56rem;font-family:'Space Mono',monospace;color:var(--muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">Opportunity Cost</div>
    ${oppCosts.map(o=>`<div style="background:#0d0000;border:1px solid #2a0010;border-radius:8px;padding:10px 14px;margin-bottom:6px">
      <div style="font-family:'Space Mono',monospace;font-size:0.7rem;font-weight:700;color:var(--accent);margin-bottom:4px">${o.name}</div>
      <div style="font-size:0.68rem;color:#fca5a5;line-height:1.5">${o.statement}</div>
    </div>`).join('')}`:'';
  document.getElementById('recap-drift-chart').innerHTML=`
    <div style="font-size:0.56rem;font-family:'Space Mono',monospace;color:var(--muted);text-transform:uppercase;letter-spacing:2px;margin:4px 0 8px">Drift — Planned vs Actual</div>
    <div style="display:flex;gap:4px;align-items:flex-end;height:70px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 14px">
      ${days.map(d=>{let dp=0,da=0;S.habits.forEach(h=>{const w=getHabitCategory(S.habitStakes[h]||'medium').weight;dp+=w;if((S.days[d.dk]||{habits:{}}).habits[h])da+=w;});const p=dp>0?da/dp:0;const c=getScoreColor(Math.round(p*100));const bH=Math.max(2,Math.round(p*46));
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;justify-content:flex-end">
          <div style="width:100%;background:var(--border);border-radius:2px 2px 0 0;height:46px;position:relative">
            <div style="position:absolute;bottom:0;left:0;right:0;height:${bH}px;background:${c};border-radius:2px 2px 0 0"></div>
          </div>
          <span style="font-size:0.44rem;font-family:'Space Mono',monospace;color:var(--muted)">${DAYS_SHORT[d.date.getDay()].slice(0,2)}</span>
        </div>`;}).join('')}
    </div>`;
  document.getElementById('recap-habit-rows').innerHTML=perHabit.map(ph=>{
    const c=getScoreColor(ph.pct); const lc=ph.cat.label==='HIGH IMPACT'?'#fb923c':ph.cat.label==='STANDARD'?'var(--blue)':'var(--muted)';
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--surface2);border:1px solid ${ph.pct<50&&ph.cat.label==='HIGH IMPACT'?'rgba(225,29,72,0.3)':'var(--border)'};border-radius:6px;margin-bottom:4px">
      <span style="font-size:0.52rem;font-family:'Space Mono',monospace;color:${lc};min-width:80px;flex-shrink:0">${ph.cat.label}</span>
      <span style="font-size:0.78rem;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ph.name}</span>
      <div style="width:64px;background:var(--muted2);border-radius:3px;height:4px;flex-shrink:0"><div style="width:${ph.pct}%;background:${c};height:100%;border-radius:3px"></div></div>
      <span style="font-family:'Space Mono',monospace;font-size:0.6rem;color:${c};min-width:36px;text-align:right;flex-shrink:0">${ph.doneCount}/7</span>
    </div>`;}).join('');
  const aiEl=document.getElementById('weekly-ai-text');
  if (S.groqKey) {
    aiEl.innerHTML='<div class="review-ai-label">AI DIAGNOSTIC</div><span style="color:var(--muted);font-size:0.78rem">Generating...</span>';
    try {
      const missed=perHabit.filter(ph=>ph.doneCount<=3).map(ph=>ph.name);
      const text=await callGroq([{role:'user',content:`VANTAGE AI. Weekly diagnostic. Be harsh and direct. 3-4 sentences max.
Weighted execution: ${weightedScore}%. System breaches (high-impact <50%): ${dangerHabits.map(d=>d.name).join(', ')||'none'}. Habits missed 4+ days: ${missed.join(', ')||'none'}. Opportunity costs: ${oppCosts.map(o=>o.name).join(', ')||'none'}. What is the execution gap and what needs to change?`}],180,0.8);
      aiEl.innerHTML='<div class="review-ai-label">AI DIAGNOSTIC</div>'+text;
    } catch(e){aiEl.innerHTML='<div class="review-ai-label">AI DIAGNOSTIC</div><em style="color:var(--muted)">Unavailable.</em>';}
  } else {
    aiEl.innerHTML='<div class="review-ai-label">AI DIAGNOSTIC</div><em style="color:var(--muted);font-size:0.78rem">Add a Groq API key for AI analysis.</em>';
  }
}

// ─── MONTHLY AUDIT ────────────────────────────────────────────────────────────
function auditGoTo(n) {
  for (let i=1;i<=5;i++){
    const c=document.getElementById('audit-card-'+i); if(c) c.style.display=i===n?'block':'none';
    const p=document.getElementById('audit-pip-'+i);
    if(p){p.style.background=i<n?'var(--green)':i===n?'var(--accent)':'var(--border)';p.style.transform=i===n?'scale(1.3)':'scale(1)';}
  }
}

function auditValidateCard(fieldId, nextCard) {
  const el=document.getElementById(fieldId);
  if (!el||el.value.trim().length<10){if(el){el.style.borderColor='var(--red)';el.focus();}return false;}
  el.style.borderColor=''; auditGoTo(nextCard); return true;
}

function auditValidateCard2(){if(!auditValidateCard('audit-root-failure',0))return;auditGoTo(3);}
function auditValidateCard3(){auditValidateCard('audit-trajectory',4);}
function auditValidateCard4(){auditValidateCard('audit-hard-truth',5);}

function extractKeywords(text) {
  const STOP=new Set(['the','a','an','i','to','and','or','but','is','was','it','my','me','we','this','that','so','in','of','for','on','at','be','have','did','not','with','just','been','they','from','are','what','when','how']);
  return text.toLowerCase().replace(/[^a-z\s]/g,'').split(/\s+/).filter(w=>w.length>3&&!STOP.has(w));
}

function checkExcuseRepetition(currentText) {
  const alertEl=document.getElementById('audit-excuse-alert'); if(!alertEl)return;
  const now=new Date(); const prevMk=new Date(now.getFullYear(),now.getMonth()-1,1).toISOString().slice(0,7);
  const prevAudit=(S.monthlyAudits||{})[prevMk];
  if (!prevAudit||!prevAudit.rootFailure){alertEl.innerHTML='';return;}
  const currentKw=new Set(extractKeywords(currentText)); const prevKw=extractKeywords(prevAudit.rootFailure);
  const shared=prevKw.filter(w=>currentKw.has(w));
  if (shared.length>=2) {
    alertEl.innerHTML=`<div style="background:#0d0000;border:1px solid var(--accent);border-radius:8px;padding:10px 14px;margin-bottom:10px">
      <div style="font-size:0.58rem;font-family:'Space Mono',monospace;color:var(--accent);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Excuse Repetition Detected</div>
      <div style="font-size:0.7rem;color:#fca5a5;line-height:1.5">You cited this same obstacle last month. Matching terms: <strong>${shared.slice(0,4).join(', ')}</strong>. What is your new approach?</div>
    </div>`;
  } else { alertEl.innerHTML=''; }
}

function generateFrictionQuestion(rf) {
  const l=rf.toLowerCase();
  if (l.includes('morning')||l.includes('schedule')||l.includes('time')) return 'Did you protect your first 2 hours today before opening your phone?';
  if (l.includes('energy')||l.includes('night')||l.includes('sleep')) return 'Did you protect your sleep last night?';
  if (l.includes('gym')||l.includes('train')||l.includes('workout')) return 'Did you set out your gear last night and block time today?';
  if (l.includes('distract')||l.includes('phone')||l.includes('focus')) return 'Is your phone on DND and first 90 minutes of work blocked?';
  return 'Did you take one concrete action against your root friction point today?';
}

async function showMonthlyAudit(monthKey) {
  const modal=document.getElementById('monthly-audit-modal');
  modal.classList.remove('hidden');
  document.getElementById('audit-close-btn').style.display='none';
  auditGoTo(1);
  const [yr,mo]=monthKey.split('-').map(Number);
  const monthName=new Date(yr,mo-1).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  document.getElementById('audit-month-label').textContent=monthName+' Audit';
  const prevMk=new Date(yr,mo-2,1).toISOString().slice(0,7);
  function monthCompletion(mk){
    const [y2,m2]=mk.split('-').map(Number); const d2=new Date(y2,m2,0).getDate();
    return S.habits.map(h=>{let done=0;for(let d=1;d<=d2;d++){const dk=`${y2}-${String(m2).padStart(2,'0')}-${String(d).padStart(2,'0')}`;if((S.days[dk]||{habits:{}}).habits[h])done++;}return{name:h,pct:Math.round((done/d2)*100)};});
  }
  const thisD=monthCompletion(monthKey); const prevD=monthCompletion(prevMk);
  document.getElementById('audit-ghost-chart').innerHTML=`
    <div style="font-size:0.56rem;font-family:'Space Mono',monospace;color:var(--muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">Month-Over-Month Mirror</div>
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:16px">
      ${thisD.map((h,i)=>{const prev=prevD[i]?.pct||0;const curr=h.pct;const delta=curr-prev;const cCurr=getScoreColor(curr);const dStr=delta>0?`<span style="color:var(--green)">+${delta}%</span>`:delta<0?`<span style="color:var(--red)">${delta}%</span>`:`<span style="color:var(--muted)">—</span>`;
        return `<div style="display:grid;grid-template-columns:1fr 60px 60px 36px;align-items:center;gap:8px;margin-bottom:7px">
          <span style="font-size:0.7rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.name}</span>
          <div style="position:relative;height:4px;background:var(--muted2);border-radius:3px"><div style="position:absolute;left:0;top:0;height:100%;width:${prev}%;background:#444;border-radius:3px"></div></div>
          <div style="position:relative;height:4px;background:var(--muted2);border-radius:3px"><div style="position:absolute;left:0;top:0;height:100%;width:${curr}%;background:${cCurr};border-radius:3px"></div></div>
          <span style="font-size:0.58rem;font-family:'Space Mono',monospace;text-align:right">${dStr}</span>
        </div>`;}).join('')}
      <div style="display:grid;grid-template-columns:1fr 60px 60px 36px;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
        <span></span>
        <span style="font-size:0.48rem;font-family:'Space Mono',monospace;color:#555">LAST MO</span>
        <span style="font-size:0.48rem;font-family:'Space Mono',monospace;color:var(--muted)">THIS MO</span>
        <span style="font-size:0.48rem;font-family:'Space Mono',monospace;color:var(--muted)">DELTA</span>
      </div>
    </div>`;
  const prevAudit=(S.monthlyAudits||{})[prevMk];
  document.getElementById('audit-prev-month-delta').innerHTML=prevAudit?.monthDelta?`
    <div style="background:#0d0000;border:1px solid rgba(225,29,72,0.4);border-radius:8px;padding:12px 16px;margin-bottom:16px">
      <div style="font-size:0.56rem;font-family:'Space Mono',monospace;color:var(--accent);letter-spacing:2px;text-transform:uppercase;margin-bottom:5px">Last Month's Commitment</div>
      <div style="font-size:0.82rem;color:var(--text);line-height:1.5;font-style:italic">"${prevAudit.monthDelta}"</div>
    </div>`:'';
  const frictionHistory=Object.entries(S.weeklyRecaps||{}).filter(([k])=>k.startsWith(monthKey.slice(0,7))).map(([,v])=>v.friction).filter(Boolean);
  document.getElementById('audit-friction-history').innerHTML=frictionHistory.length?`
    <div style="font-size:0.56rem;font-family:'Space Mono',monospace;color:var(--muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">Weekly Friction Points</div>
    ${frictionHistory.map((f,i)=>`<div style="background:var(--surface2);border-left:2px solid var(--accent);padding:8px 12px;border-radius:0 6px 6px 0;margin-bottom:6px">
      <div style="font-size:0.56rem;color:var(--muted);font-family:'Space Mono',monospace;margin-bottom:3px">Week ${i+1}</div>
      <div style="font-size:0.7rem;color:var(--text);line-height:1.5;font-style:italic">"${f}"</div>
    </div>`).join('')}`:`<div style="font-size:0.7rem;color:var(--muted);font-family:'Space Mono',monospace;margin-bottom:12px;font-style:italic">No weekly friction points recorded.</div>`;
  const roiSelect=document.getElementById('audit-low-roi');
  roiSelect.innerHTML='<option value="">— Select habit —</option>'+(S.habits||[]).map(h=>`<option value="${h}">${h}</option>`).join('');
}

async function submitMonthlyAudit() {
  const delta=document.getElementById('audit-month-delta').value.trim();
  const errEl=document.getElementById('audit-card5-err');
  if (delta.length<10){errEl.textContent='Be specific. At least 10 characters.';document.getElementById('audit-month-delta').style.borderColor='var(--red)';return;}
  errEl.textContent='';
  const now=new Date(); const monthKey=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  const rootFail=document.getElementById('audit-root-failure').value.trim();
  const lowRoi=document.getElementById('audit-low-roi').value;
  if (!S.monthlyAudits) S.monthlyAudits={};
  S.monthlyAudits[monthKey]={delusion:document.getElementById('audit-delusion').value.trim(),rootFailure:rootFail,lowRoiHabit:lowRoi,trajectory:document.getElementById('audit-trajectory').value.trim(),hardTruth:document.getElementById('audit-hard-truth').value.trim(),monthDelta:delta,savedAt:new Date().toISOString()};
  S.monthDelta=delta;
  if (rootFail.length>10) S.dailyFrictionQuestion=generateFrictionQuestion(rootFail);
  S.goals=S.goals.filter(g=>!g._monthDelta);
  const nextMoEnd=new Date(now.getFullYear(),now.getMonth()+2,0);
  S.goals.unshift({id:'maudit-'+monthKey,name:delta,deadline:nextMoEnd.toISOString().split('T')[0],progress:0,type:'monthly',_monthDelta:true});
  S.lastMonthlyRecap=monthKey;
  await saveUserSettings();
  renderGoalsEditor(); renderWeeklyGoals(); initToday(todayStr()); injectDeltaAnchor();
  const closeBtn=document.getElementById('audit-close-btn');
  closeBtn.style.display='block'; closeBtn.style.background='var(--accent)'; closeBtn.style.color='#fff'; closeBtn.style.border='none';
  showToast('Audit locked. Delta committed.', 2500, 'positive');
}

function closeReviewModal(id) { document.getElementById(id).classList.add('hidden'); }

// ─── OPERATOR TRIGGERS ────────────────────────────────────────────────────────
function opTriggerWeekly() { S.lastWeeklyReview=null; showWeeklyReview(); }
function opTriggerMonthly() { const now=new Date(); const mk=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0'); S.lastMonthlyRecap=null; showMonthlyAudit(mk); }

// ─── BOOT ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    if (!checkAccess()) { showPaywall(); return; }
    document.getElementById('paywall-screen').style.display = 'none';
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      currentUser = session.user;
      await initApp();
    } else {
      document.getElementById('auth-screen').style.display = 'flex';
    }
    document.getElementById('auth-password').addEventListener('keydown', e => { if(e.key==='Enter') handleAuth(); });
    document.getElementById('auth-email').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('auth-password').focus(); });
  } catch(e) {
    console.error('Boot error:', e);
    showPaywall();
  }
})();
