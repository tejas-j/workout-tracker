// Curated exercise library used when no API key is set.
// groups: muscle group; needs: equipment tags that must ALL be available
// (bodyweight is always available); unit 'sec' means reps = seconds held.
const EQUIPMENT_PRESETS = ['Dumbbells', 'Bench', 'Pull-up bar', 'Resistance bands', 'Kettlebell', 'Barbell'];

const REGIONS = {
  full:      { label: 'Full body',  groups: ['legs', 'chest', 'back', 'shoulders', 'core', 'arms', 'full'] },
  upper:     { label: 'Upper body', groups: ['chest', 'back', 'shoulders', 'arms'] },
  lower:     { label: 'Lower body', groups: ['legs', 'core'] },
  chest:     { label: 'Chest',      groups: ['chest'] },
  back:      { label: 'Back',       groups: ['back'] },
  shoulders: { label: 'Shoulders',  groups: ['shoulders'] },
  arms:      { label: 'Arms',       groups: ['arms'] },
  legs:      { label: 'Legs',       groups: ['legs'] },
  core:      { label: 'Core',       groups: ['core'] }
};

const LIBRARY = [
  // chest
  { name: 'Push-up', group: 'chest', needs: [], sets: 3, reps: 12 },
  { name: 'Incline push-up (hands on bench)', group: 'chest', needs: ['Bench'], sets: 3, reps: 12 },
  { name: 'Diamond push-up', group: 'chest', needs: [], sets: 3, reps: 8 },
  { name: 'Dumbbell bench press', group: 'chest', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 10 },
  { name: 'Dumbbell incline press', group: 'chest', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 10 },
  { name: 'Dumbbell floor press', group: 'chest', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Dumbbell fly', group: 'chest', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 12 },
  // back
  { name: 'One-arm dumbbell row', group: 'back', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 10 },
  { name: 'Bent-over dumbbell row', group: 'back', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Renegade row', group: 'back', needs: ['Dumbbells'], sets: 3, reps: 8 },
  { name: 'Dumbbell pullover', group: 'back', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 12 },
  { name: 'Pull-up', group: 'back', needs: ['Pull-up bar'], sets: 3, reps: 6 },
  { name: 'Chin-up', group: 'back', needs: ['Pull-up bar'], sets: 3, reps: 6 },
  { name: 'Resistance band row', group: 'back', needs: ['Resistance bands'], sets: 3, reps: 15 },
  { name: 'Superman hold', group: 'back', needs: [], sets: 3, reps: 30, unit: 'sec' },
  // shoulders
  { name: 'Dumbbell shoulder press', group: 'shoulders', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Arnold press', group: 'shoulders', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Dumbbell lateral raise', group: 'shoulders', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Dumbbell front raise', group: 'shoulders', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Rear delt fly', group: 'shoulders', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Pike push-up', group: 'shoulders', needs: [], sets: 3, reps: 8 },
  { name: 'Band face pull', group: 'shoulders', needs: ['Resistance bands'], sets: 3, reps: 15 },
  // arms
  { name: 'Dumbbell biceps curl', group: 'arms', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Hammer curl', group: 'arms', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Concentration curl', group: 'arms', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Overhead triceps extension', group: 'arms', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Dumbbell skullcrusher', group: 'arms', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 10 },
  { name: 'Bench dips', group: 'arms', needs: ['Bench'], sets: 3, reps: 12 },
  { name: 'Close-grip push-up', group: 'arms', needs: [], sets: 3, reps: 10 },
  // legs
  { name: 'Bodyweight squat', group: 'legs', needs: [], sets: 3, reps: 15 },
  { name: 'Goblet squat', group: 'legs', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Dumbbell Romanian deadlift', group: 'legs', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Reverse lunge', group: 'legs', needs: [], sets: 3, reps: 10 },
  { name: 'Dumbbell walking lunge', group: 'legs', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Bulgarian split squat', group: 'legs', needs: ['Bench'], sets: 3, reps: 10 },
  { name: 'Dumbbell step-up', group: 'legs', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 10 },
  { name: 'Glute bridge', group: 'legs', needs: [], sets: 3, reps: 15 },
  { name: 'Dumbbell hip thrust', group: 'legs', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 12 },
  { name: 'Calf raise', group: 'legs', needs: [], sets: 3, reps: 20 },
  { name: 'Wall sit', group: 'legs', needs: [], sets: 3, reps: 40, unit: 'sec' },
  // core
  { name: 'Plank', group: 'core', needs: [], sets: 3, reps: 40, unit: 'sec' },
  { name: 'Side plank (each side)', group: 'core', needs: [], sets: 3, reps: 30, unit: 'sec' },
  { name: 'Dead bug', group: 'core', needs: [], sets: 3, reps: 12 },
  { name: 'Bicycle crunch', group: 'core', needs: [], sets: 3, reps: 20 },
  { name: 'Bird dog', group: 'core', needs: [], sets: 3, reps: 10 },
  { name: 'Lying leg raise', group: 'core', needs: [], sets: 3, reps: 12 },
  { name: 'Mountain climber', group: 'core', needs: [], sets: 3, reps: 30, unit: 'sec' },
  { name: 'Dumbbell Russian twist', group: 'core', needs: ['Dumbbells'], sets: 3, reps: 20 },
  { name: 'Hanging knee raise', group: 'core', needs: ['Pull-up bar'], sets: 3, reps: 10 },
  // full body
  { name: 'Burpee', group: 'full', needs: [], sets: 3, reps: 8 },
  { name: 'Dumbbell thruster', group: 'full', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Dumbbell swing', group: 'full', needs: ['Dumbbells'], sets: 3, reps: 15 },
  { name: 'Kettlebell swing', group: 'full', needs: ['Kettlebell'], sets: 3, reps: 15 }
];

// Rough minutes for one exercise: work + rest per set, plus a minute to set up.
function estimateMinutes(ex) {
  const work = ex.unit === 'sec' ? ex.reps : ex.reps * 3;
  const rest = ex.unit === 'sec' ? 45 : 60;
  return (ex.sets * (work + rest)) / 60 + 1;
}

// Builds a workout that fits `minutes` for the chosen region using only `equipment`.
// Cycles through the region's muscle groups and prefers exercises not done recently.
// `lastDone` maps exercise name -> timestamp of the last time it was logged.
function buildLibraryWorkout({ minutes, region, equipment, lastDone = {} }) {
  const have = new Set(equipment.map(e => e.toLowerCase()));
  const available = LIBRARY.filter(ex => ex.needs.every(n => have.has(n.toLowerCase())));
  const groups = REGIONS[region].groups;

  const pools = groups.map(g =>
    available.filter(ex => ex.group === g)
      .map(ex => ({ ex, sort: (lastDone[ex.name] || 0) + Math.random() * 3 * 86400000 }))
      .sort((a, b) => a.sort - b.sort)
      .map(x => ({ ...x.ex }))
  );

  let budget = minutes * 0.9; // leave slack for warm-up and moving between exercises
  const picked = [];
  let added = true;
  while (added) {
    added = false;
    for (const pool of pools) {
      const i = pool.findIndex(ex => estimateMinutes(ex) <= budget);
      if (i === -1) continue;
      const [ex] = pool.splice(i, 1);
      budget -= estimateMinutes(ex);
      picked.push(ex);
      added = true;
    }
  }
  return {
    focus: REGIONS[region].label,
    exercises: picked.map(({ name, sets, reps, unit }) => ({ name, sets, reps, weight: 0, unit })),
    estimatedMinutes: Math.round(picked.reduce((s, ex) => s + estimateMinutes(ex), 0))
  };
}
