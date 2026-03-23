# VANTAGE 2.0 -- STRATEGIC EXECUTION ENGINE

> Brutally honest accountability. No economy. No fluff. Just execution data.

---

## STACK

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Frontend    | Vanilla HTML / CSS / JS (ES Modules)|
| Auth + DB   | Supabase (Postgres + Auth)          |
| AI Advisor  | Groq API (llama3-70b-8192)          |
| Charts      | Chart.js 4                          |
| Fonts       | Syne (headings), Space Mono (data)  |

---

## FILE STRUCTURE

```
vantage/
  index.html    Entry point. Sidebar-to-bottom-nav shell.
  styles.css    Industrial-chic. Crimson on Black. No compromises.
  app.js        State, data layer, scoring engine, AI, charts, UI.
  README.md     This file.
```

---

## SUPABASE SETUP

### 1. Create Project

Go to [supabase.com](https://supabase.com) and create a new project.
Note your **Project URL** and **anon public key** from Settings > API.

---

### 2. SQL SCHEMA

Run this entire block in the Supabase SQL Editor.

```sql
-- ============================================================
-- VANTAGE 2.0 -- DATABASE SCHEMA
-- ============================================================

-- HABITS
-- Active habits for a user. Soft-deleted via active=false.
create table public.habits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  stake       text not null check (stake in ('low', 'med', 'high', 'crit')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

-- Index for fast user lookups
create index habits_user_id_idx on public.habits(user_id);
create index habits_user_active_idx on public.habits(user_id, active);


-- LOGS
-- One row per habit per day. completed=true means the habit was done.
-- note captures root cause analysis, especially for System Breach events.
create table public.logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  habit_id    uuid not null references public.habits(id) on delete cascade,
  date        date not null,
  completed   boolean not null default false,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,

  -- Enforce one log entry per habit per day per user
  unique (user_id, habit_id, date)
);

create index logs_user_date_idx on public.logs(user_id, date);
create index logs_user_habit_idx on public.logs(user_id, habit_id);
create index logs_habit_date_idx on public.logs(habit_id, date);


-- GOALS
-- Weekly and monthly goals with progress tracking.
create table public.goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  type        text not null check (type in ('weekly', 'monthly')),
  progress    integer not null default 0 check (progress between 0 and 10),
  target      integer not null default 10,
  deadline    date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create index goals_user_id_idx on public.goals(user_id);
create index goals_user_type_idx on public.goals(user_id, type);


-- USER_SETTINGS
-- One row per user. Stores operator configuration.
create table public.user_settings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references auth.users(id) on delete cascade,
  groq_api_key text,           -- User-provided. Stored in DB for cross-device sync.
                               -- Consider encrypting at rest if your threat model requires it.
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

create index user_settings_user_id_idx on public.user_settings(user_id);
```

---

### 3. ROW LEVEL SECURITY (RLS) POLICIES

RLS ensures every user sees ONLY their own data. This is non-negotiable.
Run this block immediately after the schema block above.

```sql
-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================
alter table public.habits       enable row level security;
alter table public.logs         enable row level security;
alter table public.goals        enable row level security;
alter table public.user_settings enable row level security;


-- ============================================================
-- HABITS POLICIES
-- ============================================================
create policy "habits: users can select their own"
  on public.habits for select
  using (auth.uid() = user_id);

create policy "habits: users can insert their own"
  on public.habits for insert
  with check (auth.uid() = user_id);

create policy "habits: users can update their own"
  on public.habits for update
  using (auth.uid() = user_id);

-- Hard delete not allowed (soft delete via active=false)
-- Uncomment if you want to allow hard deletes:
-- create policy "habits: users can delete their own"
--   on public.habits for delete
--   using (auth.uid() = user_id);


-- ============================================================
-- LOGS POLICIES
-- ============================================================
create policy "logs: users can select their own"
  on public.logs for select
  using (auth.uid() = user_id);

create policy "logs: users can insert their own"
  on public.logs for insert
  with check (auth.uid() = user_id);

create policy "logs: users can update their own"
  on public.logs for update
  using (auth.uid() = user_id);

create policy "logs: users can delete their own"
  on public.logs for delete
  using (auth.uid() = user_id);


-- ============================================================
-- GOALS POLICIES
-- ============================================================
create policy "goals: users can select their own"
  on public.goals for select
  using (auth.uid() = user_id);

create policy "goals: users can insert their own"
  on public.goals for insert
  with check (auth.uid() = user_id);

create policy "goals: users can update their own"
  on public.goals for update
  using (auth.uid() = user_id);

create policy "goals: users can delete their own"
  on public.goals for delete
  using (auth.uid() = user_id);


-- ============================================================
-- USER_SETTINGS POLICIES
-- ============================================================
create policy "settings: users can select their own"
  on public.user_settings for select
  using (auth.uid() = user_id);

create policy "settings: users can insert their own"
  on public.user_settings for insert
  with check (auth.uid() = user_id);

create policy "settings: users can update their own"
  on public.user_settings for update
  using (auth.uid() = user_id);
```

---

### 4. INJECT CREDENTIALS

Open `index.html` and add this block before the `</body>` tag,
above the `<script src="app.js">` line:

```html
<script>
  // Injected by build tool or server. Never commit real keys.
  window.__VANTAGE_SUPABASE_URL__      = 'https://your-project.supabase.co';
  window.__VANTAGE_SUPABASE_ANON_KEY__ = 'your-anon-key-here';
</script>
```

In a production pipeline (Vite, Webpack, Netlify, Vercel):
- Use environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Never expose the `service_role` key on the frontend. Ever.

---

### 5. GROQ API KEY

1. Create an account at [console.groq.com](https://console.groq.com)
2. Generate an API key
3. In the VANTAGE app, go to Settings and paste the key
4. The key is stored in `user_settings.groq_api_key` and synced across devices
5. All Groq calls are made directly from the browser (client-side)

> Security note: If you need server-side key storage, proxy the Groq calls
> through a Supabase Edge Function instead of calling Groq directly from the client.

---

## SCORING LOGIC

### Daily Execution Score (0-100%)

```
Total Weight  = SUM of stake weights for all active habits
Done Weight   = SUM of stake weights for completed habits
Score         = (Done Weight / Total Weight) * 100
```

### Stake Weights

| Stake | Weight | Behavior                              |
|-------|--------|---------------------------------------|
| LOW   | x1     | Supportive routine                    |
| MED   | x2     | Meaningful but not mission-critical   |
| HIGH  | x3     | Core to weekly performance            |
| CRIT  | x5     | Missing triggers System Breach        |

### System Breach

A System Breach is triggered when any CRIT habit is marked `completed = false`
for the current day. The breach:

1. Shows a persistent red banner across the top of the app
2. Blocks continuation via a non-dismissible modal requiring root cause analysis
3. Forces the AI advisor to flag it as primary strategic risk in all briefings
4. Increments the monthly breach counter in the KPI grid

---

## AI ADVISOR PROMPTS

All prompts share a base system instruction:

> "You are VANTAGE, a brutally honest strategic execution advisor.
> You identify gaps, failures, and opportunity costs without softening reality.
> Do not use em dashes. Do not use filler affirmations. Be specific."

### Daily Briefing
Triggered on demand. Covers today's score, open CRIT failures,
and single highest-priority execution target.

### Weekly Diagnostic
Reviews last 7 days of scores, identifies systemic failure patterns,
and outputs 3 concrete behavioral changes.

### Monthly Trajectory Audit (MANDATORY MODAL)
Triggered at month-end. Non-closeable until operator submits
3 written next-cycle commitments. Covers:

- Trajectory verdict (improving / degrading / stagnant)
- Root failures (2-3 systemic issues)
- System breach total and compounding cost
- Goal alignment gap analysis
- Next-cycle mandate (binary, measurable)

---

## CHART LOGIC

### Ghost Chart (Line)
- X-axis: Day of month (1-31)
- Line 1: Current month daily scores (crimson)
- Line 2: Last month daily scores (dark grey, dashed -- the "ghost")
- Scores are computed from historical logs using the current habit configuration
- Current month is truncated at today's date (no future projection)

### Drift Chart (Bar)
- X-axis: Last 14 calendar days
- Bar 1: Intent (100% for any day with log activity, 0 for no data)
- Bar 2: Actual execution score
- Bar color: Green (>=80%), Yellow (>=50%), Crimson (<50%)
- Gap between bars = Drift = the cost of rationalization

---

## DEPLOYMENT

### Netlify / Vercel (Recommended)

1. Push to GitHub
2. Connect repo to Netlify/Vercel
3. Set environment variables in the dashboard:
   - `VANTAGE_SUPABASE_URL`
   - `VANTAGE_SUPABASE_ANON_KEY`
4. Add a build step that injects them into the HTML (or use a framework)

### Static (No Build Tool)

Edit `index.html` directly to inject the credentials as shown in Step 4 above.
Do not commit those values to version control.

---

## SUPABASE AUTH CONFIGURATION

In your Supabase project dashboard:

1. Authentication > Settings > Enable Email Auth
2. Set Site URL to your deployed domain
3. Add your domain to Redirect URLs
4. (Optional) Disable email confirmation for local development:
   Authentication > Settings > Toggle "Enable email confirmations" off

---

## KNOWN ARCHITECTURAL DECISIONS

**Why no module bundler?**
VANTAGE 2.0 is deliberately zero-dependency on the build side.
It runs as plain HTML/CSS/JS. Add Vite or esbuild if you need tree-shaking
or TypeScript. The architecture supports it without major refactoring.

**Why store Groq key in Supabase?**
Cross-device sync without a backend service layer. The key is protected
by RLS -- only the authenticated user can read their own row.
If your threat model requires tighter key handling, move Groq calls to a
Supabase Edge Function and never expose the key to the client.

**Why soft-delete habits?**
Historical logs reference habit IDs. Hard-deleting a habit would corrupt
the score history for past days. Soft-delete via `active=false` preserves
the referential integrity of the audit trail.

---

## PERFORMANCE NOTES

- Historical logs are fetched once (last 60 days) and held in `STATE.historicalLogs`
- Score calculations are synchronous and run in-memory -- no extra DB calls
- Charts are destroyed and re-created on each analytics view to avoid canvas conflicts
- All DB calls include `.maybeSingle()` or null-safe fallbacks to prevent 406 errors

---

*VANTAGE 2.0. Every line serves the goal of strategic accountability.*
