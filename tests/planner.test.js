// Unit tests for planner.js. Run with: node tests/planner.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// exercises.js and planner.js are browser scripts that share globals, so load both into one context.
const ctx = { Math };
vm.createContext(ctx);
for (const f of ['exercises.js', 'planner.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
const P = vm.runInContext('({ sessionBudget, matchLibrary, candidateExercises, planMinutes, fitPlan, libraryPlan, buildPlanPrompts, REGIONS, LIBRARY, EQUIPMENT_PRESETS })', ctx);

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (err) { failures++; console.log('FAIL', name, '\n  ', err.message); }
}
const equipment = ['Dumbbells', 'Bench', 'Resistance bands'];
const opts = (region, minutes, extra) => ({ region, minutes, equipment, ...extra });

test('session kinds follow focus and length', () => {
  assert.strictEqual(P.sessionBudget('upper', 15).kind, 'quick');
  assert.strictEqual(P.sessionBudget('upper', 30).kind, 'strength');
  assert.strictEqual(P.sessionBudget('cardio', 20).kind, 'quick');
  assert.strictEqual(P.sessionBudget('mobility', 15).kind, 'recovery');
  assert.strictEqual(P.sessionBudget('mobility', 45).kind, 'mobility');
  assert.strictEqual(P.sessionBudget('core', 30).kind, 'core');
});

test('budget leaves time to warm up and allows ~10% over', () => {
  const b15 = P.sessionBudget('full', 15), b45 = P.sessionBudget('full', 45);
  assert.strictEqual(b15.work, 13); assert.strictEqual(b15.max, 15);
  assert.strictEqual(b45.work, 42); assert.strictEqual(b45.max, 47);
});

test('library plans fit every focus and length (soft cap of 8 for strength)', () => {
  for (const region of Object.keys(P.REGIONS)) {
    for (const minutes of [10, 15, 20, 30, 45, 60]) {
      for (let run = 0; run < 5; run++) {
        const b = P.sessionBudget(region, minutes);
        const plan = P.libraryPlan(opts(region, minutes));
        const t = P.planMinutes(plan);
        assert.ok(plan.length >= 1, `${region} ${minutes}: empty plan`);
        assert.ok(t <= b.max, `${region} ${minutes}: ${t.toFixed(1)} min is over ${b.max}`);
        assert.ok(plan.length <= b.maxCount, `${region} ${minutes}: ${plan.length} exercises`);
        if (b.style === 'strength') assert.ok(plan.length <= 8);
        // Single-group focuses can run out of exercises, so only check fullness for wider ones.
        if (['full', 'upper', 'lower', 'mobility'].includes(region)) {
          assert.ok(t >= b.min, `${region} ${minutes}: only ${t.toFixed(1)} of ${b.work} min`);
        }
      }
    }
  }
});

test('mobility plans have no weight and fill 45 minutes with more moves or rounds', () => {
  const plan = P.libraryPlan(opts('mobility', 45));
  assert.ok(plan.every(e => e.weight === 0));
  assert.ok(P.planMinutes(plan) >= P.sessionBudget('mobility', 45).min);
});

test('a short AI mobility plan is topped up and loses its weights', () => {
  const ai = [
    { name: 'Resistance band dislocates', sets: 3, reps: 12, weight: 0 },
    { name: 'Bench pigeon stretch', sets: 3, reps: 45, weight: 0, unit: 'sec' },
    { name: 'Dumbbell overhead carry stretch', sets: 3, reps: 60, weight: 10, unit: 'sec' },
  ];
  const plan = P.fitPlan(ai, opts('mobility', 45));
  assert.ok(P.planMinutes(plan) >= P.sessionBudget('mobility', 45).min, `${P.planMinutes(plan)} min`);
  assert.ok(plan.every(e => e.weight === 0));
  assert.strictEqual(plan[0].name, 'Resistance band dislocates'); // the AI's picks stay first
});

test('an AI plan that runs long is trimmed, sets first', () => {
  const ai = Array.from({ length: 6 }, (_, i) => ({ name: ['Goblet squat', 'Dumbbell bench press', 'One-arm dumbbell row', 'Arnold press', 'Hammer curl', 'Plank'][i], sets: 4, reps: 10, weight: 30 }));
  const plan = P.fitPlan(ai, opts('full', 15));
  assert.ok(P.planMinutes(plan) <= P.sessionBudget('full', 15).max);
  assert.ok(plan.length <= 4, `${plan.length} exercises in a quick session`);
  assert.ok(plan.every(e => e.sets <= 3));
});

test('a plan that is a little short is left alone', () => {
  const ai = [
    { name: 'Goblet squat', sets: 3, reps: 10, weight: 50 }, { name: 'Dumbbell bench press', sets: 3, reps: 10, weight: 45 },
    { name: 'One-arm dumbbell row', sets: 3, reps: 10, weight: 40 }, { name: 'Arnold press', sets: 3, reps: 10, weight: 25 },
  ];
  const plan = P.fitPlan(ai, opts('full', 30)); // ~22 of 27 work minutes: within 80%
  assert.strictEqual(JSON.stringify(plan.map(e => e.name)), JSON.stringify(ai.map(e => e.name)));
  assert.ok(plan.every(e => e.sets === 3));
});

test('AI names are matched to the library', () => {
  assert.strictEqual(P.matchLibrary('Dumbbell goblet squat').name, 'Goblet squat');
  assert.strictEqual(P.matchLibrary('dumbbell bench press').name, 'Dumbbell bench press');
  assert.strictEqual(P.matchLibrary('Mountain climbers').name, 'Mountain climber');
  assert.strictEqual(P.matchLibrary('Side plank').name, 'Side plank (each side)');
  assert.strictEqual(P.matchLibrary('Dumbbell overhead carry stretch'), null);
  const plan = P.fitPlan([{ name: 'Dumbbell goblet squat', sets: 3, reps: 10, weight: 50 }], opts('lower', 30));
  assert.strictEqual(plan[0].name, 'Goblet squat');
});

test('an amount in the wrong unit falls back to the library amount', () => {
  const plan = P.fitPlan([{ name: 'Cat-cow', sets: 1, reps: 60, weight: 0, unit: 'sec' }, { name: "Child's pose", sets: 2, reps: 90, weight: 0, unit: 'sec' }], opts('mobility', 20));
  assert.strictEqual(plan[0].reps, 10);           // library: 2x10 reps, not 60
  assert.strictEqual(plan[1].reps, 90);           // same unit: the AI's longer hold is kept
});

test('trimming takes sets before shortening a steady block', () => {
  const ai = [{ name: 'Brisk walk', sets: 1, reps: 10, weight: 0, unit: 'min' }, { name: 'Shadow boxing', sets: 3, reps: 5, weight: 0, unit: 'min' },
    { name: 'Jumping jacks', sets: 3, reps: 45, weight: 0, unit: 'sec' }];
  const plan = P.fitPlan(ai, opts('cardio', 30));
  assert.ok(P.planMinutes(plan) <= P.sessionBudget('cardio', 30).max);
  assert.strictEqual(plan.find(e => e.name === 'Brisk walk').reps, 10);
});

test('long cardio can be one steady block', () => {
  const plan = P.fitPlan([{ name: 'Brisk walk', sets: 1, reps: 40, weight: 0, unit: 'min' }], opts('cardio', 45));
  assert.strictEqual(plan.length, 1);
  assert.ok(P.planMinutes(plan) <= P.sessionBudget('cardio', 45).max);
});

test('candidates respect equipment and cover the focus groups', () => {
  const c = P.candidateExercises('upper', ['Dumbbells']);
  assert.ok(c.every(ex => ex.needs.every(n => n === 'Dumbbells')));
  assert.strictEqual([...new Set(c.slice(0, 5).map(ex => ex.group))].sort().join(), 'back,biceps,chest,shoulders,triceps');
});

test('prompts stay under the Worker limits and match the session kind', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ date: '2026-10-0' + (i % 9 + 1), focus: 'Full body',
    exercises: Array.from({ length: 8 }, (_, j) => `Some fairly long exercise name number ${j} 4x12@45lb`) }));
  for (const region of Object.keys(P.REGIONS)) {
    for (const minutes of [15, 30, 60]) {
      const all = [...P.EQUIPMENT_PRESETS];
      const { system, prompt } = P.buildPlanPrompts({ region, minutes, equipment: all, history, today: '2026-10-06',
        candidates: P.candidateExercises(region, all) });
      assert.ok(system.length <= 4000, `${region} ${minutes}: system ${system.length}`);
      assert.ok(prompt.length <= 6000, `${region} ${minutes}: prompt ${prompt.length}`);
    }
  }
  const mob = P.buildPlanPrompts({ region: 'mobility', minutes: 45, equipment, today: 'x', candidates: P.candidateExercises('mobility', equipment) });
  assert.ok(/Mobility session/.test(mob.system) && !/Strength session/.test(mob.system));
  assert.ok(/Plan about 10 exercises/.test(mob.prompt), mob.prompt);
  const rec = P.buildPlanPrompts({ region: 'mobility', minutes: 15, equipment, today: 'x', candidates: [] });
  assert.ok(/Recovery session/.test(rec.system));
  const quick = P.buildPlanPrompts({ region: 'upper', minutes: 15, equipment, today: 'x', candidates: [] });
  assert.ok(/Quick session/.test(quick.system) && /quick workout, 15 minutes/.test(quick.prompt));
});

console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
process.exitCode = failures ? 1 : 0;
