// Unit tests for stats.js. Run with: node tests/stats.test.js
process.env.TZ = 'America/Los_Angeles';
const assert = require('assert');
const S = require('../stats.js');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (err) { failures++; console.log('FAIL', name, '\n  ', err.message); }
}

// Local-time helpers. Mon Oct 5 2026 is a Monday.
const at = (day, hour = 9) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).toISOString();
const NOW = new Date('2026-10-07T18:00:00').getTime(); // Wednesday
const lift = (day, exercises, extra = {}) => ({ id: day + (extra.id || ''), date: at(day, extra.hour), region: 'upper', duration: 30, exercises, ...extra });
const act = (day, hour) => ({ id: day + 'a' + hour, date: at(day, hour), type: 'activity', activity: 'Walk', duration: 30, exercises: [] });
const settings = (goal = 3, goalHistory = []) => ({ weeklyGoal: goal, goalHistory });

test('weeks start on Monday in local time', () => {
  assert.strictEqual(S.weekKey(at('2026-10-05')), '2026-10-05');
  assert.strictEqual(S.weekKey(at('2026-10-11', 23)), '2026-10-05'); // Sunday night
  assert.strictEqual(S.weekKey(at('2026-10-12', 0)), '2026-10-12');
  // Late evening UTC-7 is already the next day in UTC; the local week must win.
  assert.strictEqual(S.weekKey(new Date('2026-10-11T23:30:00').toISOString()), '2026-10-05');
});

test('weeksBefore crosses the DST change cleanly', () => {
  assert.strictEqual(S.dayKey(S.weeksBefore(new Date('2026-11-04T12:00:00'), 1)), '2026-10-26');
  assert.strictEqual(S.dayKey(S.weeksBefore(new Date('2026-11-04T12:00:00'), 0)), '2026-11-02');
});

test('a walk and a lift on the same day count as one active day', () => {
  const w = [lift('2026-10-05', [{ name: 'Row', sets: 3, reps: 10, weight: 40 }]), act('2026-10-05', 18), act('2026-10-06', 8)];
  assert.deepStrictEqual(S.weekProgress(w, settings(3), NOW), { done: 2, goal: 3, met: false });
});

test('streak counts consecutive weeks that hit the goal', () => {
  const w = [
    act('2026-09-21'), act('2026-09-22'),                      // 2 days: met for goal 2
    act('2026-09-28'), act('2026-09-29'), act('2026-09-30'),   // 3 days
    act('2026-10-05'),                                          // current week, not met yet
  ];
  assert.strictEqual(S.goalStreak(w, settings(2), NOW), 2, 'current week in progress does not break it');
  assert.strictEqual(S.goalStreak([...w, act('2026-10-06')], settings(2), NOW), 3, 'current week counts once met');
  assert.strictEqual(S.goalStreak(w, settings(3), NOW), 1, 'a missed week ends the streak');
  assert.strictEqual(S.goalStreak([], settings(3), NOW), 0);
});

test('goal changes apply from their week and keep past weeks', () => {
  let s = settings(2);
  s = S.withGoal(s, 4, new Date('2026-10-06T10:00:00').getTime());
  assert.strictEqual(s.weeklyGoal, 4);
  assert.strictEqual(S.goalForWeek('2026-09-28', s), 2);
  assert.strictEqual(S.goalForWeek('2026-10-05', s), 4);
  // Changing again in the same week replaces that week's entry.
  s = S.withGoal(s, 5, NOW);
  assert.strictEqual(s.goalHistory.filter(g => g.week === '2026-10-05').length, 1);
  assert.strictEqual(S.goalForWeek('2026-10-05', s), 5);
  const w = [act('2026-09-28'), act('2026-09-29'), act('2026-10-05'), act('2026-10-06'), act('2026-10-07')];
  assert.strictEqual(S.goalStreak(w, s, NOW), 1, 'last week met its old goal of 2; this week needs 5');
});

test('weekly volume skips timed sets and activities', () => {
  const w = [
    lift('2026-10-05', [{ name: 'Press', sets: 3, reps: 10, weight: 40 }, { name: 'Plank', sets: 3, reps: 45, weight: 0, unit: 'sec' }]),
    lift('2026-09-29', [{ name: 'Squat', sets: 2, reps: 10, weight: 50 }]),
    act('2026-10-06'),
  ];
  const v = S.weeklyVolume(w, 8, NOW);
  assert.strictEqual(v.length, 8);
  assert.strictEqual(v[7].week, '2026-10-05');
  assert.strictEqual(v[7].volume, 1200);
  assert.strictEqual(v[6].volume, 1000);
  assert.strictEqual(v[0].volume, 0);
});

test('lift trends rank by weight gain and use the set log when present', () => {
  const w = [
    lift('2026-09-01', [{ name: 'Bench', sets: 3, reps: 8, weight: 35 }, { name: 'Curl', sets: 3, reps: 10, weight: 20 }]),
    lift('2026-09-08', [{ name: 'Bench', sets: 3, reps: 8, weight: 40 }, { name: 'Curl', sets: 3, reps: 10, weight: 20 }]),
    lift('2026-09-15', [{ name: 'Bench', sets: 3, reps: 8, weight: 40, log: [{ reps: 8, weight: 45 }, { reps: 6, weight: 40 }] }, { name: 'Curl', sets: 3, reps: 10, weight: 25 }]),
    lift('2026-09-22', [{ name: 'Row', sets: 3, reps: 10, weight: 40 }, { name: 'Plank', sets: 3, reps: 60, weight: 0, unit: 'sec' }]),
  ];
  const t = S.liftTrends(w);
  assert.deepStrictEqual(t.map(x => [x.name, x.from, x.to]), [['Bench', 35, 45], ['Curl', 20, 25]]);
  assert.deepStrictEqual(t[0].values, [35, 40, 45]);
});

test('personal records need an earlier, lighter occurrence', () => {
  const w = [
    lift('2026-09-01', [{ name: 'Bench', sets: 3, reps: 8, weight: 40 }]),
    lift('2026-09-08', [{ name: 'Bench', sets: 3, reps: 8, weight: 40 }]),
    lift('2026-09-15', [{ name: 'Bench', sets: 3, reps: 8, weight: 45 }]),
  ];
  assert.deepStrictEqual([...S.personalRecords(w)], ['2026-09-15']);
});

test('calendar marks strength over activity on the same day', () => {
  const w = [act('2026-10-07', 7), lift('2026-10-07', [{ name: 'Row', sets: 3, reps: 10, weight: 40 }]), act('2026-10-01')];
  const c = S.calendarDays(w, 30, NOW);
  assert.strictEqual(c.length, 30);
  assert.deepStrictEqual(c[29], { day: '2026-10-07', kind: 'strength' });
  assert.deepStrictEqual(c[23], { day: '2026-10-01', kind: 'activity' });
  assert.strictEqual(c[0].day, '2026-09-08');
});

console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
process.exitCode = failures ? 1 : 0;
