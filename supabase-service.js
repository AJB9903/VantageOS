// ─── SUPABASE SERVICE ─────────────────────────────────────────────────────────
const SUPA_URL = 'https://eqzcdcdnddjufuwmwbml.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxemNkY2RuZGRqdWZ1d213Ym1sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyOTM1NzEsImV4cCI6MjA4OTg2OTU3MX0.cGBJxtuReOrU7_jz6Na-zhgR92nGIYJVgno22vqjqDA';
const sb = supabase.createClient(SUPA_URL, SUPA_KEY);

async function loadUserSettings() {
  const { data } = await sb.from('user_settings').select('*').eq('user_id', currentUser.id).single();
  if (!data) return;

  if (data.habits && Array.isArray(data.habits) && data.habits.length > 0) S.habits = data.habits;
  if (data.goals) {
    try { S.goals = typeof data.goals === 'string' ? JSON.parse(data.goals) : data.goals; if (!Array.isArray(S.goals)) S.goals = []; }
    catch(e) { S.goals = []; }
  } else { S.goals = []; }

  if (data.meta) {
    const meta = typeof data.meta === 'string' ? JSON.parse(data.meta) : data.meta;
    S.lastWeeklyReview       = meta.lastWeeklyReview       || null;
    S.lastMonthlyRecap       = meta.lastMonthlyRecap       || null;
    S.lastWeekDelta          = meta.lastWeekDelta          || '';
    S.weeklyRecaps           = meta.weeklyRecaps           || {};
    S.monthlyAudits          = meta.monthlyAudits          || {};
    S.dailyFrictionQuestion  = meta.dailyFrictionQuestion  || '';
    S.monthDelta             = meta.monthDelta             || '';
    S.weeklyNonNeg           = meta.weeklyNonNeg           || [];
    S.weeklyNonNegStatus     = meta.weeklyNonNegStatus     || {};
    S.weeklyNonNegBonusGiven = meta.weeklyNonNegBonusGiven || {};
    S.groqKey                = meta.groqKey                || localStorage.getItem('groq_key') || '';
    const savedStakes = meta.habitStakes || {};
    S.habitStakes = Object.keys(savedStakes).length > 0 ? savedStakes : { ...DEFAULT_HABIT_STAKES };
  } else {
    S.habitStakes = { ...DEFAULT_HABIT_STAKES };
  }
}

async function saveUserSettings() {
  const meta = {
    lastWeeklyReview:       S.lastWeeklyReview       || null,
    lastMonthlyRecap:       S.lastMonthlyRecap        || null,
    lastWeekDelta:          S.lastWeekDelta           || '',
    weeklyRecaps:           S.weeklyRecaps            || {},
    monthlyAudits:          S.monthlyAudits           || {},
    dailyFrictionQuestion:  S.dailyFrictionQuestion   || '',
    monthDelta:             S.monthDelta              || '',
    habitStakes:            S.habitStakes             || {},
    weeklyNonNeg:           S.weeklyNonNeg            || [],
    weeklyNonNegStatus:     S.weeklyNonNegStatus      || {},
    weeklyNonNegBonusGiven: S.weeklyNonNegBonusGiven  || {},
    groqKey:                S.groqKey                 || '',
  };
  await sb.from('user_settings').upsert({
    user_id: currentUser.id,
    habits: S.habits,
    goals: Array.isArray(S.goals) ? S.goals : [],
    meta,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
}

async function loadMonthLogs() {
  const from = dateKey(1, S.month, S.year);
  const to   = dateKey(daysInMonth(S.month, S.year), S.month, S.year);
  const { data } = await sb.from('logs').select('*').eq('user_id', currentUser.id).gte('date', from).lte('date', to);
  S.days = {};
  if (data) data.forEach(row => {
    S.days[row.date] = {
      habits: row.habits || {}, mood: row.mood || 7,
      weight: row.weight, cals: row.calories, protein: row.protein,
      sleep: row.sleep, win: row.win || '', log: row.log_text || ''
    };
  });
}

async function saveDayToDB(dk, dayData) {
  await sb.from('logs').upsert({
    user_id: currentUser.id, date: dk,
    mood: dayData.mood, weight: dayData.weight,
    calories: dayData.cals, protein: dayData.protein,
    sleep: dayData.sleep, win: dayData.win,
    log_text: dayData.log, habits: dayData.habits,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,date' });
}
