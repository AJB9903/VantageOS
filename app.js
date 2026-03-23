/* ============================================================
   VANTAGE 2.0 -- STRATEGIC EXECUTION ENGINE
   app.js | All Killer, No Filler
   ============================================================ */

'use strict';

// ============================================================
// 1. CONFIGURATION
// ============================================================
const CONFIG = {
  supabase: {
    // Replace with your Supabase project URL and anon key.
    // In production, inject these via your build tool or a
    // server-rendered config block. Never hardcode in source.
    url:     window.__VANTAGE_SUPABASE_URL__     || 'YOUR_SUPABASE_URL',
    anonKey: window.__VANTAGE_SUPABASE_ANON_KEY__ || 'YOUR_SUPABASE_ANON_KEY',
  },
  groq: {
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model:    'llama3-70b-8192',
  },
  stakes: {
    low:  { label: 'LOW',  weight: 1, class: 'stake-low' },
    med:  { label: 'MED',  weight: 2, class: 'stake-med' },
    high: { label: 'HIGH', weight: 3, class: 'stake-high' },
    crit: { label: 'CRIT', weight: 5, class: 'stake-crit' },
  },
  stakeDescriptions: {
    low:  'LOW: Weight x1. Supportive routine.',
    med:  'MED: Weight x2. Meaningful but not mission-critical.',
    high: 'HIGH: Weight x3. Core to weekly performance.',
    crit: 'CRIT: Weight x5. Missing this triggers a System Breach.',
  },
  scoring: {
    breachThreshold: 80,   // streak requires >= this score
  },
};

// ============================================================
// 2. STATE
// ============================================================
const STATE = {
  user:           null,
  habits:         [],
  todayLogs:      [],     // { habit_id, completed, date }
  goals:          [],     // all goals, filtered on render
  historicalLogs: [],     // last 60 days of logs for charts
  settings:       { groqApiKey: '' },
  ui: {
    activeView:    'dashboard',
    loading:       false,
    systemBreach:  false,
    breachedHabits:[],
  },
  charts: {
    ghost: null,
    drift: null,
  },
};

// ============================================================
// 3. SUPABASE CLIENT
// ============================================================
let DB = null;

function initSupabase() {
  if (!window.supabase) {
    console.error('VANTAGE: Supabase client not loaded.');
    return;
  }
  DB = window.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
}

// ============================================================
// 4. UTILITIES
// ============================================================
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function dateISO(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
}

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }

function pct(val, total) {
  if (!total) return 0;
  return Math.round((val / total) * 100);
}

function stakeWeight(stake) {
  return CONFIG.stakes[stake]?.weight ?? 1;
}

function stakeClass(stake) {
  return CONFIG.stakes[stake]?.class ?? 'stake-low';
}

function stakeLabel(stake) {
  return CONFIG.stakes[stake]?.label ?? 'LOW';
}

function rateClass(rate) {
  if (rate >= 80) return 'rate-good';
  if (rate >= 50) return 'rate-ok';
  return 'rate-bad';
}

function showToast(msg, type = 'default') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toast-out 0.2s ease forwards';
    setTimeout(() => t.remove(), 220);
  }, 3000);
}

function setLoading(on) {
  STATE.ui.loading = on;
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.toggle('hidden', !on);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// 5. AUTH MODULE
// ============================================================
const Auth = {
  async signIn(email, password) {
    const { data, error } = await DB.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async signUp(email, password) {
    const { data, error } = await DB.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  },

  async signOut() {
    await DB.auth.signOut();
  },

  async getSession() {
    const { data } = await DB.auth.getSession();
    return data.session;
  },

  onAuthStateChange(callback) {
    return DB.auth.onAuthStateChange((_event, session) => {
      callback(session);
    });
  },
};

// ============================================================
// 6. DATA LAYER
// ============================================================
const Data = {

  // -- HABITS --
  async fetchHabits() {
    const { data, error } = await DB
      .from('habits')
      .select('*')
      .eq('user_id', STATE.user.id)
      .eq('active', true)
      .order('created_at', { ascending: true });
    if (error) throw error;
    STATE.habits = data ?? [];
    return STATE.habits;
  },

  async saveHabit(habit) {
    const payload = {
      user_id: STATE.user.id,
      name:    habit.name,
      stake:   habit.stake,
      active:  true,
    };
    if (habit.id) {
      const { error } = await DB.from('habits').update(payload).eq('id', habit.id);
      if (error) throw error;
    } else {
      const { error } = await DB.from('habits').insert(payload);
      if (error) throw error;
    }
    await Data.fetchHabits();
  },

  async deleteHabit(id) {
    // Soft-delete: mark inactive
    const { error } = await DB
      .from('habits')
      .update({ active: false })
      .eq('id', id);
    if (error) throw error;
    await Data.fetchHabits();
  },

  // -- LOGS --
  async fetchTodayLogs() {
    const today = todayISO();
    const { data, error } = await DB
      .from('logs')
      .select('*')
      .eq('user_id', STATE.user.id)
      .eq('date', today);
    if (error) throw error;
    STATE.todayLogs = data ?? [];
    return STATE.todayLogs;
  },

  async fetchHistoricalLogs(days = 60) {
    const since = daysAgoISO(days);
    const { data, error } = await DB
      .from('logs')
      .select('*')
      .eq('user_id', STATE.user.id)
      .gte('date', since)
      .order('date', { ascending: true });
    if (error) throw error;
    STATE.historicalLogs = data ?? [];
    return STATE.historicalLogs;
  },

  async toggleLog(habitId, completed, note = null) {
    const today   = todayISO();
    const existing = STATE.todayLogs.find(l => l.habit_id === habitId);

    if (existing) {
      const { error } = await DB
        .from('logs')
        .update({ completed, note, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) throw error;
      existing.completed = completed;
    } else {
      const { error } = await DB.from('logs').insert({
        user_id:  STATE.user.id,
        habit_id: habitId,
        date:     today,
        completed,
        note,
      });
      if (error) throw error;
      STATE.todayLogs.push({ habit_id: habitId, completed, date: today, note });
    }
  },

  async logBreachNote(habitIds, note) {
    const today = todayISO();
    const inserts = habitIds.map(id => ({
      user_id:   STATE.user.id,
      habit_id:  id,
      date:      today,
      completed: false,
      note:      `[SYSTEM BREACH] ${note}`,
    }));
    // Upsert breach notes without overwriting existing log entries
    for (const ins of inserts) {
      const existing = STATE.todayLogs.find(l => l.habit_id === ins.habit_id);
      if (existing && !existing.note) {
        await DB.from('logs').update({ note: ins.note }).eq('id', existing.id);
      }
    }
  },

  async clearAllLogs() {
    const { error } = await DB
      .from('logs')
      .delete()
      .eq('user_id', STATE.user.id);
    if (error) throw error;
    STATE.todayLogs      = [];
    STATE.historicalLogs = [];
  },

  // -- GOALS --
  async fetchGoals() {
    const { data, error } = await DB
      .from('goals')
      .select('*')
      .eq('user_id', STATE.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    STATE.goals = data ?? [];
    return STATE.goals;
  },

  async saveGoal(goal) {
    const payload = {
      user_id:  STATE.user.id,
      title:    goal.title,
      type:     goal.type,
      deadline: goal.deadline,
      progress: goal.progress,
      target:   10,
    };
    if (goal.id) {
      const { error } = await DB.from('goals').update(payload).eq('id', goal.id);
      if (error) throw error;
    } else {
      const { error } = await DB.from('goals').insert(payload);
      if (error) throw error;
    }
    await Data.fetchGoals();
  },

  async updateGoalProgress(id, progress) {
    const { error } = await DB.from('goals').update({ progress }).eq('id', id);
    if (error) throw error;
    const g = STATE.goals.find(x => x.id === id);
    if (g) g.progress = progress;
  },

  async deleteGoal(id) {
    const { error } = await DB.from('goals').delete().eq('id', id);
    if (error) throw error;
    STATE.goals = STATE.goals.filter(g => g.id !== id);
  },

  // -- SETTINGS --
  async fetchSettings() {
    const { data, error } = await DB
      .from('user_settings')
      .select('*')
      .eq('user_id', STATE.user.id)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      STATE.settings.groqApiKey = data.groq_api_key ?? '';
    }
    return STATE.settings;
  },

  async saveSettings(settings) {
    const payload = {
      user_id:     STATE.user.id,
      groq_api_key: settings.groqApiKey,
      updated_at:  new Date().toISOString(),
    };
    const { data: existing } = await DB
      .from('user_settings')
      .select('id')
      .eq('user_id', STATE.user.id)
      .maybeSingle();

    if (existing) {
      const { error } = await DB
        .from('user_settings')
        .update(payload)
        .eq('user_id', STATE.user.id);
      if (error) throw error;
    } else {
      const { error } = await DB.from('user_settings').insert(payload);
      if (error) throw error;
    }
    STATE.settings = { ...STATE.settings, ...settings };
  },
};

// ============================================================
// 7. SCORING ENGINE
// ============================================================
const Score = {

  // Calculate execution score for a given set of logs + habits
  // Returns 0-100 integer
  calculate(habitList, logList) {
    if (!habitList.length) return 0;
    const totalWeight = habitList.reduce((s, h) => s + stakeWeight(h.stake), 0);
    const doneWeight  = habitList.reduce((s, h) => {
      const log = logList.find(l => l.habit_id === h.id);
      return s + (log?.completed ? stakeWeight(h.stake) : 0);
    }, 0);
    return pct(doneWeight, totalWeight);
  },

  // Today's score using STATE
  today() {
    return Score.calculate(STATE.habits, STATE.todayLogs);
  },

  // Build a map of date -> score from historical data
  buildScoreMap(habitList, logList) {
    const map = {};
    const logsByDate = {};
    for (const log of logList) {
      if (!logsByDate[log.date]) logsByDate[log.date] = [];
      logsByDate[log.date].push(log);
    }
    for (const [date, logs] of Object.entries(logsByDate)) {
      map[date] = Score.calculate(habitList, logs);
    }
    return map;
  },

  weekAvg() {
    const scores = [];
    for (let i = 1; i <= 7; i++) {
      const date = daysAgoISO(i);
      const logs = STATE.historicalLogs.filter(l => l.date === date);
      if (logs.length) scores.push(Score.calculate(STATE.habits, logs));
    }
    if (!scores.length) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  },

  // Streak: consecutive days at or above threshold
  streak() {
    let count = 0;
    for (let i = 1; i <= 365; i++) {
      const date = daysAgoISO(i);
      const logs = STATE.historicalLogs.filter(l => l.date === date);
      const sc   = Score.calculate(STATE.habits, logs);
      if (!logs.length || sc < CONFIG.scoring.breachThreshold) break;
      count++;
    }
    return count;
  },

  // Count System Breach days this month
  monthBreachCount() {
    const now        = new Date();
    const monthStart = dateISO(new Date(now.getFullYear(), now.getMonth(), 1));
    const critHabits = STATE.habits.filter(h => h.stake === 'crit');
    if (!critHabits.length) return 0;

    const monthLogs = STATE.historicalLogs.filter(l => l.date >= monthStart);
    const logsByDate = {};
    for (const log of monthLogs) {
      if (!logsByDate[log.date]) logsByDate[log.date] = [];
      logsByDate[log.date].push(log);
    }

    let breachDays = 0;
    for (const logs of Object.values(logsByDate)) {
      const hasBreach = critHabits.some(h => {
        const log = logs.find(l => l.habit_id === h.id);
        return !log || !log.completed;
      });
      if (hasBreach) breachDays++;
    }
    return breachDays;
  },

  // Detect which CRIT habits are unlogged or failed today
  detectSystemBreach() {
    const critHabits  = STATE.habits.filter(h => h.stake === 'crit');
    const breached    = critHabits.filter(h => {
      const log = STATE.todayLogs.find(l => l.habit_id === h.id);
      // Consider it a breach if explicitly marked incomplete
      // (not just un-logged -- user may not have closed out day)
      return log && !log.completed;
    });
    STATE.ui.systemBreach    = breached.length > 0;
    STATE.ui.breachedHabits  = breached;
    return breached;
  },

  // Habit completion rate over N days
  habitRate(habitId, days) {
    const since = daysAgoISO(days);
    const logs  = STATE.historicalLogs.filter(
      l => l.habit_id === habitId && l.date >= since
    );
    if (!logs.length) return null;
    const done = logs.filter(l => l.completed).length;
    return pct(done, logs.length);
  },
};

// ============================================================
// 8. AI MODULE (GROQ)
// ============================================================
const AI = {

  async call(systemPrompt, userMessage) {
    const key = STATE.settings.groqApiKey;
    if (!key) throw new Error('GROQ API KEY NOT SET. Configure in Settings.');

    const res = await fetch(CONFIG.groq.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model:       CONFIG.groq.model,
        max_tokens:  1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message ?? `Groq API error ${res.status}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  },

  buildExecutionContext() {
    const today       = todayISO();
    const todayScore  = Score.today();
    const weekAvg     = Score.weekAvg() ?? 'Insufficient data';
    const breachCount = Score.monthBreachCount();
    const critHabits  = STATE.habits.filter(h => h.stake === 'crit');
    const breached    = State => critHabits.filter(h => {
      const log = STATE.todayLogs.find(l => l.habit_id === h.id);
      return log && !log.completed;
    });

    const habitStatus = STATE.habits.map(h => {
      const log  = STATE.todayLogs.find(l => l.habit_id === h.id);
      const r7   = Score.habitRate(h.id, 7);
      return `  ${h.name} [${h.stake.toUpperCase()}] -- Today: ${
        log ? (log.completed ? 'DONE' : 'FAILED') : 'NOT LOGGED'
      } | 7-Day Rate: ${r7 !== null ? r7 + '%' : 'N/A'}`;
    }).join('\n');

    const goalStatus = STATE.goals.map(g => {
      const overdue = g.deadline && g.deadline < today;
      return `  ${g.title} [${g.type.toUpperCase()}] -- Progress: ${g.progress}/10 | Deadline: ${g.deadline}${overdue ? ' (OVERDUE)' : ''}`;
    }).join('\n');

    return `DATE: ${today}
TODAY EXECUTION SCORE: ${todayScore}%
7-DAY AVERAGE: ${weekAvg}${typeof weekAvg === 'number' ? '%' : ''}
SYSTEM BREACHES THIS MONTH: ${breachCount}

HABITS:
${habitStatus || '  None configured.'}

GOALS:
${goalStatus || '  None configured.'}`;
  },

  SYSTEM_PROMPT_BASE: `You are VANTAGE, a brutally honest strategic execution advisor. 
Your role is to identify gaps, failures, and opportunity costs without softening reality. 
You operate with zero tolerance for rationalization or excuses.
Rules:
- Do not use em dashes in your output.
- Do not use filler affirmations ("Great work!", "Keep it up!").
- Be specific. Reference actual habit names, scores, and goal titles from the data.
- Flag any missed CRITICAL habit as a SYSTEM BREACH and treat it as the primary strategic risk.
- Structure your output with clear labeled sections.
- Maximum 400 words.`,

  async getDailyBriefing() {
    const context = AI.buildExecutionContext();
    const user = `Execution context:
${context}

Deliver a DAILY BRIEFING. Structure:
EXECUTIVE STATUS: One sentence on current state.
PRIORITY FOCUS: The single most important execution target today.
SYSTEM BREACH ALERT (if any): Name the failed CRIT habit(s) and the strategic cost.
RISK EXPOSURE: What is degrading if today's pattern continues?`;

    return AI.call(AI.SYSTEM_PROMPT_BASE, user);
  },

  async getWeeklyDiagnostic() {
    const context = AI.buildExecutionContext();

    // Build last 7 days score history
    const scoreHistory = [];
    for (let i = 6; i >= 0; i--) {
      const date = daysAgoISO(i);
      const logs = STATE.historicalLogs.filter(l => l.date === date);
      const sc   = logs.length ? Score.calculate(STATE.habits, logs) : null;
      scoreHistory.push(`  ${date}: ${sc !== null ? sc + '%' : 'NO DATA'}`);
    }

    const user = `Execution context:
${context}

LAST 7 DAYS SCORE HISTORY:
${scoreHistory.join('\n')}

Deliver a WEEKLY DIAGNOSTIC. Structure:
ROOT FAILURES: What systemic patterns are causing underperformance? Be specific.
SYSTEM BREACHES: Name every CRIT habit missed this week and the cumulative cost.
EXECUTION DRIFT: Where is the gap between stated goals and actual behavior widest?
NEXT 7 DAYS: Three specific, measurable behavioral changes. No vague advice.`;

    return AI.call(AI.SYSTEM_PROMPT_BASE, user);
  },

  async getMonthlyAudit() {
    const context = AI.buildExecutionContext();

    const now        = new Date();
    const monthStart = dateISO(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthName  = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    // Build per-week averages for the month
    const monthLogs  = STATE.historicalLogs.filter(l => l.date >= monthStart);
    const scoreMap   = Score.buildScoreMap(STATE.habits, monthLogs);
    const scores     = Object.values(scoreMap);
    const monthAvg   = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

    const user = `Execution context:
${context}

MONTH: ${monthName}
MONTH AVERAGE EXECUTION SCORE: ${monthAvg}%
DATA POINTS: ${scores.length} days logged

Deliver a MONTHLY TRAJECTORY AUDIT. This is mandatory. Be relentless.
Structure:
TRAJECTORY VERDICT: Is performance improving, degrading, or stagnating? Cite numbers.
ROOT FAILURES: The 2 to 3 systemic issues that most damaged this month's performance.
SYSTEM BREACHES: Total CRIT habit failures this month and their compounding strategic cost.
GOAL ALIGNMENT GAP: For each goal, assess if execution actually supported it. Be blunt.
NEXT-CYCLE MANDATE: Three commitments the operator must make before the next month begins. Make them concrete and binary (done or not done).`;

    return AI.call(AI.SYSTEM_PROMPT_BASE, user);
  },
};

// ============================================================
// 9. CHARTS MODULE
// ============================================================
const Charts = {

  defaultOptions: {
    responsive:          true,
    maintainAspectRatio: false,
    animation:           { duration: 600 },
    plugins: {
      legend: {
        labels: {
          color:       '#888',
          font:        { family: "'Space Mono', monospace", size: 10 },
          boxWidth:    12,
          padding:     16,
        },
      },
      tooltip: {
        backgroundColor: '#111',
        borderColor:     '#333',
        borderWidth:     1,
        titleColor:      '#f8f8f8',
        bodyColor:       '#888',
        titleFont:       { family: "'Syne', sans-serif", size: 12 },
        bodyFont:        { family: "'Space Mono', monospace", size: 10 },
      },
    },
    scales: {
      x: {
        ticks:   { color: '#555', font: { family: "'Space Mono', monospace", size: 9 } },
        grid:    { color: '#1a1a1a' },
      },
      y: {
        ticks:   { color: '#555', font: { family: "'Space Mono', monospace", size: 9 } },
        grid:    { color: '#1a1a1a' },
        min:     0,
        max:     100,
      },
    },
  },

  buildMonthDays(year, month) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(year, month, i + 1);
      return dateISO(d);
    });
  },

  // Ghost Chart: current month vs last month daily scores
  renderGhost() {
    const canvas = document.getElementById('ghost-chart');
    if (!canvas) return;
    if (STATE.charts.ghost) STATE.charts.ghost.destroy();

    const now       = new Date();
    const curYear   = now.getFullYear();
    const curMonth  = now.getMonth();
    const prevDate  = new Date(curYear, curMonth - 1, 1);
    const prevYear  = prevDate.getFullYear();
    const prevMonth = prevDate.getMonth();

    const curDays  = Charts.buildMonthDays(curYear, curMonth);
    const prevDays = Charts.buildMonthDays(prevYear, prevMonth);

    const scoreMap = Score.buildScoreMap(STATE.habits, STATE.historicalLogs);

    // Use day-of-month as X axis (1..max)
    const maxDays = Math.max(curDays.length, prevDays.length);
    const labels  = Array.from({ length: maxDays }, (_, i) => String(i + 1));

    const curScores  = curDays.map(d  => scoreMap[d]  ?? null);
    const prevScores = prevDays.map(d => scoreMap[d]  ?? null);

    // Pad shorter arrays to same length with nulls
    while (curScores.length  < maxDays) curScores.push(null);
    while (prevScores.length < maxDays) prevScores.push(null);

    // Truncate current month at today
    const todayDay = now.getDate();
    for (let i = todayDay; i < curScores.length; i++) curScores[i] = null;

    const opts = {
      ...Charts.defaultOptions,
      plugins: { ...Charts.defaultOptions.plugins },
    };

    STATE.charts.ghost = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label:            'THIS MONTH',
            data:             curScores,
            borderColor:      '#e11d48',
            backgroundColor:  'rgba(225,29,72,0.08)',
            borderWidth:      2,
            pointRadius:      3,
            pointBackgroundColor: '#e11d48',
            fill:             true,
            spanGaps:         false,
            tension:          0.3,
          },
          {
            label:            'LAST MONTH (GHOST)',
            data:             prevScores,
            borderColor:      '#333',
            backgroundColor:  'transparent',
            borderWidth:      1.5,
            borderDash:       [4, 4],
            pointRadius:      2,
            pointBackgroundColor: '#444',
            fill:             false,
            spanGaps:         false,
            tension:          0.3,
          },
        ],
      },
      options: opts,
    });
  },

  // Drift Chart: Planned (100) vs Actual execution score, last 14 days
  renderDrift() {
    const canvas = document.getElementById('drift-chart');
    if (!canvas) return;
    if (STATE.charts.drift) STATE.charts.drift.destroy();

    const days   = 14;
    const dates  = Array.from({ length: days }, (_, i) => daysAgoISO(days - 1 - i));
    const labels = dates.map(d => {
      const [,, dd] = d.split('-');
      return dd;
    });

    const scoreMap = Score.buildScoreMap(STATE.habits, STATE.historicalLogs);

    // Intent = 100 for any day that has log data; 0 if no data at all
    const intentData = dates.map(d => {
      const hasLogs = STATE.historicalLogs.some(l => l.date === d);
      return hasLogs ? 100 : 0;
    });

    const actualData = dates.map(d => scoreMap[d] ?? 0);

    const opts = {
      ...Charts.defaultOptions,
      scales: {
        ...Charts.defaultOptions.scales,
        x: { ...Charts.defaultOptions.scales.x },
        y: { ...Charts.defaultOptions.scales.y, min: 0, max: 100 },
      },
    };

    STATE.charts.drift = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label:           'INTENT (100%)',
            data:            intentData,
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderColor:     '#333',
            borderWidth:     1,
          },
          {
            label:           'ACTUAL',
            data:            actualData,
            backgroundColor: dates.map(d => {
              const sc = scoreMap[d];
              if (sc === undefined) return 'rgba(50,50,50,0.5)';
              if (sc >= 80) return 'rgba(22,163,74,0.6)';
              if (sc >= 50) return 'rgba(202,138,4,0.6)';
              return 'rgba(225,29,72,0.6)';
            }),
            borderColor:     'transparent',
            borderWidth:     0,
          },
        ],
      },
      options: opts,
    });
  },
};

// ============================================================
// 10. UI RENDERER
// ============================================================
const UI = {

  // -- NAVIGATION --
  navigate(view) {
    STATE.ui.activeView = view;

    // Hide all views
    document.querySelectorAll('.view').forEach(v => {
      v.classList.add('hidden');
      v.classList.remove('active');
    });

    // Show target
    const target = document.getElementById(`view-${view}`);
    if (target) {
      target.classList.remove('hidden');
      target.classList.add('active');
    }

    // Update sidebar nav
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Update bottom nav
    document.querySelectorAll('.bnav-item[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Trigger view-specific renders
    if (view === 'analytics') {
      Charts.renderGhost();
      Charts.renderDrift();
      UI.renderBreakdownTable();
    }
  },

  // -- DASHBOARD --
  renderDashboard() {
    // Date
    const el = document.getElementById('dashboard-date');
    if (el) {
      el.textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
      }).toUpperCase();
    }

    // KPIs
    const todayScore = Score.today();
    const weekAvg    = Score.weekAvg();
    const streak     = Score.streak();
    const breaches   = Score.monthBreachCount();

    UI.setKPI('kpi-score-today', todayScore + '%', todayScore < 60 ? 'breach-val' : '');
    UI.setKPI('kpi-score-week',  weekAvg !== null ? weekAvg + '%' : '--');
    UI.setKPI('kpi-streak-val',  streak);
    UI.setKPI('kpi-breach-count', breaches, breaches > 0 ? 'breach-val' : '');

    // Sidebar + mobile score
    const scoreVal = document.getElementById('sidebar-score-val');
    if (scoreVal) scoreVal.textContent = todayScore + '%';
    const mobileScore = document.getElementById('mobile-score');
    if (mobileScore) mobileScore.textContent = todayScore + '%';

    // Breach banner
    UI.updateBreachBanner();

    // Habits checklist
    UI.renderTodayHabits();

    // Goals mini-list
    UI.renderDashboardGoals();
  },

  setKPI(id, val, extraClass = '') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent  = val;
    el.className    = 'kpi-value';
    if (extraClass) el.classList.add(extraClass);
  },

  updateBreachBanner() {
    const breached = Score.detectSystemBreach();
    const banner   = document.getElementById('breach-banner');
    if (!banner) return;
    if (breached.length) {
      banner.classList.remove('hidden');
      const names = breached.map(h => h.name).join(', ');
      document.getElementById('breach-banner-text').textContent =
        `SYSTEM BREACH: ${names}`;
    } else {
      banner.classList.add('hidden');
    }
  },

  renderTodayHabits() {
    const container = document.getElementById('today-habits-list');
    if (!container) return;

    if (!STATE.habits.length) {
      container.innerHTML = `<div class="empty-state"><p>No habits configured.</p><p>Go to HABITS to add your first one.</p></div>`;
      return;
    }

    const total  = STATE.habits.length;
    const done   = STATE.habits.filter(h =>
      STATE.todayLogs.find(l => l.habit_id === h.id && l.completed)
    ).length;

    const label = document.getElementById('habits-completion-label');
    if (label) label.textContent = `${done} / ${total} COMPLETED`;

    container.innerHTML = STATE.habits.map(h => {
      const log       = STATE.todayLogs.find(l => l.habit_id === h.id);
      const completed = log?.completed ?? false;
      const sc        = CONFIG.stakes[h.stake] ?? CONFIG.stakes.low;
      return `
        <div class="habit-check-item stake-${h.stake} ${completed ? 'done' : ''}"
             data-habit-id="${h.id}" role="button" tabindex="0"
             aria-label="Toggle ${escapeHtml(h.name)}">
          <div class="habit-checkbox">
            <svg viewBox="0 0 12 12" fill="none" stroke="white" stroke-width="2">
              <polyline points="1,6 4,10 11,2"/>
            </svg>
          </div>
          <span class="habit-check-name">${escapeHtml(h.name)}</span>
          <span class="stake-badge stake-${h.stake} habit-check-stake">${sc.label}</span>
        </div>`;
    }).join('');

    // Event: toggle habit
    container.querySelectorAll('.habit-check-item').forEach(item => {
      item.addEventListener('click', async () => {
        const habitId = item.dataset.habitId;
        const log     = STATE.todayLogs.find(l => l.habit_id === habitId);
        const newVal  = !(log?.completed ?? false);
        try {
          await Data.toggleLog(habitId, newVal);
          UI.renderDashboard();
        } catch (err) {
          showToast('Failed to save log: ' + err.message, 'error');
        }
      });
    });
  },

  renderDashboardGoals() {
    const container = document.getElementById('dashboard-goals');
    if (!container) return;

    const active = STATE.goals.slice(0, 5);

    if (!active.length) {
      container.innerHTML = `<div class="empty-state"><p>No goals set.</p></div>`;
      return;
    }

    const today = todayISO();
    container.innerHTML = active.map(g => {
      const overdue = g.deadline && g.deadline < today;
      return `
        <div class="goal-mini-item">
          <span class="goal-mini-type">${g.type.toUpperCase()}</span>
          <span class="goal-mini-title">${escapeHtml(g.title)}</span>
          <span class="goal-mini-progress">${g.progress}/10</span>
          ${overdue ? '<span class="stake-badge stake-crit">OVERDUE</span>' : ''}
        </div>`;
    }).join('');
  },

  // -- HABITS VIEW --
  renderHabitsTable() {
    const tbody = document.getElementById('habits-tbody');
    if (!tbody) return;

    if (!STATE.habits.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No habits. Add one to begin tracking.</div></td></tr>`;
      return;
    }

    tbody.innerHTML = STATE.habits.map(h => {
      const r7  = Score.habitRate(h.id, 7);
      const r30 = Score.habitRate(h.id, 30);
      const w   = stakeWeight(h.stake);
      return `
        <tr data-habit-id="${h.id}">
          <td>${escapeHtml(h.name)}</td>
          <td><span class="stake-badge ${stakeClass(h.stake)}">${stakeLabel(h.stake)}</span></td>
          <td>x${w}</td>
          <td class="${r7 !== null ? rateClass(r7) : ''}">${r7 !== null ? r7 + '%' : '--'}</td>
          <td class="${r30 !== null ? rateClass(r30) : ''}">${r30 !== null ? r30 + '%' : '--'}</td>
          <td>
            <div class="table-actions">
              <button class="btn-icon btn-edit-habit" data-id="${h.id}" title="Edit">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon danger btn-delete-habit" data-id="${h.id}" title="Delete">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');

    // Edit
    tbody.querySelectorAll('.btn-edit-habit').forEach(btn => {
      btn.addEventListener('click', () => {
        const h = STATE.habits.find(x => x.id === btn.dataset.id);
        if (h) UI.openHabitModal(h);
      });
    });

    // Delete
    tbody.querySelectorAll('.btn-delete-habit').forEach(btn => {
      btn.addEventListener('click', () => {
        UI.confirmAction(
          'DELETE HABIT',
          'This will soft-delete the habit and hide it from tracking. Historical logs are preserved.',
          async () => {
            await Data.deleteHabit(btn.dataset.id);
            UI.renderHabitsTable();
            showToast('Habit removed.', 'default');
          }
        );
      });
    });
  },

  openHabitModal(habit = null) {
    document.getElementById('habit-modal-title').textContent = habit ? 'EDIT HABIT' : 'ADD HABIT';
    document.getElementById('habit-id-field').value    = habit?.id ?? '';
    document.getElementById('habit-name-field').value  = habit?.name ?? '';

    // Stake selector
    const stake = habit?.stake ?? 'crit';
    document.querySelectorAll('.stake-opt[data-stake]').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.stake === stake);
    });
    document.getElementById('stake-description').textContent = CONFIG.stakeDescriptions[stake];

    document.getElementById('modal-habit').classList.remove('hidden');
    document.getElementById('habit-name-field').focus();
  },

  closeHabitModal() {
    document.getElementById('modal-habit').classList.add('hidden');
  },

  // -- GOALS VIEW --
  renderGoals() {
    const weeklyEl  = document.getElementById('goals-weekly');
    const monthlyEl = document.getElementById('goals-monthly');
    if (!weeklyEl || !monthlyEl) return;

    const weekly  = STATE.goals.filter(g => g.type === 'weekly');
    const monthly = STATE.goals.filter(g => g.type === 'monthly');
    const today   = todayISO();

    const renderGoalCard = (g) => {
      const overdue = g.deadline && g.deadline < today;
      const fillPct = pct(g.progress, 10);
      return `
        <div class="goal-card">
          <div class="goal-card-header">
            <div>
              <div class="goal-card-title">${escapeHtml(g.title)}</div>
              <div class="goal-deadline ${overdue ? 'overdue' : ''}">
                ${overdue ? 'OVERDUE: ' : 'DUE: '}${formatDate(g.deadline)}
              </div>
            </div>
            <div class="table-actions">
              <button class="btn-icon btn-edit-goal" data-id="${g.id}" title="Edit">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon danger btn-delete-goal" data-id="${g.id}" title="Delete">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>
          </div>
          <div class="goal-progress-wrap">
            <div class="goal-progress-bar-bg">
              <div class="goal-progress-bar-fill" style="width:${fillPct}%"></div>
            </div>
            <span class="goal-progress-label">${g.progress}/10</span>
          </div>
          <div class="goal-actions">
            <input type="range" class="field-range goal-progress-slider"
                   min="0" max="10" step="1" value="${g.progress}"
                   data-goal-id="${g.id}" style="flex:1;margin:0;" />
          </div>
        </div>`;
    };

    weeklyEl.innerHTML  = weekly.length  ? weekly.map(renderGoalCard).join('')  : `<div class="empty-state"><p>No weekly goals.</p></div>`;
    monthlyEl.innerHTML = monthly.length ? monthly.map(renderGoalCard).join('') : `<div class="empty-state"><p>No monthly goals.</p></div>`;

    // Progress sliders
    document.querySelectorAll('.goal-progress-slider').forEach(sl => {
      sl.addEventListener('change', async () => {
        const id  = sl.dataset.goalId;
        const val = parseInt(sl.value, 10);
        try {
          await Data.updateGoalProgress(id, val);
          UI.renderGoals();
          UI.renderDashboardGoals();
        } catch (err) {
          showToast('Failed to update goal: ' + err.message, 'error');
        }
      });
    });

    // Edit
    document.querySelectorAll('.btn-edit-goal').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = STATE.goals.find(x => x.id === btn.dataset.id);
        if (g) UI.openGoalModal(g);
      });
    });

    // Delete
    document.querySelectorAll('.btn-delete-goal').forEach(btn => {
      btn.addEventListener('click', () => {
        UI.confirmAction(
          'DELETE GOAL',
          'This goal and its progress will be permanently removed.',
          async () => {
            await Data.deleteGoal(btn.dataset.id);
            UI.renderGoals();
            showToast('Goal removed.', 'default');
          }
        );
      });
    });
  },

  openGoalModal(goal = null) {
    document.getElementById('goal-modal-title').textContent = goal ? 'EDIT GOAL' : 'ADD GOAL';
    document.getElementById('goal-id-field').value       = goal?.id ?? '';
    document.getElementById('goal-title-field').value    = goal?.title ?? '';
    document.getElementById('goal-deadline-field').value = goal?.deadline ?? '';
    document.getElementById('goal-progress-field').value = goal?.progress ?? 0;
    document.getElementById('goal-progress-display').textContent = goal?.progress ?? 0;

    const type = goal?.type ?? 'weekly';
    document.querySelectorAll('.stake-opt[data-goal-type]').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.goalType === type);
    });

    document.getElementById('modal-goal').classList.remove('hidden');
    document.getElementById('goal-title-field').focus();
  },

  closeGoalModal() {
    document.getElementById('modal-goal').classList.add('hidden');
  },

  // -- ANALYTICS --
  renderBreakdownTable() {
    const tbody = document.getElementById('breakdown-tbody');
    if (!tbody) return;

    if (!STATE.habits.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No habits configured.</div></td></tr>`;
      return;
    }

    tbody.innerHTML = STATE.habits.map(h => {
      const r7  = Score.habitRate(h.id, 7);
      const r30 = Score.habitRate(h.id, 30);
      let statusHtml = '';
      if (h.stake === 'crit') {
        const breachDays = Score.monthBreachCount();
        statusHtml = breachDays > 0
          ? `<span class="status-tag status-breach">SYSTEM BREACH x${breachDays}</span>`
          : `<span class="status-tag status-on-track">CLEAN</span>`;
      } else if (r30 !== null) {
        statusHtml = r30 >= 80
          ? `<span class="status-tag status-on-track">ON TRACK</span>`
          : r30 >= 50
          ? `<span class="status-tag status-at-risk">AT RISK</span>`
          : `<span class="status-tag status-breach">FAILING</span>`;
      } else {
        statusHtml = `<span class="status-tag">--</span>`;
      }
      return `
        <tr>
          <td>${escapeHtml(h.name)}</td>
          <td><span class="stake-badge ${stakeClass(h.stake)}">${stakeLabel(h.stake)}</span></td>
          <td class="${r7 !== null ? rateClass(r7) : ''}">${r7 !== null ? r7 + '%' : '--'}</td>
          <td class="${r30 !== null ? rateClass(r30) : ''}">${r30 !== null ? r30 + '%' : '--'}</td>
          <td>${statusHtml}</td>
        </tr>`;
    }).join('');
  },

  // -- AI ADVISOR VIEW --
  setAdvisorOutput(content, isLoading = false) {
    const container = document.getElementById('advisor-output');
    if (!container) return;

    if (isLoading) {
      container.innerHTML = `
        <div class="advisor-content">
          <div class="loading-block">
            <div class="loading-spinner"></div>
            <span>Analyzing execution data...</span>
          </div>
        </div>`;
      return;
    }

    const sections = content.split('\n\n');
    const html = sections.map(section => {
      const lines   = section.trim().split('\n');
      const heading = lines[0];
      const body    = lines.slice(1).join('\n').trim();

      if (heading && heading === heading.toUpperCase() && heading.endsWith(':')) {
        return `
          <div class="advisor-section">
            <div class="advisor-section-title">${escapeHtml(heading)}</div>
            <div class="advisor-text">${escapeHtml(body)}</div>
          </div>`;
      }
      return `<div class="advisor-text" style="padding:1.5rem 1.5rem 0;">${escapeHtml(section)}</div>`;
    }).join('');

    container.innerHTML = `<div class="advisor-content">${html}</div>`;
  },

  // -- SETTINGS VIEW --
  renderSettings() {
    const emailEl = document.getElementById('settings-user-email');
    if (emailEl) emailEl.textContent = STATE.user?.email ?? '--';

    const groqEl = document.getElementById('settings-groq-key');
    if (groqEl) groqEl.value = STATE.settings.groqApiKey ?? '';
  },

  // -- MODALS --
  openBreachModal() {
    const list = document.getElementById('breach-habits-list');
    if (list) {
      list.innerHTML = STATE.ui.breachedHabits.map(h =>
        `<div class="breach-habit-item">CRIT FAILURE: ${escapeHtml(h.name)}</div>`
      ).join('');
    }
    document.getElementById('breach-note').value = '';
    document.getElementById('modal-breach').classList.remove('hidden');
  },

  closeBreachModal() {
    document.getElementById('modal-breach').classList.add('hidden');
  },

  confirmAction(title, message, onConfirm) {
    document.getElementById('confirm-title').textContent   = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('modal-confirm').classList.remove('hidden');

    const okBtn = document.getElementById('btn-confirm-ok');
    const newOk = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);

    newOk.addEventListener('click', async () => {
      document.getElementById('modal-confirm').classList.add('hidden');
      try { await onConfirm(); } catch (err) { showToast(err.message, 'error'); }
    });
  },
};

// ============================================================
// 11. EVENT HANDLERS
// ============================================================
function attachEventHandlers() {

  // -- AUTH FORM --
  const authForm = document.getElementById('auth-form');
  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email    = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      const loader   = document.querySelector('.btn-loader');
      const btnText  = document.querySelector('.btn-text');
      const errEl    = document.getElementById('auth-error');

      errEl.classList.add('hidden');
      if (loader) loader.classList.remove('hidden');
      if (btnText) btnText.classList.add('hidden');

      try {
        await Auth.signIn(email, password);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      } finally {
        if (loader) loader.classList.add('hidden');
        if (btnText) btnText.classList.remove('hidden');
      }
    });
  }

  document.getElementById('btn-signup')?.addEventListener('click', async () => {
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const errEl    = document.getElementById('auth-error');
    errEl.classList.add('hidden');

    if (!email || !password) {
      errEl.textContent = 'Email and password required.';
      errEl.classList.remove('hidden');
      return;
    }

    try {
      await Auth.signUp(email, password);
      errEl.style.color   = '#16a34a';
      errEl.textContent   = 'Account created. Check your email to confirm, then sign in.';
      errEl.classList.remove('hidden');
    } catch (err) {
      errEl.style.color   = '';
      errEl.textContent   = err.message;
      errEl.classList.remove('hidden');
    }
  });

  // -- SIGN OUT --
  document.getElementById('btn-signout')?.addEventListener('click', async () => {
    await Auth.signOut();
  });

  // -- NAVIGATION --
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) UI.navigate(view);
    });
  });

  // -- HABIT MODAL --
  document.getElementById('btn-add-habit')?.addEventListener('click', () => UI.openHabitModal());
  document.getElementById('btn-habit-cancel')?.addEventListener('click', UI.closeHabitModal);

  document.querySelectorAll('.stake-opt[data-stake]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.stake-opt[data-stake]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('stake-description').textContent = CONFIG.stakeDescriptions[btn.dataset.stake] ?? '';
    });
  });

  document.getElementById('btn-habit-save')?.addEventListener('click', async () => {
    const id    = document.getElementById('habit-id-field').value;
    const name  = document.getElementById('habit-name-field').value.trim();
    const stake = document.querySelector('.stake-opt[data-stake].selected')?.dataset.stake ?? 'crit';

    if (!name) { showToast('Habit name required.', 'error'); return; }

    try {
      await Data.saveHabit({ id: id || undefined, name, stake });
      UI.closeHabitModal();
      UI.renderHabitsTable();
      UI.renderTodayHabits();
      showToast('Habit saved.', 'success');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });

  // -- GOAL MODAL --
  document.getElementById('btn-add-goal')?.addEventListener('click', () => UI.openGoalModal());
  document.getElementById('btn-go-goals')?.addEventListener('click', () => UI.navigate('goals'));
  document.getElementById('btn-goal-cancel')?.addEventListener('click', UI.closeGoalModal);

  document.querySelectorAll('.stake-opt[data-goal-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.stake-opt[data-goal-type]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  document.getElementById('goal-progress-field')?.addEventListener('input', (e) => {
    document.getElementById('goal-progress-display').textContent = e.target.value;
  });

  document.getElementById('btn-goal-save')?.addEventListener('click', async () => {
    const id       = document.getElementById('goal-id-field').value;
    const title    = document.getElementById('goal-title-field').value.trim();
    const type     = document.querySelector('.stake-opt[data-goal-type].selected')?.dataset.goalType ?? 'weekly';
    const deadline = document.getElementById('goal-deadline-field').value;
    const progress = parseInt(document.getElementById('goal-progress-field').value, 10);

    if (!title)    { showToast('Goal title required.', 'error');    return; }
    if (!deadline) { showToast('Deadline required.', 'error'); return; }

    try {
      await Data.saveGoal({ id: id || undefined, title, type, deadline, progress });
      UI.closeGoalModal();
      UI.renderGoals();
      UI.renderDashboardGoals();
      showToast('Goal saved.', 'success');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });

  // -- BREACH MODAL --
  document.getElementById('btn-breach-acknowledge')?.addEventListener('click', async () => {
    const note = document.getElementById('breach-note').value.trim();
    if (!note) { showToast('Root cause analysis required before acknowledging.', 'error'); return; }

    try {
      await Data.logBreachNote(STATE.ui.breachedHabits.map(h => h.id), note);
      UI.closeBreachModal();
      showToast('System Breach logged.', 'default');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });

  // -- AI ADVISOR --
  document.getElementById('btn-daily-briefing')?.addEventListener('click', async () => {
    UI.navigate('advisor');
    await runAdvisorQuery('daily');
  });

  document.getElementById('btn-daily-briefing-full')?.addEventListener('click', () => runAdvisorQuery('daily'));
  document.getElementById('btn-weekly-diagnostic')?.addEventListener('click',  () => runAdvisorQuery('weekly'));
  document.getElementById('btn-monthly-audit')?.addEventListener('click',     () => runAdvisorQuery('monthly'));

  // -- SETTINGS --
  document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
    const key = document.getElementById('settings-groq-key').value.trim();
    try {
      await Data.saveSettings({ groqApiKey: key });
      showToast('Settings saved.', 'success');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });

  document.getElementById('btn-clear-logs')?.addEventListener('click', () => {
    UI.confirmAction(
      'CLEAR ALL LOGS',
      'ALL historical log data will be permanently deleted. This cannot be undone.',
      async () => {
        await Data.clearAllLogs();
        await loadAllData();
        UI.renderDashboard();
        showToast('All logs cleared.', 'default');
      }
    );
  });

  // -- CONFIRM MODAL CANCEL --
  document.getElementById('btn-confirm-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-confirm').classList.add('hidden');
  });

  // -- MONTHLY AUDIT CLOSE --
  document.getElementById('btn-audit-close')?.addEventListener('click', () => {
    const c1 = document.getElementById('commit-1').value.trim();
    const c2 = document.getElementById('commit-2').value.trim();
    const c3 = document.getElementById('commit-3').value.trim();
    if (!c1 || !c2 || !c3) {
      showToast('All 3 commitments required before closing the audit.', 'error');
      return;
    }
    document.getElementById('modal-monthly-audit').classList.add('hidden');
  });

  // -- CLOSE MODALS ON OVERLAY CLICK (non-mandatory only) --
  document.getElementById('modal-habit')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) UI.closeHabitModal();
  });
  document.getElementById('modal-goal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) UI.closeGoalModal();
  });
  document.getElementById('modal-confirm')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
  // Breach and Monthly Audit modals are NOT closeable via overlay click -- mandatory.
}

// ============================================================
// 12. ADVISOR QUERY RUNNER
// ============================================================
async function runAdvisorQuery(type) {
  if (!STATE.settings.groqApiKey) {
    showToast('GROQ API key not set. Go to Settings.', 'error');
    UI.navigate('settings');
    return;
  }

  UI.setAdvisorOutput('', true);

  try {
    let result = '';
    if (type === 'daily')   result = await AI.getDailyBriefing();
    if (type === 'weekly')  result = await AI.getWeeklyDiagnostic();
    if (type === 'monthly') {
      // Open mandatory modal instead
      await openMonthlyAuditModal();
      return;
    }
    UI.setAdvisorOutput(result);
  } catch (err) {
    UI.setAdvisorOutput(`ERROR: ${err.message}`);
    showToast(err.message, 'error');
  }
}

async function openMonthlyAuditModal() {
  const modal     = document.getElementById('modal-monthly-audit');
  const outputEl  = document.getElementById('audit-ai-output');
  const monthEl   = document.getElementById('audit-month-label');

  if (!modal || !outputEl) return;

  // Clear commitments
  ['commit-1','commit-2','commit-3'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const now = new Date();
  if (monthEl) {
    monthEl.textContent = now.toLocaleString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
  }

  outputEl.innerHTML = `
    <div class="loading-block">
      <div class="loading-spinner"></div>
      <span>Conducting monthly audit...</span>
    </div>`;

  modal.classList.remove('hidden');

  try {
    const result = await AI.getMonthlyAudit();
    outputEl.innerHTML = `<pre style="white-space:pre-wrap;font-family:var(--font-mono);font-size:0.8rem;color:var(--white);line-height:1.8;">${escapeHtml(result)}</pre>`;
  } catch (err) {
    outputEl.innerHTML = `<p style="color:var(--crimson);padding:1rem;">ERROR: ${escapeHtml(err.message)}</p>`;
  }
}

// ============================================================
// 13. DATA LOADER
// ============================================================
async function loadAllData() {
  await Promise.all([
    Data.fetchHabits(),
    Data.fetchTodayLogs(),
    Data.fetchGoals(),
    Data.fetchHistoricalLogs(60),
    Data.fetchSettings(),
  ]);
}

// ============================================================
// 14. INIT
// ============================================================
async function initApp(session) {
  STATE.user = session.user;
  setLoading(true);

  try {
    await loadAllData();
  } catch (err) {
    console.error('VANTAGE: Data load failed:', err);
    showToast('Data load error: ' + err.message, 'error');
  } finally {
    setLoading(false);
  }

  // Show app, hide auth
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  // Attach all handlers
  attachEventHandlers();

  // Initial render
  UI.navigate('dashboard');
  UI.renderDashboard();
  UI.renderSettings();
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
}

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  initSupabase();

  if (!DB) {
    document.body.innerHTML = `
      <div style="color:#e11d48;font-family:monospace;padding:4rem;text-align:center;">
        <h1>VANTAGE</h1>
        <p>SUPABASE CONFIGURATION MISSING. Set __VANTAGE_SUPABASE_URL__ and __VANTAGE_SUPABASE_ANON_KEY__.</p>
      </div>`;
    return;
  }

  // Listen for auth state
  Auth.onAuthStateChange((session) => {
    if (session) {
      initApp(session);
    } else {
      showAuthScreen();
    }
  });

  // Check existing session
  const session = await Auth.getSession();
  if (session) {
    initApp(session);
  } else {
    showAuthScreen();
    // Auth form needs handlers even before app init
    const authForm = document.getElementById('auth-form');
    if (authForm) {
      authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email    = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        const loader   = document.querySelector('.btn-loader');
        const btnText  = document.querySelector('.btn-text');
        const errEl    = document.getElementById('auth-error');

        errEl.classList.add('hidden');
        if (loader) loader.classList.remove('hidden');
        if (btnText) btnText.classList.add('hidden');

        try {
          await Auth.signIn(email, password);
        } catch (err) {
          errEl.textContent = err.message;
          errEl.classList.remove('hidden');
          if (loader) loader.classList.add('hidden');
          if (btnText) btnText.classList.remove('hidden');
        }
      });

      document.getElementById('btn-signup')?.addEventListener('click', async () => {
        const email    = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        const errEl    = document.getElementById('auth-error');
        errEl.style.color = '';
        errEl.classList.add('hidden');

        if (!email || !password) {
          errEl.textContent = 'Email and password required.';
          errEl.classList.remove('hidden');
          return;
        }

        try {
          await Auth.signUp(email, password);
          errEl.style.color = '#16a34a';
          errEl.textContent = 'Account created. Check your email, then sign in.';
          errEl.classList.remove('hidden');
        } catch (err) {
          errEl.textContent = err.message;
          errEl.classList.remove('hidden');
        }
      });
    }
  }
});
