// Derived stats over the workout log: weeks, weekly goal and streak, volume, lift trends,
// personal records and the history calendar. Pure functions, so they can be unit tested
// in Node (see tests/stats.test.js). Weeks run Monday to Sunday in local time.

const DAY_MS = 86400000;

// "YYYY-MM-DD" for a date in local time.
function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
// Local midnight of the Monday that starts the week containing `d`.
function weekStartDate(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const weekKey = d => dayKey(weekStartDate(d));
// The Monday `n` weeks before the week containing `d` (setDate handles DST and month ends).
function weeksBefore(d, n) {
  const x = weekStartDate(d);
  x.setDate(x.getDate() - 7 * n);
  return x;
}

// Strength workouts only (activities have no exercises to lift).
const isStrength = w => w.type !== 'activity' && Array.isArray(w.exercises) && w.exercises.length > 0;
// Heaviest weight in a logged exercise, including every set when a set log exists.
const maxWeight = e => Math.max(e.weight || 0, ...(Array.isArray(e.log) ? e.log.map(s => s.weight || 0) : []));
// lb moved: sets × reps × weight, skipping timed sets.
const entryVolume = w => (w.exercises || []).reduce((sum, e) => sum + (e.unit ? 0 : (e.sets || 0) * (e.reps || 0) * (e.weight || 0)), 0);

// Number of distinct days with anything logged in the week starting `weekStartKey`.
function activeDaysInWeek(workouts, weekStartKey) {
  const days = new Set();
  for (const w of workouts) if (weekKey(w.date) === weekStartKey) days.add(dayKey(w.date));
  return days.size;
}

// The goal that applied to a week. `goalHistory` is [{ week, goal }]: a goal change takes
// effect from its week onwards, so past weeks keep the goal they had.
function goalForWeek(weekStartKey, settings) {
  const history = [...(settings.goalHistory || [])].sort((a, b) => a.week.localeCompare(b.week));
  let goal = null;
  for (const g of history) if (g.week <= weekStartKey) goal = g.goal;
  return goal ?? history[0]?.goal ?? settings.weeklyGoal;
}
// Returns new settings with `goal` applied from the current week on.
function withGoal(settings, goal, now = Date.now()) {
  const week = weekKey(now);
  let history = [...(settings.goalHistory || [])];
  // Record the goal that applied until now, so earlier weeks keep it.
  if (!history.length) history.push({ week: '0000-01-01', goal: settings.weeklyGoal });
  history = history.filter(g => g.week !== week).concat({ week, goal });
  return { ...settings, weeklyGoal: goal, goalHistory: history };
}

// This week's progress toward the goal.
function weekProgress(workouts, settings, now = Date.now()) {
  const key = weekKey(now);
  const goal = goalForWeek(key, settings);
  const done = activeDaysInWeek(workouts, key);
  return { done, goal, met: done >= goal };
}

// Consecutive weeks that hit their goal. The current week counts once it hits the goal;
// until then it doesn't break the streak.
function goalStreak(workouts, settings, now = Date.now()) {
  const counts = {};
  const days = new Set();
  for (const w of workouts) {
    const d = dayKey(w.date);
    if (days.has(d)) continue;
    days.add(d);
    const k = weekKey(w.date);
    counts[k] = (counts[k] || 0) + 1;
  }
  let streak = 0;
  for (let i = 0; i < 520; i++) {
    const k = dayKey(weeksBefore(now, i));
    const met = (counts[k] || 0) >= goalForWeek(k, settings);
    if (met) streak++;
    else if (i > 0) break;
  }
  return streak;
}

// lb moved per week for the last `n` weeks, oldest first.
function weeklyVolume(workouts, n = 8, now = Date.now()) {
  const weeks = Array.from({ length: n }, (_, i) => ({ week: dayKey(weeksBefore(now, n - 1 - i)), volume: 0 }));
  const index = Object.fromEntries(weeks.map((w, i) => [w.week, i]));
  for (const w of workouts) {
    const i = index[weekKey(w.date)];
    if (i !== undefined && isStrength(w)) weeks[i].volume += entryVolume(w);
  }
  return weeks;
}

// Lifts whose top weight went up over their last `sessions` sessions, biggest gain first.
function liftTrends(workouts, { sessions = 6, top = 3 } = {}) {
  const byName = {};
  for (const w of [...workouts].sort((a, b) => new Date(a.date) - new Date(b.date))) {
    if (!isStrength(w)) continue;
    for (const e of w.exercises) {
      if (e.unit) continue;
      const m = maxWeight(e);
      if (m > 0) (byName[e.name] = byName[e.name] || []).push(m);
    }
  }
  return Object.entries(byName)
    .map(([name, all]) => { const values = all.slice(-sessions); return { name, values, from: values[0], to: values[values.length - 1] }; })
    .filter(t => t.values.length >= 2 && t.to > t.from)
    .sort((a, b) => (b.to - b.from) - (a.to - a.from) || b.to - a.to)
    .slice(0, top);
}

// Ids of strength entries where some exercise beat the heaviest weight logged for it before.
function personalRecords(workouts) {
  const best = {}, prs = new Set();
  for (const w of [...workouts].sort((a, b) => new Date(a.date) - new Date(b.date))) {
    if (!isStrength(w)) continue;
    for (const e of w.exercises) {
      if (e.unit) continue;
      const m = maxWeight(e);
      if (m > 0 && best[e.name] !== undefined && m > best[e.name]) prs.add(String(w.id));
      if (m > 0) best[e.name] = Math.max(best[e.name] || 0, m);
    }
  }
  return prs;
}

// The last `days` days, oldest first: 'strength', 'activity' or null for each day.
function calendarDays(workouts, days = 30, now = Date.now()) {
  const kinds = {};
  for (const w of workouts) {
    const k = dayKey(w.date);
    if (isStrength(w)) kinds[k] = 'strength';
    else if (!kinds[k]) kinds[k] = 'activity';
  }
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (days - 1 - i));
    return { day: dayKey(d), kind: kinds[dayKey(d)] || null };
  });
}

if (typeof module === 'object') {
  module.exports = { dayKey, weekKey, weeksBefore, entryVolume, maxWeight, activeDaysInWeek, goalForWeek, withGoal,
    weekProgress, goalStreak, weeklyVolume, liftTrends, personalRecords, calendarDays };
}
