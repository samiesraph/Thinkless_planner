/**
 * THINKLESS PLANNER
 * app.js — Full logic: scheduling, focus mode, Pomodoro, procrastination detection,
 *           momentum tracking, timeline, insights, Start-Now, deadline risk warning.
 */

'use strict';

// ──── SVG GRADIENT INJECT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const svgns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(svgns, 'defs');
    const grad = document.createElementNS(svgns, 'linearGradient');
    grad.setAttribute('id', 'pomodoroGrad');
    grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
    grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '100%');
    const s1 = document.createElementNS(svgns, 'stop');
    s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', '#6c63ff');
    const s2 = document.createElementNS(svgns, 'stop');
    s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', '#9f7aea');
    grad.appendChild(s1); grad.appendChild(s2);
    defs.appendChild(grad);
    const svgEl = document.getElementById('pomodoroRing')?.closest('svg');
    if (svgEl) svgEl.insertBefore(defs, svgEl.firstChild);
});

// ──── DATA LAYER (LocalStorage) ───────────────────────────────────────────────
const LS = {
    get: key => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } },
    set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
};

const KEYS = {
    TASKS: 'sds_tasks',
    SLOTS: 'sds_slots',
    RTASKS: 'sds_rtasks',
    RSLOTS: 'sds_rslots',
    RSTATS: 'sds_rstats',  // per-template completion dates for streaks
    P_HISTORY: 'sds_delay_history',
    THEME: 'sds_theme'
};

let tasks = LS.get(KEYS.TASKS);
let slots = LS.get(KEYS.SLOTS);
let rtasks = LS.get(KEYS.RTASKS);
let rslots = LS.get(KEYS.RSLOTS);
let delayHistory = LS.get(KEYS.P_HISTORY);
/** rstats: { [templateId]: { completedDates: string[] } } */
let rstats = (() => { try { return JSON.parse(localStorage.getItem(KEYS.RSTATS)) || {}; } catch { return {}; } })();

// ──── THEME SWITCHER ──────────────────────────────────────────────────────────
function setTheme(color) {
    document.documentElement.setAttribute('data-theme', color);
    localStorage.setItem(KEYS.THEME, color);
}
let currentTheme = localStorage.getItem(KEYS.THEME) || 'blue';
setTheme(currentTheme);
let startNowTaskId = null;

// Day-of-week map: value matches JS Date.getDay() (0=Sun)
const DAYS_MAP = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };

// ──── UTILITIES ───────────────────────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmt = d => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = t => {
    const [h, m] = t.split(':');
    const ampm = +h >= 12 ? 'PM' : 'AM';
    return `${+h % 12 || 12}:${m} ${ampm}`;
};

function hoursUntilDeadline(deadline) {
    return (new Date(deadline) - Date.now()) / 36e5;
}

function slotDurationMins(slot) {
    const [sh, sm] = slot.startTime.split(':').map(Number);
    const [eh, em] = slot.endTime.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
}

function energyMatch(taskEnergy, slotEnergy) {
    const lvl = { Low: 1, Medium: 2, High: 3 };
    return lvl[slotEnergy] >= lvl[taskEnergy];
}

// ──── CALCULATE PRIORITY ──────────────────────────────────────────────────────
/**
 * calculatePriority(task)
 * Returns a numeric score: higher = more urgent.
 * Factors: importance level + deadline proximity.
 */
function calculatePriority(task) {
    const importanceScore = { High: 300, Medium: 150, Low: 60 }[task.importance] || 60;
    const hoursLeft = hoursUntilDeadline(task.deadline);
    let timeScore = 0;
    if (hoursLeft <= 0) timeScore = 1000;       // overdue
    else if (hoursLeft <= 6) timeScore = 500;
    else if (hoursLeft <= 24) timeScore = 300;
    else if (hoursLeft <= 72) timeScore = 150;
    else if (hoursLeft <= 168) timeScore = 60;
    else timeScore = 10;
    return importanceScore + timeScore;
}

// ──── URGENCY LABEL ───────────────────────────────────────────────────────────
function urgencyClass(task) {
    const h = hoursUntilDeadline(task.deadline);
    if (h <= 0) return 'urgent-red';
    if (task.importance === 'High' && h <= 24) return 'urgent-red';
    if (h <= 24 || (task.importance === 'High' && h <= 72)) return 'urgent-yellow';
    if (h <= 72) return 'urgent-yellow';
    return 'urgent-green';
}

function urgencyTagHTML(task) {
    const uc = urgencyClass(task);
    const h = hoursUntilDeadline(task.deadline);

    // Fun priority/energy emojis mapping
    let emoji = '🌱';
    if (task.importance === 'High' || task.energyLevel === 'High') emoji = '🔥';
    else if (task.importance === 'Medium' || task.energyLevel === 'Medium') emoji = '⚡';

    if (uc === 'urgent-red') return `<span class="tag tag-red">${emoji} Very Urgent</span>`;
    if (uc === 'urgent-yellow') return `<span class="tag tag-yellow">${emoji} Moderate</span>`;
    return `<span class="tag tag-green">${emoji} ${h > 168 ? 'Low Urgency' : 'Upcoming'}</span>`;
}

// ──── DEADLINE BAR ────────────────────────────────────────────────────────────
function deadlineBar(task) {
    const total = new Date(task.deadline) - new Date(task.createdAt);
    const done = Date.now() - new Date(task.createdAt);
    const pct = Math.max(0, Math.min(100, (done / total) * 100));
    const uc = urgencyClass(task);
    const color = uc === 'urgent-red' ? '#ff4d6d' : uc === 'urgent-yellow' ? '#ffd166' : '#06d6a0';
    const h = hoursUntilDeadline(task.deadline);
    const label = h <= 0 ? 'OVERDUE' : h < 1 ? `${Math.round(h * 60)}m left` : h < 24 ? `${Math.round(h)}h left` : `${Math.floor(h / 24)}d left`;
    return `
    <div class="tc-deadline-bar-wrap">
      <label><span>Deadline</span><span>${label}</span></label>
      <div class="tc-deadline-bar">
        <div class="tc-deadline-fill" style="width:${pct}%;background:${color}"></div>
      </div>
    </div>`;
}

// ──── MOMENTUM STATUS ─────────────────────────────────────────────────────────
function momentumStatus(task) {
    if (task.status === 'completed') return { icon: '🔥', label: 'Strong Progress', cls: 'fill-green' };
    if (task.skipCount >= 3) return { icon: '❄', label: `Ignored (${task.skipCount} skips)`, cls: 'fill-red' };
    if (task.skipCount >= 1) return { icon: '⚡', label: 'Started / Delayed', cls: 'fill-accent' };
    return { icon: '⚡', label: 'Queued', cls: 'fill-accent' };
}

// ──── RENDER TASKS ────────────────────────────────────────────────────────────
/**
 * Shows ONLY one-time tasks in the task list.
 * Recurring task templates are displayed separately by renderRecurringTasks().
 * Both types are still counted in the header stats and momentum tracker.
 */
function renderTasks() {
    const el = document.getElementById('taskList');
    const active = tasks.filter(t => t.status !== 'completed');

    if (!active.length) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><p>No one-time tasks yet. Add one above!</p></div>`;
        return;
    }

    const sorted = [...active].sort((a, b) => calculatePriority(b) - calculatePriority(a));
    el.innerHTML = sorted.map(t => {
        const uc = urgencyClass(t);
        const proAlert = t.skipCount >= 3
            ? `<div class="procrastination-alert">⚠ Procrastination detected: You skipped this task ${t.skipCount} times.</div>`
            : '';
        return `
      <div class="task-card ${uc}" id="tc-${t.id}">
        <div class="tc-top">
          <div class="tc-name">${escHtml(t.name)}</div>
          <div class="tc-actions">
            <button class="tc-btn delay" onclick="startProcrastination('${t.id}', '${escHtml(t.name).replace(/'/g, "\\'")}')" title="Delay / Start Soon">Start Soon</button>
            <button class="tc-btn simulate" onclick="openRegretSimulator('${t.id}', '${escHtml(t.name).replace(/'/g, "\\'")}')" title="Simulate Future">🔮</button>
            <button class="tc-btn focus" onclick="openFocusMode('${t.id}')">🎯</button>
            <button class="tc-btn done" onclick="completeTask('${t.id}')">✓</button>
            <button class="tc-btn skip" onclick="skipTask('${t.id}')">⏭</button>
            <button class="tc-btn del" onclick="deleteTask('${t.id}')">✕</button>
          </div>
        </div>
        <div class="tc-meta">
          ${urgencyTagHTML(t)}
          <span class="tag tag-purple">${t.importance}</span>
          <span class="tag tag-gray">⚡ ${t.energy}</span>
          <span class="tag tag-teal">⏱ ${t.estTime}m</span>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:6px;">📅 ${fmt(t.deadline)}</div>
        ${deadlineBar(t)}
        ${proAlert}
      </div>`;
    }).join('');
}


// ──── RENDER FREE TIME ────────────────────────────────────────────────────────
function renderFreeTime() {
    const el = document.getElementById('freeTimeList');
    const upcoming = slots
        .filter(s => {
            const d = new Date(`${s.date}T${s.endTime}`);
            return d >= new Date();
        })
        .sort((a, b) => new Date(`${a.date}T${a.startTime}`) - new Date(`${b.date}T${b.startTime}`));

    if (!upcoming.length) {
        el.innerHTML = `<div class="empty-state" style="padding:28px 10px"><div class="empty-icon">🕐</div><p>No upcoming time slots.</p></div>`;
    } else {
        el.innerHTML = upcoming.map(s => {
            const dur = slotDurationMins(s);
            return `
        <div class="ft-card">
          <div class="ft-info">
            <div class="ft-date">📅 ${fmtDate(s.date)}</div>
            <div class="ft-time">${fmtTime(s.startTime)} – ${fmtTime(s.endTime)}</div>
            <div class="ft-duration">⏱ ${dur} min • ⚡ ${s.energy}</div>
          </div>
          <button class="ft-del" onclick="deleteSlot('${s.id}')">✕</button>
        </div>`;
        }).join('');
    }
}

// ──── SCHEDULE TASKS ─────────────────────────────────────────────────────────
/**
 * scheduleTasks()
 * For each upcoming free slot, find the highest-priority pending task
 * whose estimated time fits the slot and energy matches.
 */
function scheduleTasks() {
    const schedEl = document.getElementById('scheduleList');
    // Merge one-time tasks + expanded recurring tasks
    const pending = [
        ...tasks.filter(t => t.status !== 'completed'),
        ...expandRecurringTasks(),
    ];
    // Merge one-time slots + expanded recurring slots (deduplicate by id)
    const allSlots = [...slots, ...expandRecurringSlots()];
    const upcoming = allSlots
        .filter(s => new Date(`${s.date}T${s.endTime}`) >= new Date())
        .sort((a, b) => new Date(`${a.date}T${a.startTime}`) - new Date(`${b.date}T${b.startTime}`));

    if (!upcoming.length || !pending.length) {
        schedEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📆</div>
        <p>${!upcoming.length ? 'Add free time slots to see your schedule.' : 'Add tasks and let ThinkLess Planner organize your focus.'}</p>
      </div>`;
        renderTimeline();
        renderInsights();
        checkDeadlineRisk();
        renderMomentum();
        return;
    }

    const sortedTasks = [...pending].sort((a, b) => calculatePriority(b) - calculatePriority(a));
    const assigned = []; // { slot, task | null, isMicro }

    for (const slot of upcoming) {
        const dur = slotDurationMins(slot);
        const isMicro = dur <= 15;

        // Find best matching task
        const match = sortedTasks.find(t =>
            t.estTime <= dur && energyMatch(t.energy, slot.energy)
        );

        assigned.push({ slot, task: match || null, isMicro });
    }

    if (!assigned.length) {
        schedEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📆</div><p>No matching tasks for your time slots.</p></div>`;
    } else {
        schedEl.innerHTML = assigned.map(({ slot, task, isMicro }) => {
            if (!task) {
                return `
          <div class="no-task-slot">
            <span>🕐 ${fmtDate(slot.date)} ${fmtTime(slot.startTime)}</span>
            <span>No suitable task found for this slot</span>
          </div>`;
            }
            const dur = slotDurationMins(slot);
            const microLabel = isMicro ? `<span class="sc-micro-label">⚡ Micro Task</span>` : '';
            const recLabel = task.isRecurring ? `<span class="sc-rec-label">🔁 ${task.recurringDay}</span>` : '';
            const slotRecLabel = slot.isRecurring ? `<span class="sc-micro-label" style="color:var(--teal);border-color:rgba(0,201,167,0.2);background:rgba(0,201,167,0.08)">🔁 Recurring Slot</span>` : '';
            // For focus mode, use base task id for recurring (openFocusMode uses task list)
            const focusId = task.isRecurring ? task.recurringId : task.id;
            return `
        <div class="schedule-card ${isMicro ? 'micro' : ''}">
          <div class="sc-time-block">
            <span class="sc-date">${fmtDate(slot.date)}</span>
            <span class="sc-time">${fmtTime(slot.startTime)}</span>
            <span class="sc-duration">${dur} min ${slotRecLabel}</span>
          </div>
          <div class="sc-task-info">
            <div class="sc-task-name">${escHtml(task.name)}</div>
            <div class="sc-task-meta">
              ${urgencyTagHTML(task)}
              <span class="tag tag-purple">${task.importance}</span>
              <span class="tag tag-gray">⏱ ${task.estTime}m needed</span>
              ${microLabel}${recLabel}
            </div>
          </div>
          <div class="sc-action">
            <button class="btn-focus-now" onclick="openFocusMode('${focusId}')">🎯 Focus</button>
          </div>
        </div>`;
        }).join('');
    }

    renderTimeline();
    renderInsights();
    renderWeeklyTimetable();
    checkDeadlineRisk();
    renderMomentum();
    checkStartNow();
}

// ──── WEEKLY TIMETABLE ────────────────────────────────────────────────────────
function renderWeeklyTimetable() {
    const el = document.getElementById('weeklyTimetable');
    if (!el) return;

    const days = [];
    const baseDate = new Date();
    baseDate.setHours(0, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + i);
        days.push(d);
    }

    const allSlots = [...slots, ...expandRecurringSlots()];
    const pending = [
        ...tasks.filter(t => t.status !== 'completed'),
        ...expandRecurringTasks()
    ];
    const sortedTasks = [...pending].sort((a, b) => calculatePriority(b) - calculatePriority(a));

    const toLocalDateString = d => {
        const offset = d.getTimezoneOffset() * 60000;
        return new Date(d.getTime() - offset).toISOString().split('T')[0];
    };

    const assignedByDate = {};
    for (const d of days) {
        assignedByDate[toLocalDateString(d)] = [];
    }

    const unassignedTasks = [...sortedTasks];

    for (const slot of allSlots) {
        const slotDateStr = slot.date;
        if (!assignedByDate[slotDateStr]) continue;

        const dur = slotDurationMins(slot);
        const matchIdx = unassignedTasks.findIndex(t => t.estTime <= dur && energyMatch(t.energy, slot.energy));
        let matchTask = null;
        if (matchIdx !== -1) {
            matchTask = unassignedTasks.splice(matchIdx, 1)[0];
        }

        assignedByDate[slotDateStr].push({ slot, task: matchTask });
    }

    let html = '<div class="wt-scroll-wrap">';
    html += '<div class="wt-ruler"><div class="wt-ruler-inner" style="height:1440px;">';
    for (let h = 0; h < 24; h++) {
        const ampm = h >= 12 ? 'pm' : 'am';
        const displayH = h % 12 === 0 ? 12 : h % 12;
        html += `<div class="wt-hour-label" style="top:${h * 60}px">${displayH}${ampm}</div>`;
    }
    html += '</div></div>';

    html += '<div class="wt-grid">';

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayStr = toLocalDateString(baseDate);

    for (const d of days) {
        const dateStr = toLocalDateString(d);
        const daySlots = assignedByDate[dateStr] || [];
        daySlots.sort((a, b) => a.slot.startTime.localeCompare(b.slot.startTime));

        const isToday = dateStr === todayStr;
        const todayClass = isToday ? ' wt-today' : '';

        html += `<div class="wt-day-col${todayClass}">
            <div class="wt-day-header">
                <div class="wt-day-name">${dayNames[d.getDay()]}</div>
                <div class="wt-day-date">${d.getDate()} ${d.toLocaleString('default', { month: 'short' })}</div>
            </div>
            <div class="wt-col-body" style="height:1440px;">`;

        for (let h = 0; h < 24; h++) {
            html += `<div class="wt-gridline" style="top:${h * 60}px"></div>`;
            html += `<div class="wt-gridline-half" style="top:${h * 60 + 30}px"></div>`;
        }

        for (const item of daySlots) {
            const [sh, sm] = item.slot.startTime.split(':').map(Number);
            const [eh, em] = item.slot.endTime.split(':').map(Number);
            const startMins = sh * 60 + sm;
            const endMins = eh * 60 + em;
            const dur = endMins - startMins;

            if (item.task) {
                let bg = '', bColor = '';
                if (item.task.energy === 'High') { bg = 'rgba(255,77,109,0.2)'; bColor = 'var(--urgent-red)'; }
                else if (item.task.energy === 'Medium') { bg = 'rgba(255,176,85,0.2)'; bColor = 'var(--yellow)'; }
                else { bg = 'rgba(6,214,160,0.2)'; bColor = 'var(--teal)'; }

                const tooltip = `🎯 Task: ${escHtml(item.task.name)}\n⏱ ${item.slot.startTime}-${item.slot.endTime}\n⚡ Energy: ${item.task.energy}`;
                html += `
                <div class="wt-block task interactive" style="top:${startMins}px; height:${dur}px; background:${bg}; border-left:3px solid ${bColor}">
                    <span class="wt-block-label">${escHtml(item.task.name)}</span>
                    <span class="wt-block-time">${item.slot.startTime}</span>
                    <div class="wt-tooltip" style="text-align:left">${tooltip.replace(/\n/g, '<br>')}</div>
                </div>`;
            } else {
                const tooltip = `🕑 Free Time\n⏱ ${item.slot.startTime}-${item.slot.endTime}\n🔋 Ideal Energy: ${item.slot.energy}`;
                html += `
                <div class="wt-block free interactive" style="top:${startMins}px; height:${dur}px;">
                    <span class="wt-block-label">Free Time</span>
                    <span class="wt-block-time">${item.slot.startTime}</span>
                    <div class="wt-tooltip" style="text-align:left">${tooltip.replace(/\n/g, '<br>')}</div>
                </div>`;
            }
        }

        if (isToday) {
            const now = new Date();
            const nowMins = now.getHours() * 60 + now.getMinutes();
            html += `<div class="wt-now-line" style="top:${nowMins}px"></div>`;
        }

        html += `</div></div>`;
    }

    html += `</div></div>`;
    el.innerHTML = html;

    setTimeout(() => {
        const wrap = el.querySelector('.wt-scroll-wrap');
        if (wrap) {
            const currentHour = new Date().getHours();
            wrap.scrollTop = Math.max(0, (currentHour - 1) * 60);
        }
    }, 50);
}

// ──── DEADLINE RISK WARNING ───────────────────────────────────────────────────
function checkDeadlineRisk() {
    const el = document.getElementById('riskWarning');
    const pending = tasks.filter(t => t.status !== 'completed');
    const totalTaskTime = pending.reduce((s, t) => s + t.estTime, 0);
    // Include recurring slot time in available time
    const allSlots = [...slots, ...expandRecurringSlots()];
    const allSlotTime = allSlots
        .filter(s => new Date(`${s.date}T${s.endTime}`) >= new Date())
        .reduce((s, sl) => s + slotDurationMins(sl), 0);

    if (totalTaskTime > allSlotTime && pending.length > 0) {
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

// ──── TIMELINE ────────────────────────────────────────────────────────────────
function renderTimeline() {
    const el = document.getElementById('timeline');
    // Include next occurrence of each recurring task template
    const recurringNext = [];
    for (const rt of rtasks) {
        const expanded = expandRecurringTasks().filter(t => t.recurringId === rt.id);
        if (expanded.length) {
            // push only the soonest occurrence
            expanded.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
            recurringNext.push(expanded[0]);
        }
    }
    const pending = [
        ...tasks.filter(t => t.status !== 'completed'),
        ...recurringNext,
    ];
    if (!pending.length) {
        el.innerHTML = `<div style="color:var(--text3);font-size:13px;padding:12px 0">No upcoming deadlines.</div>`;
        return;
    }

    const sorted = [...pending].sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

    el.innerHTML = sorted.map(t => {
        const h = hoursUntilDeadline(t.deadline);
        const uc = urgencyClass(t);
        const dotColor = uc === 'urgent-red' ? '#ff4d6d' : uc === 'urgent-yellow' ? '#ffd166' : '#06d6a0';

        let when;
        if (h <= 0) when = '⚠ OVERDUE';
        else if (h < 24) when = `Today (${Math.round(h)}h left)`;
        else if (h < 48) when = 'Tomorrow';
        else when = `In ${Math.floor(h / 24)} days`;

        const recBadge = t.isRecurring ? ` <span style="font-size:10px;color:#a89bff">(🔁 ${t.recurringDay})</span>` : '';
        return `
      <div class="timeline-item">
        <div class="timeline-dot" style="background:${dotColor}"></div>
        <div class="timeline-when">${when}</div>
        <div class="timeline-task">${escHtml(t.name)}${recBadge}</div>
        <div class="timeline-meta">📅 ${fmt(t.deadline)} • ⏱ ${t.estTime}m • ${t.importance} Priority</div>
      </div>`;
    }).join('');
}

// ──── MARK RECURRING DONE TODAY ───────────────────────────────────────────────
/**
 * Records today's date as a completion for a recurring task template.
 * This is separate from "complete template" — it logs per-day habits.
 */
function markRecurringDone(id) {
    const today = new Date().toISOString().slice(0, 10);
    if (!rstats[id]) rstats[id] = { completedDates: [] };
    if (!rstats[id].completedDates.includes(today)) {
        rstats[id].completedDates.push(today);
        localStorage.setItem(KEYS.RSTATS, JSON.stringify(rstats));
    }
    refresh();
    flashSuccess('recurringTaskList', '✔ Marked done!');
}

// ──── COMPUTE STREAK ──────────────────────────────────────────────────────────
/**
 * Returns { current, longest } streak of consecutive scheduled days completed.
 */
function computeStreak(rt) {
    const stats = rstats[rt.id] || { completedDates: [] };
    const completedSet = new Set(stats.completedDates);
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // Collect scheduled dates in reverse (most recent first), up to 60 days back
    const scheduledDates = [];
    for (let i = 0; i <= 60; i++) {
        const d = new Date(today); d.setDate(today.getDate() - i);
        if (rt.days.includes(DAY_NAMES[d.getDay()]))
            scheduledDates.push({ dateStr: d.toISOString().slice(0, 10), isToday: i === 0 });
    }

    let current = 0, longest = 0, running = 0, streakBroken = false;
    for (const { dateStr, isToday } of scheduledDates) {
        if (completedSet.has(dateStr)) {
            running++;
            if (!streakBroken) current = running;
        } else if (!isToday) { // today being incomplete doesn't break streak yet
            if (!streakBroken) { streakBroken = true; longest = Math.max(longest, running); running = 0; }
        }
    }
    return { current, longest: Math.max(longest, running) };
}

// ──── WEEKLY BREAKDOWN ────────────────────────────────────────────────────────
function getWeeklyBreakdown() {
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const dow = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    monday.setHours(0, 0, 0, 0);

    const counts = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };

    // One-time tasks completed this week
    for (const t of tasks) {
        if (t.status === 'completed' && t.completedAt) {
            const cd = new Date(t.completedAt);
            if (cd >= monday && cd <= today)
                counts[LABELS[(DAY_NAMES.indexOf(DAY_NAMES[cd.getDay()]) + 6) % 7] || DAY_NAMES[cd.getDay()]]++;
        }
    }

    // Recurring tasks completed this week
    for (const rt of rtasks) {
        const stats = rstats[rt.id] || { completedDates: [] };
        for (const dateStr of stats.completedDates) {
            const cd = new Date(dateStr);
            if (cd >= monday && cd <= today) {
                const label = LABELS[(cd.getDay() + 6) % 7];
                if (label in counts) counts[label]++;
            }
        }
    }
    return counts;
}

// ──── INSIGHTS ────────────────────────────────────────────────────────────────
function renderInsights() {
    const el = document.getElementById('insightPanel');

    // ── One-Time stats ──
    const otAll = tasks.length;
    const otCompleted = tasks.filter(t => t.status === 'completed').length;
    const otPending = tasks.filter(t => t.status !== 'completed').length;
    const otSkipped = tasks.filter(t => t.skipCount > 0 && t.status !== 'completed').length;
    const otRate = otAll ? Math.round((otCompleted / otAll) * 100) : 0;

    // ── Recurring stats ──
    const rtTotal = rtasks.filter(rt => rt.status !== 'completed').length; // active templates
    // Count total instances scheduled in past 30 days across all active templates
    let rtScheduled = 0, rtDone = 0;
    for (const rt of rtasks) {
        if (rt.status === 'completed') continue;
        const stats = rstats[rt.id] || { completedDates: [] };
        // Count scheduled instances in past 30 days
        for (let i = 0; i < 30; i++) {
            const d = new Date(); d.setDate(d.getDate() - i);
            if (rt.days.includes(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]))
                rtScheduled++;
        }
        rtDone += stats.completedDates.filter(ds => {
            const d = new Date(ds); const ago = (Date.now() - d) / 864e5;
            return ago <= 30;
        }).length;
    }
    const rtRate = rtScheduled ? Math.round((rtDone / rtScheduled) * 100) : 0;
    const rtMissed = Math.max(0, rtScheduled - rtDone);

    // ── Overall ──
    const totalAll = otAll + rtScheduled;
    const totalCompleted = otCompleted + rtDone;
    const overallRate = totalAll ? Math.round((totalCompleted / totalAll) * 100) : 0;

    // ── Weekly breakdown ──
    const week = getWeeklyBreakdown();
    const weekMax = Math.max(1, ...Object.values(week));
    const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const todayLabel = weekDays[([0, 1, 2, 3, 4, 5, 6][(new Date().getDay() + 6) % 7])];

    // ── Streaks (top 3) ──
    const streakData = rtasks
        .filter(rt => rt.status !== 'completed' && rt.days.length)
        .map(rt => ({ rt, ...computeStreak(rt) }))
        .sort((a, b) => b.current - a.current)
        .slice(0, 3);

    // ── Recurring warnings ──
    const WARN_DAYS = 7;
    const warnings = [];
    for (const rt of rtasks) {
        if (rt.status === 'completed') continue;
        let scheduled = 0;
        for (let i = 1; i <= WARN_DAYS; i++) {
            const d = new Date(); d.setDate(d.getDate() - i);
            if (rt.days.includes(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]))
                scheduled++;
        }
        if (!scheduled) continue;
        const stats = rstats[rt.id] || { completedDates: [] };
        const done = stats.completedDates.filter(ds => {
            const ago = (Date.now() - new Date(ds)) / 864e5;
            return ago >= 1 && ago <= WARN_DAYS;
        }).length;
        const missed = scheduled - done;
        if (missed >= 2) warnings.push({ rt, missed, scheduled });
    }

    // ── Render ──
    const pbar = (pct, cls) =>
        `<div class="ibr-track"><div class="ibr-fill ${cls}" style="width:${pct}%"></div></div>`;

    el.innerHTML = `
    <!-- Overview cards -->
    <div class="ins-cards">
      <div class="ins-card ins-card-green">
        <div class="ins-card-num">${totalCompleted}</div>
        <div class="ins-card-lbl">Total Completed</div>
      </div>
      <div class="ins-card ins-card-accent">
        <div class="ins-card-num">${overallRate}%</div>
        <div class="ins-card-lbl">Overall Rate</div>
      </div>
      <div class="ins-card ins-card-teal">
        <div class="ins-card-num">${rtDone}</div>
        <div class="ins-card-lbl">Recurring Done</div>
      </div>
      <div class="ins-card ${otSkipped > 0 ? 'ins-card-red' : 'ins-card-gray'}">
        <div class="ins-card-num">${otSkipped + rtMissed}</div>
        <div class="ins-card-lbl">Skipped / Missed</div>
      </div>
    </div>

    <!-- One-Time Task section -->
    <div class="ins-section-header">📌 One-Time Tasks</div>
    <div class="insight-bars">
      <div class="insight-bar-row">
        <div class="ibr-label"><span>Completed</span><span>${otCompleted} / ${otAll}</span></div>
        ${pbar(otRate, 'fill-green')}
      </div>
      <div class="insight-bar-row">
        <div class="ibr-label"><span>Pending</span><span>${otPending}</span></div>
        ${pbar(otAll ? Math.round(otPending / otAll * 100) : 0, 'fill-accent')}
      </div>
      <div class="insight-bar-row">
        <div class="ibr-label"><span>Skipped / Delayed</span><span>${otSkipped}</span></div>
        ${pbar(otAll ? Math.round(otSkipped / otAll * 100) : 0, 'fill-red')}
      </div>
    </div>

    <!-- Recurring Task section -->
    <div class="ins-section-header" style="margin-top:16px">🔁 Recurring Tasks <span style="font-size:10px;color:var(--text3);font-weight:400">(last 30 days)</span></div>
    ${!rtTotal ? `<div style="color:var(--text3);font-size:12px;padding:6px 0">No recurring tasks yet.</div>` : `
    <div class="insight-bars">
      <div class="insight-bar-row">
        <div class="ibr-label"><span>Completion Rate</span><span>${rtRate}%</span></div>
        ${pbar(rtRate, 'fill-green')}
      </div>
      <div class="insight-bar-row">
        <div class="ibr-label"><span>Instances Done</span><span>${rtDone} / ${rtScheduled}</span></div>
        ${pbar(rtRate, 'fill-teal')}
      </div>
      <div class="insight-bar-row">
        <div class="ibr-label"><span>Missed</span><span>${rtMissed}</span></div>
        ${pbar(rtScheduled ? Math.round(rtMissed / rtScheduled * 100) : 0, 'fill-red')}
      </div>
    </div>`}

    <!-- Streak badges -->
    ${streakData.length ? `
    <div class="ins-section-header" style="margin-top:16px">🔥 Current Streaks</div>
    <div class="ins-streak-list">
      ${streakData.map(({ rt, current, longest }) => `
        <div class="ins-streak-item">
          <div class="ins-streak-name">${escHtml(rt.name)} <span style="opacity:.6;font-size:10px">🔁</span></div>
          <div class="ins-streak-badges">
            <span class="ins-streak-badge">🔥 ${current}d current</span>
            <span class="ins-streak-badge ins-streak-best">⭐ ${longest}d best</span>
          </div>
        </div>`).join('')}
    </div>` : ''}

    <!-- Weekly breakdown -->
    <div class="ins-section-header" style="margin-top:16px">📅 This Week</div>
    <div class="ins-week-grid">
      ${weekDays.map(d => {
        const count = week[d] || 0;
        const barH = Math.round((count / weekMax) * 56);
        const isToday = d === todayLabel;
        return `<div class="ins-week-col${isToday ? ' ins-week-today' : ''}">
          <div class="ins-week-bar-wrap">
            ${count > 0 ? `<div class="ins-week-bar" style="height:${barH}px"></div>` : '<div class="ins-week-bar-empty"></div>'}
          </div>
          <div class="ins-week-count">${count || '–'}</div>
          <div class="ins-week-label">${d}</div>
        </div>`;
    }).join('')}
    </div>

    <!-- Warnings -->
    ${warnings.map(({ rt, missed, scheduled }) => `
      <div class="ins-warning">
        <div class="ins-warning-title">⚠️ Skipped “${escHtml(rt.name)}” ${missed}× this week</div>
        <div class="ins-warning-sug">
          • Try <a href="#" onclick="editRecurringTask('${rt.id}');return false">rescheduling</a> it to different days.<br/>
          • Reduce duration to make it easier to start.<br/>
          • Consider fewer days per week.
        </div>
      </div>`).join('')}`;
}

// ──── BEHAVIOR INSIGHTS ───────────────────────────────────────────────────────
function renderBehaviorInsights() {
    const el = document.getElementById('behaviorPanel');
    if (!el) return;

    if (!delayHistory || delayHistory.length === 0) {
        el.innerHTML = `<div class="empty-state" style="padding:16px"><p>No delays logged yet. Great focus!</p></div>`;
        return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const todayDelays = delayHistory.filter(d => d.date === todayStr);

    if (todayDelays.length === 0) {
        el.innerHTML = `<div class="empty-state" style="padding:16px"><p>No tasks delayed today. Keep it up!</p></div>`;
        return;
    }

    const tasksDelayed = new Set(todayDelays.map(d => d.taskId)).size;
    const totalDelaySecs = todayDelays.reduce((sum, d) => sum + d.delaySeconds, 0);
    const avgDelayMins = Math.round((totalDelaySecs / todayDelays.length) / 60);

    // Find most procrastinated task today
    const taskDelays = {};
    for (const d of todayDelays) {
        if (!taskDelays[d.taskName]) taskDelays[d.taskName] = 0;
        taskDelays[d.taskName] += d.delaySeconds;
    }

    let mostDelayedTask = 'None';
    let maxDelay = -1;
    for (const [name, secs] of Object.entries(taskDelays)) {
        if (secs > maxDelay) {
            maxDelay = secs;
            mostDelayedTask = name;
        }
    }

    el.innerHTML = `
    <div class="ins-cards" style="grid-template-columns: repeat(3, 1fr);">
      <div class="ins-card">
        <div class="ins-card-num" style="color:#ffb055">${tasksDelayed}</div>
        <div class="ins-card-lbl">Tasks Delayed</div>
      </div>
      <div class="ins-card">
        <div class="ins-card-num" style="color:#ff4d6d">${avgDelayMins}m</div>
        <div class="ins-card-lbl">Avg Delay</div>
      </div>
      <div class="ins-card">
        <div class="ins-card-num" style="color:#a89bff">${Math.round(maxDelay / 60)}m</div>
        <div class="ins-card-lbl">Max Delay</div>
      </div>
    </div>
    <div class="ins-section-header" style="margin-top:10px">🏆 Most Procrastinated Today</div>
    <div style="font-size:13px; font-weight:600; color:var(--text); padding: 8px; background:rgba(255,255,255,0.03); border-radius:4px; border:1px solid var(--border)">
        ${escHtml(mostDelayedTask)}
    </div>
    `;
}

// ──── MOMENTUM ────────────────────────────────────────────────────────────────
function renderMomentum() {
    const el = document.getElementById('momentumList');
    // Include both one-time tasks and recurring templates
    const allTasks = [
        ...tasks,
        ...rtasks.filter(rt => rt.status !== 'completed').map(rt => ({ ...rt, isRecurring: true })),
    ];
    if (!allTasks.length) {
        el.innerHTML = `<div style="color:var(--text3);font-size:12px;text-align:center;padding:12px">No tasks yet.</div>`;
        return;
    }
    el.innerHTML = allTasks.map(t => {
        const m = momentumStatus(t);
        const recLabel = t.isRecurring ? ` <span style="font-size:10px;opacity:.6">🔁</span>` : '';
        return `
      <div class="momentum-card">
        <div class="mmt-icon">${m.icon}</div>
        <div class="mmt-info">
          <div class="mmt-name">${escHtml(t.name)}${recLabel}</div>
          <div class="mmt-status">${m.label}</div>
        </div>
      </div>`;
    }).join('');
}

// ──── HEADER STATS ────────────────────────────────────────────────────────────
function renderHeaderStats() {
    const oneTimePending = tasks.filter(t => t.status !== 'completed').length;
    const recurringActive = rtasks.filter(rt => rt.status !== 'completed').length;
    document.getElementById('hTotalTasks').textContent = oneTimePending + recurringActive;
    document.getElementById('hCompletedTasks').textContent = tasks.filter(t => t.status === 'completed').length;
    const oneTimeSkipped = tasks.filter(t => t.skipCount > 0 && t.status !== 'completed').length;
    const recurringSkipped = rtasks.filter(rt => (rt.skipCount || 0) > 0 && rt.status !== 'completed').length;
    document.getElementById('hSkippedTasks').textContent = oneTimeSkipped + recurringSkipped;
}

// ──── START NOW ───────────────────────────────────────────────────────────────
function checkStartNow() {
    const now = new Date();
    const activeSlot = slots.find(s => {
        const start = new Date(`${s.date}T${s.startTime}`);
        const end = new Date(`${s.date}T${s.endTime}`);
        return now >= start && now <= end;
    });

    const banner = document.getElementById('startNowBanner');
    if (!activeSlot) { banner.classList.add('hidden'); return; }

    const dur = Math.round((new Date(`${activeSlot.date}T${activeSlot.endTime}`) - now) / 60000);
    const pending = tasks.filter(t => t.status !== 'completed');
    const sorted = [...pending].sort((a, b) => calculatePriority(b) - calculatePriority(a));
    const suggest = sorted.find(t => t.estTime <= dur && energyMatch(t.energy, activeSlot.energy));

    if (!suggest) { banner.classList.add('hidden'); return; }

    startNowTaskId = suggest.id;
    document.getElementById('snbTitle').textContent = `You have ${dur} minutes free right now!`;
    document.getElementById('snbMessage').textContent = `Suggested task: ${suggest.name}`;
    banner.classList.remove('hidden');
}

function handleStartNow() {
    if (startNowTaskId) openFocusMode(startNowTaskId);
    dismissStartNow();
}

function dismissStartNow() {
    document.getElementById('startNowBanner').classList.add('hidden');
}

// ──── ADD TASK ────────────────────────────────────────────────────────────────
function addTask(e) {
    e.preventDefault();
    const name = document.getElementById('taskName').value.trim();
    const importance = document.getElementById('taskImportance').value;
    const energy = document.getElementById('taskEnergy').value;
    const deadline = document.getElementById('taskDeadline').value;
    const estTime = parseInt(document.getElementById('taskTime').value, 10);
    const link = document.getElementById('taskLink').value.trim();

    if (!name || !deadline || !estTime) return;

    const task = {
        id: uid(),
        name, importance, energy,
        deadline: new Date(deadline).toISOString(),
        estTime, link,
        status: 'pending',
        skipCount: 0,
        createdAt: new Date().toISOString(),
    };

    tasks.push(task);
    LS.set(KEYS.TASKS, tasks);

    document.getElementById('taskForm').reset();
    refresh();
    flashSuccess('taskName', 'Task added!');
}

// ──── ADD FREE TIME ───────────────────────────────────────────────────────────
function addFreeTime(e) {
    e.preventDefault();
    const date = document.getElementById('ftDate').value;
    const startTime = document.getElementById('ftStart').value;
    const endTime = document.getElementById('ftEnd').value;
    const energy = document.getElementById('ftEnergy').value;

    if (!date || !startTime || !endTime) return;
    if (startTime >= endTime) {
        alert('End time must be after start time.');
        return;
    }

    const slot = { id: uid(), date, startTime, endTime, energy };
    slots.push(slot);
    LS.set(KEYS.SLOTS, slots);

    document.getElementById('freeTimeForm').reset();
    refresh();
    flashSuccess('ftDate', 'Slot added!');
}

// ──── TASK ACTIONS ────────────────────────────────────────────────────────────
function completeTask(id) {
    // Check one-time tasks first
    const t = tasks.find(x => x.id === id);
    if (t) {
        t.status = 'completed';
        t.completedAt = new Date().toISOString(); // timestamp for weekly breakdown
        LS.set(KEYS.TASKS, tasks);
        refresh();
        return;
    }
    // Check recurring templates
    const rt = rtasks.find(x => x.id === id);
    if (rt) { rt.status = 'completed'; LS.set(KEYS.RTASKS, rtasks); refresh(); }
}

function skipTask(id) {
    const t = tasks.find(x => x.id === id);
    if (t) {
        t.skipCount = (t.skipCount || 0) + 1;
        LS.set(KEYS.TASKS, tasks);
        refresh();
        detectProcrastination(t);
        return;
    }
    // Also allow skipping recurring templates
    const rt = rtasks.find(x => x.id === id);
    if (rt) {
        rt.skipCount = (rt.skipCount || 0) + 1;
        LS.set(KEYS.RTASKS, rtasks);
        refresh();
        detectProcrastination(rt);
    }
}

function deleteTask(id) {
    const prevLen = tasks.length;
    tasks = tasks.filter(x => x.id !== id);
    if (tasks.length < prevLen) { LS.set(KEYS.TASKS, tasks); refresh(); return; }
    // Also delete recurring templates
    deleteRecurringTask(id);
}

function deleteSlot(id) {
    slots = slots.filter(x => x.id !== id);
    LS.set(KEYS.SLOTS, slots);
    refresh();
}

// ──── PROCRASTINATION DETECTOR ────────────────────────────────────────────────
/**
 * detectProcrastination(task)
 * Shows a browser notification (if permission granted) when skip count hits a threshold.
 */
function detectProcrastination(task) {
    if (task.skipCount === 3) {
        showNotif(`⚠ Procrastination detected!`, `You've skipped "${task.name}" ${task.skipCount} times.`);
    }
}

function showNotif(title, body) {
    if ('Notification' in window) {
        Notification.requestPermission().then(p => {
            if (p === 'granted') new Notification(title, { body });
        });
    }
}

// ──── FOCUS MODE ──────────────────────────────────────────────────────────────
function openFocusMode(taskId) {
    const t = tasks.find(x => x.id === taskId);
    if (!t) return;

    const uc = urgencyClass(t);
    const badgeText = uc === 'urgent-red' ? '🔴 High Priority' : uc === 'urgent-yellow' ? '🟡 Moderate' : '🟢 Low Urgency';

    document.getElementById('focusBadge').textContent = badgeText;
    document.getElementById('focusTaskName').textContent = t.name;
    document.getElementById('focusDeadline').textContent = `📅 Deadline: ${fmt(t.deadline)}`;
    document.getElementById('focusImportance').textContent = `⚡ Importance: ${t.importance}`;

    const linkEl = document.getElementById('focusLink');
    if (t.link) {
        linkEl.href = t.link;
        linkEl.classList.remove('hidden');
    } else {
        linkEl.classList.add('hidden');
    }

    document.getElementById('focusOverlay').classList.remove('hidden');
    resetPomodoro();
}

function closeFocusMode() {
    document.getElementById('focusOverlay').classList.add('hidden');
    stopPomodoro();
}

// ──── POMODORO TIMER ──────────────────────────────────────────────────────────
const POMO_DURATION = 25 * 60; // 25 minutes in seconds
let pomodoroRemaining = POMO_DURATION;
let pomodoroInterval = null;
let pomodoroRunning = false;

const CIRCUMFERENCE = 2 * Math.PI * 52; // ≈ 326.73

function updatePomodoroDisplay() {
    const mins = Math.floor(pomodoroRemaining / 60);
    const secs = pomodoroRemaining % 60;
    document.getElementById('pomodoroDisplay').textContent =
        `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const progress = pomodoroRemaining / POMO_DURATION;
    const offset = CIRCUMFERENCE * (1 - progress);
    const ring = document.getElementById('pomodoroRing');
    if (ring) ring.style.strokeDashoffset = offset;
}

function togglePomodoro() {
    if (pomodoroRunning) {
        stopPomodoro();
    } else {
        startFocusTimer();
    }
}

// ──── ADVANCED PROCRASTINATION TIMER ──────────────────────────────────────────
let procrasInterval = null;
let procrasStartTime = null;
let procrasTaskId = null;
let procrasTaskName = null;
let currentDistractions = [];
let currentProcScore = 0;
let isFocusRescue = false;
let focusRescueRemaining = 120; // 2 minutes

function startProcrastination(taskId, taskName) {
    procrasTaskId = taskId;
    procrasTaskName = taskName;
    procrasStartTime = Date.now();
    currentDistractions = [];
    currentProcScore = 0;
    isFocusRescue = false;

    document.getElementById('timerTaskName').textContent = taskName;
    document.getElementById('timerDisplay').textContent = "00:00";

    // Reset ring
    const ring = document.getElementById('procRing');
    if (ring) {
        ring.style.strokeDashoffset = 0;
        ring.style.stroke = 'var(--accent)';
    }

    const msgEl = document.getElementById('timerMessage');
    msgEl.innerHTML = "Waiting to start...<br>Take a deep breath.";
    msgEl.classList.remove('proc-msg-fade');

    document.getElementById('procScoreDisplay').textContent = "0";

    // Show normal UI, hide focus rescue mode artifacts
    document.getElementById('distractionLogArea').style.display = 'block';

    const overlay = document.getElementById('procrastinationOverlay');
    overlay.classList.remove('hidden');
    overlay.classList.remove('timer-pulse');

    if (procrasInterval) clearInterval(procrasInterval);
    procrasInterval = setInterval(updateProcrastinationTimer, 1000);
}

function updateProcrastinationTimer() {
    if (!procrasStartTime && !isFocusRescue) return;

    const displayEl = document.getElementById('timerDisplay');
    const msgEl = document.getElementById('timerMessage');
    const overlay = document.getElementById('procrastinationOverlay');
    const ring = document.getElementById('procRing');

    if (isFocusRescue) {
        if (focusRescueRemaining <= 0) {
            clearInterval(procrasInterval);
            stopProcrastination(true, "Starting was the hardest part. You've got this now.");
            return;
        }
        focusRescueRemaining--;
        const mins = Math.floor(focusRescueRemaining / 60);
        const secs = focusRescueRemaining % 60;
        displayEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        if (ring) {
            const progress = focusRescueRemaining / 120;
            ring.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);
            ring.style.stroke = 'var(--teal)';
        }
        return;
    }

    const elapsedSecs = Math.floor((Date.now() - procrasStartTime) / 1000);
    const mins = Math.floor(elapsedSecs / 60);
    const secs = elapsedSecs % 60;

    displayEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (ring) {
        // assume a 15 min max for filling the ring backwards
        const progress = Math.min(elapsedSecs / (15 * 60), 1);
        ring.style.strokeDashoffset = CIRCUMFERENCE * progress;
        if (progress > 0.8) ring.style.stroke = 'var(--urgent-red)';
        else if (progress > 0.4) ring.style.stroke = 'var(--yellow)';
        else ring.style.stroke = 'var(--accent)';
    }

    const updateMsg = (text) => {
        if (msgEl.innerHTML !== text) {
            msgEl.classList.add('proc-msg-fade');
            setTimeout(() => {
                msgEl.innerHTML = text;
                msgEl.classList.remove('proc-msg-fade');
            }, 500);
        }
    };

    if (mins >= 12 && secs === 0) {
        updateMsg("High procrastination detected.<br>Consider starting with a small step.");
        overlay.classList.add('timer-pulse');
    } else if (mins === 7 && secs === 0) {
        updateMsg("Procrastination mode detected.<br>Starting now might actually feel easier than waiting.");
    } else if (mins === 3 && secs === 0) {
        updateMsg("Your brain may be avoiding effort.<br>What's causing the friction?");
    } else if (mins === 0 && secs === 5) {
        updateMsg("Short delay before starting.<br>You don't need to feel perfectly ready.");
    }
}

function logDistraction(type) {
    currentDistractions.push(type);
    currentProcScore += 15;
    if (currentProcScore > 100) currentProcScore = 100;

    const scoreEl = document.getElementById('procScoreDisplay');
    scoreEl.textContent = currentProcScore;

    // Tiny pulse animation on score
    scoreEl.style.transform = 'scale(1.5)';
    setTimeout(() => { scoreEl.style.transform = 'scale(1)'; }, 200);
}

function startFocusRescue() {
    isFocusRescue = true;
    focusRescueRemaining = 120; // 2 minutes
    document.getElementById('distractionLogArea').style.display = 'none';
    document.getElementById('timerMessage').innerHTML = "Focus Rescue Mode Active.<br>Just commit to 2 minutes. Go!";
    document.getElementById('procrastinationOverlay').classList.remove('timer-pulse');
}

function stopProcrastination(doItNow, customMessage = null) {
    if (procrasInterval) clearInterval(procrasInterval);
    procrasInterval = null;

    // Save to delay history
    const elapsedSecs = isFocusRescue ? 0 : Math.floor((Date.now() - procrasStartTime) / 1000);
    if ((elapsedSecs > 10 || currentDistractions.length > 0) && procrasTaskId) {
        const todayStr = new Date().toISOString().split('T')[0];
        delayHistory.push({
            taskId: procrasTaskId,
            taskName: procrasTaskName,
            date: todayStr,
            delaySeconds: elapsedSecs,
            distractions: [...currentDistractions],
            score: currentProcScore
        });
        LS.set(KEYS.P_HISTORY, delayHistory);

        if (typeof renderBehaviorInsights === 'function') {
            renderBehaviorInsights(); // Update the new panel
        }
    }

    procrasStartTime = null;

    document.getElementById('procrastinationOverlay').classList.add('hidden');
    document.getElementById('procrastinationOverlay').classList.remove('timer-pulse');

    if (doItNow && procrasTaskId) {
        openFocusMode(procrasTaskId);
        if (customMessage) {
            setTimeout(() => {
                showNotif("🚀 Focus Rescued", customMessage);
            }, 500);
        }
    }
    procrasTaskId = null;
    procrasTaskName = null;
}

// ──── ADVANCED REGRET SIMULATOR ───────────────────────────────────────────────
let regretTaskId = null;

function openRegretSimulator(taskId, taskName) {
    regretTaskId = taskId;
    document.getElementById('rsTaskName').textContent = taskName;

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // 1. Calculate Regret Score
    let regretScore = 0;

    // factor: importance
    if (task.importance === 'High') regretScore += 25;
    else if (task.importance === 'Medium') regretScore += 15;
    else regretScore += 5;

    // factor: deadline proximity
    const hoursLeft = hoursUntilDeadline(task.deadline);
    if (hoursLeft <= 24) regretScore += 35;
    else if (hoursLeft <= 48) regretScore += 20;
    else if (hoursLeft <= 72) regretScore += 10;

    // factor: energy required
    if (task.energyLevel === 'High') regretScore += 15;
    else if (task.energyLevel === 'Medium') regretScore += 10;

    // 2. Domino Effect Analysis
    // Find next few scheduled/urgent tasks
    const upcomingTasks = tasks
        .filter(t => t.id !== taskId && t.status !== 'completed')
        .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
        .slice(0, 3);

    if (upcomingTasks.length > 0) {
        regretScore += 15; // future conflict penalty
    }

    if (regretScore > 98) regretScore = 98; // max out

    // 3. Update UI
    const scoreVal = document.getElementById('rsScoreValue');
    const scoreDesc = document.getElementById('rsScoreDesc');
    scoreVal.textContent = `${regretScore}%`;

    if (regretScore >= 70) {
        scoreVal.style.color = '#ff4d6d';
        scoreDesc.textContent = "High Risk. Delaying this will severely impact your schedule.";
    } else if (regretScore >= 40) {
        scoreVal.style.color = '#ffb055';
        scoreDesc.textContent = "Medium Risk. You'll feel the pressure tomorrow.";
    } else {
        scoreVal.style.color = '#06d6a0';
        scoreDesc.textContent = "Low Risk. But getting it done now buys you freedom.";
    }

    // Rent Domino visualization
    const dominoEl = document.getElementById('rsDominoEffect');
    let dominoHtml = `<div class="domino-item delayed-item">${escHtml(task.name)}</div>`;

    upcomingTasks.forEach(ut => {
        dominoHtml += `
            <div class="domino-arrow">→</div>
            <div class="domino-item">${escHtml(ut.name)} (Compressed)</div>
        `;
    });
    if (upcomingTasks.length === 0) {
        dominoHtml += `
            <div class="domino-arrow">→</div>
            <div class="domino-item" style="border-color:#06d6a0;color:#06d6a0;background:rgba(6,214,160,0.1)">Free Time</div>
        `;
    }
    dominoEl.innerHTML = dominoHtml;

    // Benefits & Costs text updates
    const benList = document.getElementById('rsBenefitsList');
    const costList = document.getElementById('rsCostsList');

    benList.innerHTML = `
        <li>Guilt-free relaxation tonight</li>
        <li>Momentum maintained</li>
        ${upcomingTasks.length > 0 ? `<li>Full focus available for '${escHtml(upcomingTasks[0].name)}'</li>` : ''}
    `;

    costList.innerHTML = `
        <li>Task remains open in your brain (Zeigarnik effect)</li>
        <li>Future schedule gets compressed</li>
        ${hoursLeft <= 24 ? `<li style="color:#ff4d6d;font-weight:bold">Deadline panic tomorrow</li>` : ''}
    `;

    // Smart Actions
    const actionsEl = document.getElementById('rsSmartActions');
    actionsEl.innerHTML = `
        <button class="btn-primary" onclick="rsStartShort()">🚀 Start for 5 Mins</button>
        ${regretScore < 80 ? `<button class="btn-secondary" onclick="rsDelay(10)">⏳ Delay 10 Mins</button>` : ''}
        <button class="btn-secondary" style="border-color:var(--border);color:var(--text3)" onclick="closeRegretSimulator()">Reschedule it</button>
    `;

    document.getElementById('regretModal').classList.remove('hidden');
}

function closeRegretSimulator() {
    regretTaskId = null;
    document.getElementById('regretModal').classList.add('hidden');
}

function rsDoItNow() {
    if (regretTaskId) openFocusMode(regretTaskId);
    closeRegretSimulator();
}

function rsStartShort() {
    if (regretTaskId) openFocusMode(regretTaskId);
    setTimeout(() => {
        showNotif("Just 5 Minutes", "You only need to work for 5 minutes. You can stop after that if you want.");
    }, 1000);
    closeRegretSimulator();
}

function rsDelay(mins) {
    showNotif("Delayed", `We'll remind you in ${mins} minutes. Don't let the anxiety build up!`);
    closeRegretSimulator();
}

/**
 * startFocusTimer()
 * Starts the 25-minute Pomodoro countdown.
 */
function startFocusTimer() {
    pomodoroRunning = true;
    document.getElementById('pomodoroStartBtn').textContent = '⏸ Pause';
    pomodoroInterval = setInterval(() => {
        if (pomodoroRemaining <= 0) {
            clearInterval(pomodoroInterval);
            pomodoroRunning = false;
            document.getElementById('pomodoroStartBtn').textContent = '▶ Start';
            showNotif('⏰ Pomodoro Complete!', 'Take a short break. You earned it!');
            pomodoroRemaining = 0;
            updatePomodoroDisplay();
        } else {
            pomodoroRemaining--;
            updatePomodoroDisplay();
        }
    }, 1000);
}

function stopPomodoro() {
    clearInterval(pomodoroInterval);
    pomodoroRunning = false;
    document.getElementById('pomodoroStartBtn').textContent = '▶ Start';
}

function resetPomodoro() {
    stopPomodoro();
    pomodoroRemaining = POMO_DURATION;
    updatePomodoroDisplay();
}

// ──── TOGGLE SECTION ─────────────────────────────────────────────────────────
function toggleSection(sectionId, btnId) {
    const sec = document.getElementById(sectionId);
    const btn = document.getElementById(btnId);
    if (!sec) return;
    const isHidden = sec.classList.toggle('hidden');
    if (btn) {
        btn.textContent = isHidden ? '＋ Add' : '✕ Close';
        btn.classList.toggle('active', !isHidden);
    }
}

// ──── GET SELECTED DAYS ───────────────────────────────────────────────────────
function getSelectedDays(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
}

// ──── SET SELECTED DAYS ───────────────────────────────────────────────────────
function setSelectedDays(containerId, days) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = days.includes(cb.value);
    });
}

// ──── EXPAND RECURRING TASKS ─────────────────────────────────────────────────
/**
 * expandRecurringTasks()
 * Generates virtual task objects from recurring templates for the next 4 weeks.
 * Each virtual task has a deadline = that day at endTime.
 */
function expandRecurringTasks() {
    const now = new Date();
    const weeksCount = 4;
    const expanded = [];

    for (const rt of rtasks) {
        if (rt.status === 'completed') continue; // skip completed templates
        const hasFixedTime = !!(rt.startTime && rt.endTime);
        const maxWeeks = rt.isWeekly ? weeksCount : 1;
        for (let week = 0; week < maxWeeks; week++) {
            for (const day of rt.days) {
                const dayNum = DAYS_MAP[day];
                const base = new Date();
                base.setHours(0, 0, 0, 0);
                const currentDay = base.getDay();
                const daysUntil = (dayNum - currentDay + 7) % 7 + (week * 7);
                const targetDate = new Date(base);
                targetDate.setDate(base.getDate() + daysUntil);

                // Deadline: if endTime provided use it, otherwise end of day
                if (hasFixedTime) {
                    const [eh, em] = rt.endTime.split(':').map(Number);
                    targetDate.setHours(eh, em, 0, 0);
                } else {
                    targetDate.setHours(23, 59, 0, 0);
                }

                if (targetDate <= now) continue; // skip past occurrences

                expanded.push({
                    id: `${rt.id}_${day}_w${week}`,
                    name: rt.name,
                    importance: rt.importance,
                    energy: rt.energy,
                    deadline: targetDate.toISOString(),
                    estTime: rt.estTime,
                    link: rt.link || '',
                    status: 'pending',
                    skipCount: 0,
                    createdAt: rt.createdAt,
                    isRecurring: true,
                    hasFixedTime,
                    startTime: rt.startTime || null,
                    endTime: rt.endTime || null,
                    recurringId: rt.id,
                    recurringDay: day,
                });
            }
        }
    }
    return expanded;
}

// ──── EXPAND RECURRING SLOTS ──────────────────────────────────────────────────
/**
 * expandRecurringSlots()
 * Generates virtual slot objects from recurring free-time templates.
 */
function expandRecurringSlots() {
    const now = new Date();
    const weeksCount = 4;
    const expanded = [];

    for (const rs of rslots) {
        const maxWeeks = rs.isWeekly ? weeksCount : 1;
        for (let week = 0; week < maxWeeks; week++) {
            for (const day of rs.days) {
                const dayNum = DAYS_MAP[day];
                const base = new Date();
                base.setHours(0, 0, 0, 0);
                const currentDay = base.getDay();
                const daysUntil = (dayNum - currentDay + 7) % 7 + (week * 7);
                const targetDate = new Date(base);
                targetDate.setDate(base.getDate() + daysUntil);

                const yyyy = targetDate.getFullYear();
                const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
                const dd = String(targetDate.getDate()).padStart(2, '0');
                const dateStr = `${yyyy}-${mm}-${dd}`;

                // Check slot end time hasn't passed
                const [eh, em] = rs.endTime.split(':').map(Number);
                const endDt = new Date(targetDate);
                endDt.setHours(eh, em, 0, 0);
                if (endDt <= now) continue;

                expanded.push({
                    id: `${rs.id}_${day}_w${week}`,
                    date: dateStr,
                    startTime: rs.startTime,
                    endTime: rs.endTime,
                    energy: rs.energy,
                    isRecurring: true,
                    recurringId: rs.id,
                    recurringDay: day,
                });
            }
        }
    }
    return expanded;
}

// ──── ADD RECURRING TASK ──────────────────────────────────────────────────────
function addRecurringTask(e) {
    e.preventDefault();
    const days = getSelectedDays('rtDays');
    if (!days.length) { alert('Please select at least one day of the week.'); return; }

    const startTime = document.getElementById('rtStart').value;
    const endTime = document.getElementById('rtEnd').value;

    // Validate: only if both are provided check order; if only one set, warn
    if (startTime && endTime && startTime >= endTime) {
        alert('End time must be after start time.');
        return;
    }
    if ((startTime && !endTime) || (!startTime && endTime)) {
        alert('Please provide BOTH start and end time — or leave both empty for auto-scheduling.');
        return;
    }

    const editId = document.getElementById('rtEditId').value;
    const template = {
        id: editId || uid(),
        name: document.getElementById('rtName').value.trim(),
        importance: document.getElementById('rtImportance').value,
        energy: document.getElementById('rtEnergy').value,
        days,
        startTime,
        endTime,
        estTime: parseInt(document.getElementById('rtEstTime').value, 10),
        link: document.getElementById('rtLink').value.trim(),
        isWeekly: document.getElementById('rtWeekly').checked,
        createdAt: editId ? (rtasks.find(r => r.id === editId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
    };

    if (editId) {
        rtasks = rtasks.map(r => r.id === editId ? template : r);
    } else {
        rtasks.push(template);
    }
    LS.set(KEYS.RTASKS, rtasks);

    document.getElementById('recurringTaskForm').reset();
    document.getElementById('rtEditId').value = '';
    document.getElementById('rtSubmitBtn').textContent = '🔁 Add Recurring Task';
    toggleSection('recTaskSection', 'recTaskToggle');
    refresh();
}

// ──── ADD RECURRING FREE TIME ─────────────────────────────────────────────────
function addRecurringFreeTime(e) {
    e.preventDefault();
    const days = getSelectedDays('rsDays');
    if (!days.length) { alert('Please select at least one day of the week.'); return; }

    const startTime = document.getElementById('rsStart').value;
    const endTime = document.getElementById('rsEnd').value;
    if (startTime >= endTime) { alert('End time must be after start time.'); return; }

    const editId = document.getElementById('rsEditId').value;
    const template = {
        id: editId || uid(),
        days,
        startTime,
        endTime,
        energy: document.getElementById('rsEnergy').value,
        isWeekly: document.getElementById('rsWeekly').checked,
        createdAt: editId ? (rslots.find(r => r.id === editId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
    };

    if (editId) {
        rslots = rslots.map(r => r.id === editId ? template : r);
    } else {
        rslots.push(template);
    }
    LS.set(KEYS.RSLOTS, rslots);

    document.getElementById('recurringSlotForm').reset();
    document.getElementById('rsEditId').value = '';
    document.getElementById('rsSubmitBtn').textContent = '🔁 Add Recurring Slot';
    toggleSection('recSlotSection', 'recSlotToggle');
    refresh();
}

// ──── DELETE RECURRING TASK ───────────────────────────────────────────────────
function deleteRecurringTask(id) {
    rtasks = rtasks.filter(r => r.id !== id);
    LS.set(KEYS.RTASKS, rtasks);
    refresh();
}

// ──── DELETE RECURRING SLOT ───────────────────────────────────────────────────
function deleteRecurringSlot(id) {
    rslots = rslots.filter(r => r.id !== id);
    LS.set(KEYS.RSLOTS, rslots);
    refresh();
}

// ──── EDIT RECURRING TASK ─────────────────────────────────────────────────────
function editRecurringTask(id) {
    const rt = rtasks.find(r => r.id === id);
    if (!rt) return;
    document.getElementById('rtEditId').value = rt.id;
    document.getElementById('rtName').value = rt.name;
    document.getElementById('rtImportance').value = rt.importance;
    document.getElementById('rtEnergy').value = rt.energy;
    setSelectedDays('rtDays', rt.days);
    document.getElementById('rtStart').value = rt.startTime;
    document.getElementById('rtEnd').value = rt.endTime;
    document.getElementById('rtEstTime').value = rt.estTime;
    document.getElementById('rtLink').value = rt.link || '';
    document.getElementById('rtWeekly').checked = rt.isWeekly;
    document.getElementById('rtSubmitBtn').textContent = '💾 Save Changes';
    // open section if closed
    const sec = document.getElementById('recTaskSection');
    if (sec.classList.contains('hidden')) toggleSection('recTaskSection', 'recTaskToggle');
    sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ──── EDIT RECURRING SLOT ─────────────────────────────────────────────────────
function editRecurringSlot(id) {
    const rs = rslots.find(r => r.id === id);
    if (!rs) return;
    document.getElementById('rsEditId').value = rs.id;
    setSelectedDays('rsDays', rs.days);
    document.getElementById('rsStart').value = rs.startTime;
    document.getElementById('rsEnd').value = rs.endTime;
    document.getElementById('rsEnergy').value = rs.energy;
    document.getElementById('rsWeekly').checked = rs.isWeekly;
    document.getElementById('rsSubmitBtn').textContent = '💾 Save Changes';
    const sec = document.getElementById('recSlotSection');
    if (sec.classList.contains('hidden')) toggleSection('recSlotSection', 'recSlotToggle');
    sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ──── RENDER RECURRING TASKS ──────────────────────────────────────────────────
function renderRecurringTasks() {
    const el = document.getElementById('recurringTaskList');
    if (!rtasks.length) { el.innerHTML = ''; return; }
    const conflicts = detectConflicts();
    const conflictTaskIds = new Set(conflicts.map(c => c.task.id));
    const todayStr = new Date().toISOString().slice(0, 10);
    const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayDayName = DAY_NAMES_SHORT[new Date().getDay()];

    el.innerHTML = rtasks.map(rt => {
        const dayBadges = rt.days.map(d => `<span class="rc-day-badge">${d}</span>`).join('');
        const weeklyBadge = rt.isWeekly
            ? `<span class="rc-weekly-badge">🔁 Weekly</span>`
            : `<span class="rc-weekly-badge" style="background:rgba(255,209,102,0.08);color:#ffe08a;border-color:rgba(255,209,102,0.2)">1× Only</span>`;
        const conflictBadge = conflictTaskIds.has(rt.id)
            ? `<div class="rec-conflict-badge">⚠️ Conflicts with free window</div>`
            : '';
        // Time display (optional start/end time)
        const timeDisplay = (rt.startTime && rt.endTime)
            ? `<span>⏰ ${fmtTime(rt.startTime)} – ${fmtTime(rt.endTime)}</span>`
            : `<span style="color:var(--teal)">🤖 Auto-scheduled</span>`;
        // Streak
        const { current, longest } = computeStreak(rt);
        const streakBadge = current > 0
            ? `<span class="rc-streak-badge">🔥 ${current}d streak</span>`
            : '';
        const bestBadge = longest > 0
            ? `<span class="rc-streak-badge rc-streak-best">⭐ ${longest}d best</span>`
            : '';
        // Mark done today
        const isDoneToday = (rstats[rt.id]?.completedDates || []).includes(todayStr);
        const isScheduledToday = rt.days.includes(todayDayName);
        const doneTodayBtn = isScheduledToday
            ? `<button class="rc-done-today${isDoneToday ? ' rc-done-today--done' : ''}"
                onclick="markRecurringDone('${rt.id}')"
                title="${isDoneToday ? 'Already marked done today' : 'Mark as done for today'}"
                ${isDoneToday ? 'disabled' : ''}>
                ${isDoneToday ? '✔ Done Today' : '✓ Done Today'}
              </button>`
            : '';

        return `
      <div class="rec-card" id="rct-${rt.id}">
        <div class="rc-top">
          <div class="rc-name">${escHtml(rt.name)} <span style="opacity:.6;font-size:11px">🔁</span></div>
          <div class="rc-actions">
            <button class="tc-btn delay" onclick="startProcrastination('${rt.id}', '${escHtml(rt.name).replace(/'/g, "\\'")}')" title="Delay / Start Soon">Start Soon</button>
            <button class="tc-btn simulate" onclick="openRegretSimulator('${rt.id}', '${escHtml(rt.name).replace(/'/g, "\\'")}')" title="Simulate Future">🔮</button>
            <button class="tc-btn focus" onclick="editRecurringTask('${rt.id}')" title="Edit">✏</button>
            <button class="tc-btn del" onclick="deleteRecurringTask('${rt.id}')" title="Delete">✕</button>
          </div>
        </div>
        <div class="rc-days">${dayBadges}</div>
        <div class="rc-meta">
          ${timeDisplay}
          <span>⏱ ${rt.estTime}m</span>
          <span class="tag tag-purple" style="font-size:10px;padding:1px 7px">${rt.importance}</span>
          ${weeklyBadge}
        </div>
        ${(streakBadge || bestBadge) ? `<div class="rc-streaks">${streakBadge}${bestBadge}</div>` : ''}
        ${doneTodayBtn}
        ${conflictBadge}
      </div>`;
    }).join('');
}


// ──── RENDER RECURRING SLOTS ──────────────────────────────────────────────────
function renderRecurringSlots() {
    const el = document.getElementById('recurringSlotList');
    if (!rslots.length) { el.innerHTML = ''; return; }
    el.innerHTML = rslots.map(rs => {
        const dayBadges = rs.days.map(d => `<span class="rc-slot-day-badge">${d}</span>`).join('');
        const weeklyBadge = rs.isWeekly ? `<span class="rc-weekly-badge">🔁 Weekly</span>` : `<span class="rc-weekly-badge" style="background:rgba(255,209,102,0.08);color:#ffe08a;border-color:rgba(255,209,102,0.2)">1× Only</span>`;
        const dur = (() => { const [sh, sm] = rs.startTime.split(':').map(Number); const [eh, em] = rs.endTime.split(':').map(Number); return (eh * 60 + em) - (sh * 60 + sm); })();
        return `
      <div class="rec-card rec-slot" id="rcs-${rs.id}">
        <div class="rc-top">
          <div class="rc-name">Free Window</div>
          <div class="rc-actions">
            <button class="tc-btn focus" onclick="editRecurringSlot('${rs.id}')" title="Edit">✏</button>
            <button class="tc-btn del" onclick="deleteRecurringSlot('${rs.id}')" title="Delete">✕</button>
          </div>
        </div>
        <div class="rc-days">${dayBadges}</div>
        <div class="rc-meta">
          <span>⏰ ${fmtTime(rs.startTime)} – ${fmtTime(rs.endTime)}</span>
          <span>⏱ ${dur}m</span>
          <span class="tag tag-teal" style="font-size:10px;padding:1px 7px">⚡ ${rs.energy}</span>
          ${weeklyBadge}
        </div>
      </div>`;
    }).join('');
}

// ──── DETECT CONFLICTS ─────────────────────────────────────────────────────────────
/**
 * detectConflicts()
 * Returns an array of { task(rtask), slot(rslot), days[], overlapStart, overlapEnd }
 * for every recurring task that time-overlaps a recurring free-time window on a shared day.
 */
function detectConflicts() {
    const conflicts = [];
    for (const rt of rtasks) {
        const [rsh, rsm] = rt.startTime.split(':').map(Number);
        const [reh, rem] = rt.endTime.split(':').map(Number);
        const rtStart = rsh * 60 + rsm;
        const rtEnd = reh * 60 + rem;

        for (const rs of rslots) {
            const sharedDays = rt.days.filter(d => rs.days.includes(d));
            if (!sharedDays.length) continue;

            const [ssh, ssm] = rs.startTime.split(':').map(Number);
            const [seh, sem] = rs.endTime.split(':').map(Number);
            const rsStart = ssh * 60 + ssm;
            const rsEnd = seh * 60 + sem;

            // Standard overlap check: A overlaps B if A.start < B.end AND A.end > B.start
            if (rtStart < rsEnd && rtEnd > rsStart) {
                const overlapStart = Math.max(rtStart, rsStart);
                const overlapEnd = Math.min(rtEnd, rsEnd);
                conflicts.push({ task: rt, slot: rs, days: sharedDays, overlapStart, overlapEnd });
            }
        }
    }
    return conflicts;
}

// Helper: mins to time string
function minsToTime(m) {
    const h = Math.floor(m / 60);
    const mins = m % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(mins).padStart(2, '0')} ${ampm}`;
}

// ──── RENDER CONFLICT PANEL ───────────────────────────────────────────────────────
function renderConflictPanel() {
    const panel = document.getElementById('conflictPanel');
    const conflicts = detectConflicts();

    if (!conflicts.length) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');

    panel.innerHTML = `
    <div class="conflict-panel-title">⚠️ Schedule Conflicts Detected (${conflicts.length})</div>
    ${conflicts.map(c => {
        const daysList = c.days.join(', ');
        const olStart = minsToTime(c.overlapStart);
        const olEnd = minsToTime(c.overlapEnd);

        // Suggest moving the task to before or after the free window
        const beforeFreeStart = c.slot.startTime;
        const afterFreeEnd = c.slot.endTime;
        const dur = c.task.estTime;

        const [bh, bm] = beforeFreeStart.split(':').map(Number);
        const suggBefore = bh * 60 + bm - dur;
        const [ah, am] = afterFreeEnd.split(':').map(Number);

        let suggestion = '';
        if (suggBefore >= 360) {
            suggestion = `✅ Try scheduling <strong>${c.task.name}</strong> before ${minsToTime(bh * 60 + bm)} (ends ≈ ${minsToTime(suggBefore + dur)}).`;
        } else {
            suggestion = `✅ Try scheduling <strong>${c.task.name}</strong> after ${minsToTime(ah * 60 + am)}.`;
        }

        return `
        <div class="conflict-item">
          <strong>🔴 “${escHtml(c.task.name)}”</strong> overlaps your free window
          on <strong>${daysList}</strong> from <strong>${olStart} – ${olEnd}</strong>.
          <span class="conflict-suggest">${suggestion}</span>
        </div>`;
    }).join('')}`;
}

// ──── BUILD WEEKLY TIMETABLE ──────────────────────────────────────────────────────────
const WT_START = 6;   // 6 AM
const WT_END = 23;  // 11 PM
const WT_HOURS = WT_END - WT_START;       // 17 hours
const WT_MINS = WT_HOURS * 60;           // 1020 minutes
const WT_PX_PER_HOUR = 44;               // pixels per hour
const WT_PX_TOTAL = WT_HOURS * WT_PX_PER_HOUR; // 748px

function buildWeeklyTimetable() {
    const el = document.getElementById('weeklyTimetable');

    const today = new Date();
    const dow = today.getDay(); // 0=Sun
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);

    const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weekDays = DAY_NAMES.map((_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return d;
    });

    const conflicts = detectConflicts();
    const conflictKey = (taskId, day) => `${taskId}_${day}`;
    const conflictSet = new Set();
    conflicts.forEach(c => c.days.forEach(d => conflictSet.add(conflictKey(c.task.id, d))));

    // Build time ruler
    const rulerInnerStyle = `height:${WT_PX_TOTAL}px;`;
    const hourLabels = Array.from({ length: WT_HOURS + 1 }, (_, i) => {
        const h = WT_START + i;
        const label = h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
        const top = i * WT_PX_PER_HOUR;
        return `<div class="wt-hour-label" style="top:${top}px">${label}</div>`;
    }).join('');

    // Build day columns
    const colsHTML = weekDays.map((date, i) => {
        const dayName = DAY_NAMES[i];
        const isToday = date.toDateString() === today.toDateString();
        const dateNum = date.getDate();
        const monthStr = date.toLocaleDateString('en-IN', { month: 'short' });

        const dateStr = [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0'),
        ].join('-');

        const items = [];

        // Recurring free-time slots on this day
        for (const rs of rslots) {
            if (rs.days.includes(dayName)) {
                items.push({ type: 'freetime', label: 'Free Time', startTime: rs.startTime, endTime: rs.endTime });
            }
        }

        // Recurring tasks on this day (only if they have a fixed startTime+endTime)
        for (const rt of rtasks) {
            if (rt.days.includes(dayName) && rt.startTime && rt.endTime) {
                const isConflict = conflictSet.has(conflictKey(rt.id, dayName));
                items.push({ type: isConflict ? 'conflict' : 'task', label: rt.name, startTime: rt.startTime, endTime: rt.endTime });
            }
        }

        // One-time free slots on this exact date
        for (const s of slots) {
            if (s.date === dateStr) {
                items.push({ type: 'freetime', label: 'Free (1×)', startTime: s.startTime, endTime: s.endTime });
            }
        }

        // Compute hour gridlines
        const gridlinesHTML = Array.from({ length: WT_HOURS }, (_, i) => {
            const top = i * WT_PX_PER_HOUR;
            const halfTop = top + WT_PX_PER_HOUR / 2;
            return `<div class="wt-gridline" style="top:${top}px"></div>
               <div class="wt-gridline-half" style="top:${halfTop}px"></div>`;
        }).join('');

        // Build event blocks
        const blocksHTML = items.map(item => {
            const [sh, sm] = item.startTime.split(':').map(Number);
            const [eh, em] = item.endTime.split(':').map(Number);
            const startMins = sh * 60 + sm;
            const endMins = eh * 60 + em;

            // Skip if out of visible range
            if (startMins >= WT_END * 60 || endMins <= WT_START * 60) return '';

            const clampedStart = Math.max(startMins, WT_START * 60);
            const clampedEnd = Math.min(endMins, WT_END * 60);
            const topPx = ((clampedStart - WT_START * 60) / 60) * WT_PX_PER_HOUR;
            const heightPx = Math.max(14, ((clampedEnd - clampedStart) / 60) * WT_PX_PER_HOUR);

            const colors = {
                task: { bg: 'rgba(108,99,255,0.22)', border: '#6c63ff' },
                freetime: { bg: 'rgba(0,201,167,0.18)', border: '#00c9a7' },
                conflict: { bg: 'rgba(255,77,109,0.22)', border: '#ff4d6d' },
                'onetime': { bg: 'rgba(0,168,150,0.18)', border: '#00a896' },
            };
            const c = colors[item.type] || colors.task;
            const short = item.label.length > 12 ? item.label.slice(0, 11) + '…' : item.label;
            const tooltip = `${item.label}: ${fmtTime(item.startTime)}–${fmtTime(item.endTime)}`;

            return `<div class="wt-block"
          style="top:${topPx}px;height:${heightPx}px;background:${c.bg};border-left:3px solid ${c.border}"
          title="${escHtml(tooltip)}">
          <span class="wt-block-label">${escHtml(short)}</span>
          <span class="wt-block-time">${fmtTime(item.startTime)}</span>
        </div>`;
        }).join('');

        // Today now-line
        let nowLineHTML = '';
        if (isToday) {
            const nowMins = today.getHours() * 60 + today.getMinutes();
            if (nowMins >= WT_START * 60 && nowMins <= WT_END * 60) {
                const nowTop = ((nowMins - WT_START * 60) / 60) * WT_PX_PER_HOUR;
                nowLineHTML = `<div class="wt-now-line" style="top:${nowTop}px"></div>`;
            }
        }

        return `<div class="wt-day-col${isToday ? ' wt-today' : ''}">
        <div class="wt-day-header">
          <span class="wt-day-name">${dayName}</span>
          <span class="wt-day-date">${dateNum} ${monthStr}</span>
        </div>
        <div class="wt-col-body" style="height:${WT_PX_TOTAL}px">
          ${gridlinesHTML}
          ${blocksHTML}
          ${nowLineHTML}
        </div>
      </div>`;
    }).join('');

    const hasAnyItems = rtasks.some(rt => rt.days.length) || rslots.some(rs => rs.days.length) || slots.length;

    if (!hasAnyItems) {
        el.innerHTML = `<div class="wt-empty"><span style="font-size:28px;opacity:.4">📅</span><p>Add recurring tasks or free time windows to see the timetable.</p></div>`;
        return;
    }

    el.innerHTML = `
    <div class="wt-scroll-wrap">
      <div class="wt-ruler">
        <div class="wt-ruler-inner" style="height:46px"></div>
        <div class="wt-ruler-inner" style="${rulerInnerStyle}position:relative">${hourLabels}</div>
      </div>
      <div class="wt-grid">${colsHTML}</div>
    </div>`;
}

// ──── REFRESH ALL ─────────────────────────────────────────────────────────────
function refresh() {
    renderTasks();
    renderFreeTime();
    renderRecurringTasks();
    renderRecurringSlots();
    scheduleTasks();          // renders schedule, timeline, insights, risk, momentum
    renderConflictPanel();    // NEW: conflict detection
    buildWeeklyTimetable();   // NEW: visual weekly grid
    renderHeaderStats();
    renderBehaviorInsights(); // NEW: behavior insights
}

// ──── LIVE CLOCK ──────────────────────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const el = document.getElementById('hLive');
    if (el) el.textContent = `${h}:${m}`;
}

// ──── ESCAPE HTML ─────────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ──── FLASH FEEDBACK ──────────────────────────────────────────────────────────
function flashSuccess(inputId, msg) {
    const el = document.getElementById(inputId);
    if (!el) return;
    const orig = el.style.borderColor;
    el.style.borderColor = '#06d6a0';
    setTimeout(() => { el.style.borderColor = orig; }, 1000);
}

// ──── SET DEFAULT DATES ───────────────────────────────────────────────────────
function setDefaultDates() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');

    const deadlineInput = document.getElementById('taskDeadline');
    if (deadlineInput) deadlineInput.min = `${yyyy}-${mm}-${dd}T${hh}:${min}`;

    const ftDate = document.getElementById('ftDate');
    if (ftDate) { ftDate.value = `${yyyy}-${mm}-${dd}`; ftDate.min = `${yyyy}-${mm}-${dd}`; }

    const ftStart = document.getElementById('ftStart');
    const ftEnd = document.getElementById('ftEnd');
    if (ftStart) ftStart.value = `${hh}:${min}`;
    if (ftEnd) {
        const endD = new Date(now.getTime() + 60 * 60000);
        ftEnd.value = `${String(endD.getHours()).padStart(2, '0')}:${String(endD.getMinutes()).padStart(2, '0')}`;
    }
}

// ──── ADVANCED REGRET SIMULATOR ────────────────────────────────────────────────
function openRegretSimulator(taskId, taskName) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    document.getElementById('rsTaskName').textContent = taskName;
    const modal = document.getElementById('regretModal');
    modal.classList.remove('hidden');

    let score = 0;
    if (task.importance === 'High') score += 40;
    else if (task.importance === 'Medium') score += 20;

    const hoursUntilDeadline = (new Date(task.deadline) - new Date()) / 36e5;
    if (hoursUntilDeadline < 24) score += 40;
    else if (hoursUntilDeadline < 48) score += 20;

    score = Math.min(score + Math.floor(Math.random() * 15), 98);

    const dial = document.getElementById('rsDialContainer');
    const valEl = document.getElementById('rsScoreValue');
    const descEl = document.getElementById('rsScoreDesc');

    valEl.textContent = '0%';
    if (dial) dial.style.background = `conic-gradient(var(--urgent-red) 0%, var(--bg3) 0%)`;
    descEl.textContent = "Analyzing impact...";

    const dominoEl = document.getElementById('rsDominoEffect');
    dominoEl.innerHTML = '';

    setTimeout(() => {
        valEl.textContent = `${score}%`;
        if (dial) dial.style.background = `conic-gradient(var(--urgent-red) ${score}%, var(--bg3) ${score}%)`;

        if (score > 70) descEl.textContent = "High Risk: Delaying will likely cause stress.";
        else if (score > 40) descEl.textContent = "Medium Risk: Manageable but not ideal.";
        else descEl.textContent = "Low Risk: Flexible deadline.";

        const upcoming = [...tasks]
            .filter(t => t.id !== task.id && t.status !== 'completed')
            .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
            .slice(0, 2);

        let chainHTML = `<div class="domino-item delayed-item">${escHtml(task.name)}</div>`;
        upcoming.forEach((t) => {
            chainHTML += `<div class="domino-arrow">➔</div><div class="domino-item">${escHtml(t.name)} delayed</div>`;
        });

        if (upcoming.length === 0) {
            chainHTML += `<div class="domino-arrow">➔</div><div class="domino-item">Free Time Reduced</div>`;
        }

        dominoEl.innerHTML = chainHTML;

        // Populate dynamic actions
        const actionsEl = document.getElementById('rsSmartActions');
        actionsEl.innerHTML = `
            <button class="btn-primary" onclick="closeRegretSimulator(); startProcrastination('${task.id}', '${task.name}')">Start Soon</button>
            <button class="btn-secondary" onclick="closeRegretSimulator()">Cancel</button>
        `;
    }, 600);
}

function closeRegretSimulator() {
    document.getElementById('regretModal').classList.add('hidden');
}

// ──── PRODUCTIVITY & BEHAVIOR INSIGHTS ─────────────────────────────────────────

function renderInsights() {
    const panel = document.getElementById('insightPanel');
    if (!panel) return;

    // One-time stats
    const totalOneTime = tasks.length;
    const compOneTime = tasks.filter(t => t.status === 'completed').length;

    // Recurring stats
    // rstats contains completion records: { "rtask_id": { completedDates: ["2023-10-01"] } }
    const todayStr = new Date().toISOString().slice(0, 10);
    const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayDayName = DAY_NAMES_SHORT[new Date().getDay()];

    const activeRec = rtasks.filter(rt => rt.days.includes(todayDayName));
    const totalRec = activeRec.length;
    let compRec = 0;
    activeRec.forEach(rt => {
        if (rstats[rt.id]?.completedDates?.includes(todayStr)) compRec++;
    });

    const totalComp = compOneTime + compRec;
    const totalAll = totalOneTime + totalRec;
    const rate = totalAll > 0 ? Math.round((totalComp / totalAll) * 100) : 0;

    let msg = "Let's get started!";
    if (rate === 100 && totalAll > 0) msg = "Perfect day! 🎉";
    else if (rate > 70) msg = "Great momentum! 🔥";
    else if (rate > 40) msg = "Making steady progress. 🌱";

    panel.innerHTML = `
        <div class="insight-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div class="stats-card" style="background:var(--bg3); padding:15px; border-radius:var(--radius); border:1px solid var(--border);">
                <div style="font-size:11px; color:var(--text3); font-weight:700;">OVERALL PRODUCTIVITY</div>
                <div style="font-size:24px; font-weight:900; margin:5px 0; color:var(--primary);">${rate}%</div>
                <div style="font-size:12px;">${msg}</div>
            </div>
            <div class="stats-card" style="background:var(--bg3); padding:15px; border-radius:var(--radius); border:1px solid var(--border);">
                <div style="font-size:11px; color:var(--text3); font-weight:700;">TASKS COMPLETED</div>
                <div style="font-size:24px; font-weight:900; margin:5px 0;">${totalComp} <span style="font-size:14px; color:var(--text3)">/ ${totalAll}</span></div>
                <div style="font-size:11px; color:var(--text2);">One-Time: ${compOneTime} | Recurring: ${compRec}</div>
            </div>
        </div>
    `;
}

function renderBehaviorInsights() {
    const pane = document.getElementById('behaviorPanel');
    const header = document.getElementById('behaviorPanelHeader');
    if (!pane || typeof delayHistory === 'undefined') return;

    if (!delayHistory || delayHistory.length === 0) {
        pane.classList.remove('hidden');
        header.classList.remove('hidden');
        pane.innerHTML = `
            <div class="stats-card" style="background:var(--bg3); padding:15px; border-radius:var(--radius); border:1px solid var(--border); text-align:center;">
                <div style="font-size:24px; margin-bottom:5px;">🏆</div>
                <div style="font-weight:700; color:var(--teal);">Zero procrastinations recorded! 🎉</div>
                <div style="font-size:12px; color:var(--text2); margin-top:5px;">Keep up the fantastic focus!</div>
            </div>`;
        return;
    }

    pane.classList.remove('hidden');
    header.classList.remove('hidden');

    const totalDelays = delayHistory.length;
    const avgDelay = Math.round(delayHistory.reduce((s, x) => s + x.delaySeconds, 0) / totalDelays);
    const avgMins = Math.floor(avgDelay / 60);
    const avgSecs = avgDelay % 60;

    const distractionCounts = {};
    delayHistory.forEach(h => {
        h.distractions.forEach(d => {
            distractionCounts[d] = (distractionCounts[d] || 0) + 1;
        });
    });

    let topDistraction = "None";
    let maxD = 0;
    for (const [d, count] of Object.entries(distractionCounts)) {
        if (count > maxD) { maxD = count; topDistraction = d; }
    }

    const worstTask = [...delayHistory].sort((a, b) => b.delaySeconds - a.delaySeconds)[0];

    pane.innerHTML = `
        <div class="insight-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div class="stats-card" style="background:var(--bg3); padding:15px; border-radius:var(--radius); border:1px solid var(--border);">
                <div style="font-size:11px; color:var(--text3); font-weight:700;">PROCRASTINATION HABITS</div>
                <div style="font-size:13px; margin-top:8px;">⏱ Avg Delay: <b>${avgMins}m ${avgSecs}s</b></div>
                <div style="font-size:13px; margin-top:4px;">📱 Top Distraction: <b>${topDistraction}</b></div>
            </div>
            <div class="stats-card" style="background:var(--bg3); padding:15px; border-radius:var(--radius); border:1px solid var(--border);">
                <div style="font-size:11px; color:var(--text3); font-weight:700;">MOST AVOIDED TASK</div>
                <div style="font-size:13px; margin-top:8px; font-weight:bold; color:var(--urgent-red);">${escHtml(worstTask.taskName)}</div>
                <div style="font-size:12px; color:var(--text2); margin-top:4px;">Delayed by ${Math.floor(worstTask.delaySeconds / 60)} mins</div>
            </div>
        </div>
    `;
}

// ──── COMPLETE TASKS & CONFETTI ───────────────────────────────────────────────
function fireConfetti() {
    if (typeof confetti === 'function') {
        confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#6c63ff', '#ff4d6d', '#00c9a7', '#ffb055', '#a89bff']
        });
    }
}

function completeTask(id) {
    const t = tasks.find(x => x.id === id);
    if (!t) return;

    t.status = 'completed';
    LS.set(KEYS.TASKS, tasks);

    fireConfetti();
    refresh();
}

function markRecurringDone(rtId) {
    const todayStr = new Date().toISOString().slice(0, 10);

    if (!rstats[rtId]) {
        rstats[rtId] = { completedDates: [] };
    }

    if (!rstats[rtId].completedDates.includes(todayStr)) {
        rstats[rtId].completedDates.push(todayStr);
        localStorage.setItem(KEYS.RSTATS, JSON.stringify(rstats));
        fireConfetti();
        refresh();
    }
}

// ──── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    setDefaultDates();
    tasks = LS.get(KEYS.TASKS);
    slots = LS.get(KEYS.SLOTS);
    rtasks = LS.get(KEYS.RTASKS);
    rslots = LS.get(KEYS.RSLOTS);
    rstats = (() => { try { return JSON.parse(localStorage.getItem(KEYS.RSTATS)) || {}; } catch { return {}; } })();
    refresh();
    updateClock();
    setInterval(updateClock, 30000);
    // Re-check start-now every minute
    setInterval(checkStartNow, 60000);
});
