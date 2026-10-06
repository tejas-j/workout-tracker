// Session planning. Turns the minutes and focus into a time budget, builds library plans,
// and fits any plan (library or AI) to that budget. The AI picks exercises and weights;
// this code has the final say on how many exercises and sets fit the time.
// Pure functions over the globals in exercises.js; unit tested in tests/planner.test.js.

// Per-style limits. perMove is a rough minutes-per-exercise used for the target count.
const PLAN_STYLES = {
  strength: { label: 'Strength', sets: [3, 5], defaultSets: 3, perMove: 6.5, maxCount: 8 },
  core:     { label: 'Core',     sets: [2, 4], defaultSets: 3, perMove: 5,   maxCount: 6 },
  cardio:   { label: 'Cardio',   sets: [1, 8], defaultSets: null, perMove: 7, maxCount: 5 },
  mobility: { label: 'Mobility', sets: [1, 5], defaultSets: 2, perMove: 2.8, maxCount: 10 },
};
// Sessions of 20 minutes or less: quick workouts, or recovery for mobility.
const SHORT_SESSION = 20;
const QUICK = { sets: [2, 3], defaultSets: 2, perMove: 4, maxCount: 4 };
const RECOVERY = { sets: [1, 3], defaultSets: 2, perMove: 2.8, maxCount: 6 };

const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const styleOf = region => region === 'mobility' ? 'mobility' : region === 'cardio' ? 'cardio' : region === 'core' ? 'core' : 'strength';

// The time budget for a session. `work` excludes warm-up and cool-down; plans may run
// over it by ~10% (at least a minute), and count as too short below 80% of it.
function sessionBudget(region, minutes) {
  const style = styleOf(region);
  const short = minutes <= SHORT_SESSION;
  const kind = !short ? style : style === 'mobility' ? 'recovery' : 'quick';
  const limits = { ...PLAN_STYLES[style], ...(kind === 'quick' && style !== 'cardio' ? QUICK : {}), ...(kind === 'recovery' ? RECOVERY : {}) };
  if (kind === 'quick' && style === 'cardio') limits.maxCount = QUICK.maxCount;
  const warmup = minutes <= 15 ? 2 : 3;
  const work = Math.max(4, minutes - warmup);
  return {
    region, minutes, style, kind, work,
    max: work + Math.max(1, Math.round(minutes * 0.1)),
    min: work * 0.8,
    count: clampNum(Math.round(work / limits.perMove), 1, limits.maxCount),
    maxCount: limits.maxCount,
    sets: limits.sets,
    defaultSets: limits.defaultSets,
  };
}

// Library exercises the equipment allows.
function availableExercises(equipment) {
  const have = new Set(equipment.map(e => e.toLowerCase()));
  return LIBRARY.filter(ex => ex.needs.every(n => have.has(n.toLowerCase())));
}

// Loose form of a name for matching: no case, brackets, "dumbbell", punctuation or plurals.
const looseName = s => String(s).toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\b(dumbbells?|db)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').replace(/(\w)s\b/g, '$1').trim();

// The library entry for a name (exact first, then loose, preferring what the equipment allows).
function matchLibrary(name, available = LIBRARY) {
  const lower = String(name).toLowerCase();
  const exact = LIBRARY.find(ex => ex.name.toLowerCase() === lower);
  if (exact) return exact;
  const loose = looseName(name);
  return available.find(ex => looseName(ex.name) === loose) || LIBRARY.find(ex => looseName(ex.name) === loose) || null;
}

// Library exercises for the focus, least recently done first (with some randomness so
// Shuffle varies), interleaved across the focus's muscle groups.
function candidateExercises(region, equipment, lastDone = {}, limit = 40) {
  const avail = availableExercises(equipment);
  const pools = REGIONS[region].groups.map(g => avail.filter(ex => ex.group === g)
    .map(ex => ({ ex, sort: (lastDone[ex.name] || 0) + Math.random() * 3 * 86400000 }))
    .sort((a, b) => a.sort - b.sort).map(x => x.ex));
  const out = [];
  for (let i = 0; out.length < limit && pools.some(p => p.length > i); i++) {
    for (const p of pools) if (p[i] && out.length < limit) out.push(p[i]);
  }
  return out;
}

const planItemMinutes = e => estimateMinutes({ ...e, group: e.group || groupOf(e.name) || '' });
const planMinutes = plan => plan.reduce((sum, e) => sum + planItemMinutes(e), 0);

function itemFromLibrary(ex, budget) {
  const sets = ex.unit === 'min' ? ex.sets : clampNum(budget.defaultSets ?? ex.sets, budget.sets[0], budget.sets[1]);
  return { name: ex.name, sets, reps: ex.reps, weight: 0, ...(ex.unit ? { unit: ex.unit } : {}), group: ex.group };
}

// Fits `exercises` to the session budget:
// - names are matched to the library so history, trends and swaps line up;
// - sets are kept in the session's range and the exercise count under its cap;
// - a plan that runs long loses sets, then exercises;
// - a plan that is too short (or any plan, with fill) gets exercises that fit the
//   remaining time, then extra sets, rounds or minutes.
function fitPlan(exercises, { region, minutes, equipment, lastDone = {}, fill = false }) {
  const budget = sessionBudget(region, minutes);
  const avail = availableExercises(equipment);
  const seen = new Set();
  let plan = [];
  for (const e of exercises) {
    const lib = matchLibrary(e.name, avail);
    const name = lib ? lib.name : e.name;
    if (seen.has(name)) continue;
    seen.add(name);
    const unit = lib ? lib.unit : e.unit;
    // If the AI counted in a different unit than the library (e.g. 60 "reps" of a timed
    // hold), its amount can't be trusted, so use the library's.
    const reps = lib && (lib.unit || 'reps') !== (e.unit || 'reps') ? lib.reps : Math.max(1, e.reps || lib?.reps || 10);
    const sets = unit === 'min' ? clampNum(e.sets || 1, 1, 3) : clampNum(e.sets || budget.sets[0], budget.sets[0], budget.sets[1]);
    plan.push({ name, sets, reps, weight: budget.style === 'mobility' ? 0 : Math.max(0, e.weight || 0),
      ...(unit ? { unit } : {}), group: lib ? lib.group : groupOf(e.name) });
  }
  plan = plan.slice(0, budget.maxCount);

  // Too long: drop a set from the exercise with the most sets, then shorten steady
  // blocks (never below 10 minutes), then drop exercises from the end.
  while (plan.length && planMinutes(plan) > budget.max) {
    const most = plan.reduce((a, e) => {
      const floor = e.unit === 'min' ? 1 : budget.sets[0];
      return e.sets > floor && e.sets > (a?.sets ?? 0) ? e : a;
    }, null);
    if (most) { most.sets--; continue; }
    const block = plan.filter(e => e.unit === 'min' && e.reps > 10).sort((a, b) => b.reps - a.reps)[0];
    if (block) { block.reps = Math.max(10, block.reps - 5); continue; }
    if (plan.length === 1) break;
    plan.pop();
  }

  // Too short: add exercises that fit, balancing muscle groups, then grow what's there.
  const target = fill || planMinutes(plan) < budget.min ? budget.work : 0;
  if (planMinutes(plan) < target) {
    const pool = candidateExercises(region, equipment, lastDone, 200).filter(ex => !plan.some(p => p.name === ex.name));
    const addExercises = upTo => {
      while (plan.length < upTo && planMinutes(plan) < target) {
        const room = budget.max - planMinutes(plan);
        const used = {};
        plan.forEach(p => { used[p.group] = (used[p.group] || 0) + 1; });
        const order = pool.map((ex, i) => ({ ex, i })).sort((a, b) => (used[a.ex.group] || 0) - (used[b.ex.group] || 0) || a.i - b.i);
        const pick = order.find(({ ex }) => planItemMinutes(itemFromLibrary(ex, budget)) <= room);
        if (!pick) return;
        pool.splice(pool.indexOf(pick.ex), 1);
        plan.push(itemFromLibrary(pick.ex, budget));
      }
    };
    const growExisting = () => {
      for (let grew = true; grew && planMinutes(plan) < target;) {
        grew = false;
        for (const e of plan) {
          if (planMinutes(plan) >= target) break;
          if (e.unit === 'min') {
            e.reps += 5;
            if (planMinutes(plan) > budget.max) e.reps -= 5; else grew = true;
          } else if (e.sets < budget.sets[1]) {
            e.sets++;
            if (planMinutes(plan) > budget.max) e.sets--; else grew = true;
          }
        }
      }
    };
    // Up to the usual number of exercises for this length, then more sets or rounds,
    // and only then more exercises (up to the cap).
    addExercises(Math.max(budget.count, plan.length));
    growExisting();
    addExercises(budget.maxCount);
    growExisting();
  }
  return plan.map(({ group, ...e }) => e);
}

// ---------- AI prompts ----------
// The system prompt is a shared base plus one block for the session's kind. Counts and
// minutes never go in here: they come from the budget in the user prompt, and fitPlan
// enforces them afterwards, so the same prompt works for any length.
const PROMPT_BASE = `You plan one home exercise session. Respond with JSON only.
Choose exercises from the candidate list and use their exact names. You may add at most one exercise that is not on the list, only if it clearly suits the session.
Use only the listed equipment; bodyweight is always available.
"unit" is "reps", "sec" (reps = seconds per set) or "min" (reps = minutes). "weight" is in lb, 0 for bodyweight.
Plan about the number of exercises asked for; the app fine-tunes sets to fit the time.
History may include sports and activities; account for their fatigue.
"focus" is a short label for the session. "reason" is one sentence of at most 20 words on why this session suits today. Mention something concrete from the history when there is any. No exclamation marks, no generic praise.`;

const PROMPT_KINDS = {
  strength: `Strength session. Balance the muscle groups within the focus. For an exercise in the history, start from its last weight and add 5 lb if every set was completed; otherwise choose a moderate weight. Go easier on muscles worked hard in the last two days. Vary exercises from recent sessions.`,
  quick: `Quick session: favour compound moves that train the most muscle in the least time, with short rests. Keep weights as in the history.`,
  core: `Core session. Mix anti-extension (e.g. plank, dead bug), anti-rotation (e.g. Pallof press, side plank) and flexion or rotation moves.`,
  mobility: `Mobility session: gentle and controlled, no added weight (weight 0). Use holds (unit "sec") or slow reps. Cover hips, spine, shoulders and hamstrings, and favour areas trained recently.`,
  recovery: `Recovery session: very gentle, no added weight (weight 0), longer holds and slow breathing. Favour the areas worked hardest in the last two days.`,
  cardio: `Cardio session, not lifting. Use timed intervals (unit "sec") or steady blocks (unit "min"); one long steady block such as a brisk walk is fine. Weights only for light, fast moves. Prefer low-impact options after hard leg days or long hikes.`,
};

const PLAN_KIND_LABELS = { strength: 'strength', quick: 'quick workout', core: 'core', mobility: 'mobility', recovery: 'recovery', cardio: 'cardio' };

// Builds the system and user prompts for a session. `history` is a list of recent entries
// (most recent first) as plain objects; it is shortened if the prompt would get too long.
function buildPlanPrompts({ region, minutes, equipment, candidates, history = [], today }) {
  const b = sessionBudget(region, minutes);
  const kind = b.kind === 'quick' && b.style === 'cardio' ? 'cardio' : b.kind;
  const system = `${PROMPT_BASE}\n${PROMPT_KINDS[kind]}${b.kind === 'quick' && kind === 'cardio' ? '\n' + PROMPT_KINDS.quick : ''}`;
  const byGroup = {};
  for (const ex of candidates) (byGroup[ex.group] = byGroup[ex.group] || []).push(ex.name);
  const label = REGIONS[region].label;
  const user = hist => `Today is ${today}.
Session: ${label}, ${PLAN_KIND_LABELS[b.kind]}, ${minutes} minutes including warm-up; about ${b.work} minutes of exercise.
Plan about ${b.count} exercise${b.count === 1 ? '' : 's'}.
Equipment: ${equipment.length ? equipment.join(', ') : 'none'}.
Candidates by muscle group: ${Object.entries(byGroup).map(([g, names]) => `${g}: ${names.join('; ')}`).join(' | ')}.
Recent history (most recent first): ${hist.length ? JSON.stringify(hist) : 'none logged yet'}.
Plan today's session.`;
  let hist = history.slice(0, 10);
  while (hist.length && user(hist).length > 5800) hist = hist.slice(0, -1);
  return { system, prompt: user(hist), budget: b };
}
// A plan built entirely from the library.
function libraryPlan({ region, minutes, equipment, lastDone = {} }) {
  return fitPlan([], { region, minutes, equipment, lastDone, fill: true });
}

if (typeof module === 'object') {
  module.exports = { sessionBudget, availableExercises, matchLibrary, candidateExercises, planMinutes, fitPlan, libraryPlan, buildPlanPrompts };
}
