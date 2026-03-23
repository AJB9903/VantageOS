'use strict';

const MAX_HABITS = 3;
const STRIPE_LINK = 'https://buy.stripe.com/test_yourlinkhere'; // REPLACE THIS

const STATE = {
  habits: JSON.parse(localStorage.getItem('vantage_habits')) || [],
  logs: JSON.parse(localStorage.getItem('vantage_logs')) || {},
  ui: { activeView: 'dashboard' }
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function saveState() {
  localStorage.setItem('vantage_habits', JSON.stringify(STATE.habits));
  localStorage.setItem('vantage_logs', JSON.stringify(STATE.logs));
}

function calculateScore() {
  if (!STATE.habits.length) return 0;
  const today = todayISO();
  const todayLogs = STATE.logs[today] || [];
  let doneCount = 0;
  
  STATE.habits.forEach(h => {
    if (todayLogs.includes(h.id)) doneCount++;
  });
  
  return Math.round((doneCount / STATE.habits.length) * 100);
}

const UI = {
  navigate(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${view}`).classList.remove('hidden');
    document.querySelectorAll('[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    if (view === 'dashboard') UI.renderDashboard();
    if (view === 'habits') UI.renderHabits();
  },

  renderDashboard() {
    document.getElementById('dashboard-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
    
    const score = calculateScore();
    document.getElementById('kpi-score-today').textContent = `${score}%`;
    document.getElementById('sidebar-score-val').textContent = `${score}%`;
    
    const container = document.getElementById('today-habits-list');
    if (!STATE.habits.length) {
      container.innerHTML = `<div class="empty-state"><p>No habits configured.</p></div>`;
      return;
    }

    const today = todayISO();
    const todayLogs = STATE.logs[today] || [];
    
    container.innerHTML = STATE.habits.map(h => {
      const isDone = todayLogs.includes(h.id);
      return `
        <div class="habit-check-item ${isDone ? 'done' : ''}" data-id="${h.id}">
          <div class="habit-checkbox">
            <svg viewBox="0 0 12 12" fill="none" stroke="white" stroke-width="2"><polyline points="1,6 4,10 11,2"/></svg>
          </div>
          <span class="habit-check-name">${h.name}</span>
        </div>`;
    }).join('');

    document.querySelectorAll('.habit-check-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (!STATE.logs[today]) STATE.logs[today] = [];
        if (STATE.logs[today].includes(id)) {
          STATE.logs[today] = STATE.logs[today].filter(x => x !== id);
        } else {
          STATE.logs[today].push(id);
        }
        saveState();
        UI.renderDashboard();
      });
    });
  },

  renderHabits() {
    const tbody = document.getElementById('habits-tbody');
    if (!STATE.habits.length) {
      tbody.innerHTML = `<tr><td colspan="2"><div class="empty-state">No habits.</div></td></tr>`;
      return;
    }
    
    tbody.innerHTML = STATE.habits.map(h => `
      <tr>
        <td>${h.name}</td>
        <td><button class="btn-icon danger btn-delete-habit" data-id="${h.id}">DELETE</button></td>
      </tr>
    `).join('');

    document.querySelectorAll('.btn-delete-habit').forEach(btn => {
      btn.addEventListener('click', () => {
        STATE.habits = STATE.habits.filter(x => x.id !== btn.dataset.id);
        saveState();
        UI.renderHabits();
      });
    });
  },
  
  openPaywall() { document.getElementById('modal-paywall').classList.remove('hidden'); },
  closePaywall() { document.getElementById('modal-paywall').classList.add('hidden'); },
  
  openHabitModal() { 
    document.getElementById('habit-name-field').value = '';
    document.getElementById('modal-habit').classList.remove('hidden'); 
  },
  closeHabitModal() { document.getElementById('modal-habit').classList.add('hidden'); }
};

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => UI.navigate(btn.dataset.view));
  });

  document.getElementById('btn-add-habit').addEventListener('click', () => {
    if (STATE.habits.length >= MAX_HABITS) {
      UI.openPaywall();
    } else {
      UI.openHabitModal();
    }
  });

  document.getElementById('btn-habit-save').addEventListener('click', () => {
    const name = document.getElementById('habit-name-field').value.trim();
    if (!name) return;
    STATE.habits.push({ id: crypto.randomUUID(), name });
    saveState();
    UI.closeHabitModal();
    UI.renderHabits();
    UI.renderDashboard();
  });

  document.getElementById('btn-habit-cancel').addEventListener('click', UI.closeHabitModal);
  document.getElementById('btn-paywall-close').addEventListener('click', UI.closePaywall);
  
  document.getElementById('btn-upgrade-stripe').addEventListener('click', () => {
    window.location.href = STRIPE_LINK;
  });

  document.getElementById('btn-clear-logs').addEventListener('click', () => {
    localStorage.clear();
    location.reload();
  });

  UI.renderDashboard();
});
