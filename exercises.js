// Curated exercise library used when no API key is set.
// group: muscle group / category; needs: equipment that must ALL be available
// (bodyweight is always available).
// unit: omitted = reps, 'sec' = reps are seconds per set, 'min' = reps are minutes (steady cardio).
// Equipment names are stored in users' settings, so don't rename existing ones.
const EQUIPMENT_PRESETS = [
  'Dumbbells', 'Bench', 'Pull-up bar', 'Resistance bands', 'Kettlebell', 'Barbell',
  'Squat rack', 'Medicine ball', 'Stability ball', 'Suspension trainer', 'Jump rope',
  'Ab wheel', 'Plyo box', 'Foam roller', 'Sliders', 'Cable machine',
  'Treadmill', 'Stationary bike', 'Rowing machine', 'Elliptical'
];

const REGIONS = {
  full:      { label: 'Full body',         groups: ['legs', 'chest', 'back', 'glutes', 'shoulders', 'core', 'full', 'biceps', 'triceps'] },
  upper:     { label: 'Upper body',        groups: ['chest', 'back', 'shoulders', 'biceps', 'triceps'] },
  lower:     { label: 'Lower body',        groups: ['legs', 'glutes', 'core'] },
  push:      { label: 'Push (chest, shoulders, triceps)', groups: ['chest', 'shoulders', 'triceps'] },
  pull:      { label: 'Pull (back, biceps)', groups: ['back', 'biceps'] },
  chest:     { label: 'Chest',             groups: ['chest'] },
  back:      { label: 'Back',              groups: ['back'] },
  shoulders: { label: 'Shoulders',         groups: ['shoulders'] },
  arms:      { label: 'Arms',              groups: ['biceps', 'triceps'] },
  legs:      { label: 'Legs',              groups: ['legs', 'glutes'] },
  glutes:    { label: 'Glutes',            groups: ['glutes'] },
  core:      { label: 'Core',              groups: ['core'] },
  cardio:    { label: 'Cardio / conditioning', groups: ['cardio'] },
  mobility:  { label: 'Mobility / stretching', groups: ['mobility'] }
};

// Non-strength activities for logging (duration, optional distance). Free text is allowed too.
const ACTIVITIES = [
  'Outdoor walk', 'Hike', 'Run', 'Treadmill walk', 'Treadmill run', 'Cycling', 'Indoor cycling',
  'Swimming', 'Rowing', 'Elliptical', 'Stair climber', 'Pickleball', 'Tennis', 'Badminton',
  'Table tennis', 'Basketball', 'Soccer', 'Volleyball', 'Golf', 'Yoga', 'Pilates', 'Dance',
  'Climbing', 'Martial arts', 'Skiing', 'Kayaking', 'Yard work'
];

const LIBRARY = [
  // ---------- chest ----------
  { name: 'Push-up', group: 'chest', needs: [], sets: 3, reps: 12 },
  { name: 'Wide push-up', group: 'chest', needs: [], sets: 3, reps: 12 },
  { name: 'Decline push-up (feet on bench)', group: 'chest', needs: ['Bench'], sets: 3, reps: 10 },
  { name: 'Incline push-up (hands on bench)', group: 'chest', needs: ['Bench'], sets: 3, reps: 12 },
  { name: 'Dumbbell bench press', group: 'chest', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 10 },
  { name: 'Dumbbell incline press', group: 'chest', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 10 },
  { name: 'Dumbbell floor press', group: 'chest', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Dumbbell fly', group: 'chest', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 12 },
  { name: 'Dumbbell squeeze press', group: 'chest', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 12 },
  { name: 'Barbell bench press', group: 'chest', needs: ['Barbell', 'Bench', 'Squat rack'], sets: 4, reps: 8 },
  { name: 'Band chest press', group: 'chest', needs: ['Resistance bands'], sets: 3, reps: 15 },
  { name: 'Suspension push-up', group: 'chest', needs: ['Suspension trainer'], sets: 3, reps: 10 },
  { name: 'Cable chest fly', group: 'chest', needs: ['Cable machine'], sets: 3, reps: 12 },
  { name: 'Medicine ball push-up', group: 'chest', needs: ['Medicine ball'], sets: 3, reps: 8 },

  // ---------- back ----------
  { name: 'One-arm dumbbell row', group: 'back', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 10 },
  { name: 'Bent-over dumbbell row', group: 'back', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Chest-supported dumbbell row', group: 'back', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 12 },
  { name: 'Renegade row', group: 'back', needs: ['Dumbbells'], sets: 3, reps: 8 },
  { name: 'Dumbbell pullover', group: 'back', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 12 },
  { name: 'Pull-up', group: 'back', needs: ['Pull-up bar'], sets: 3, reps: 6 },
  { name: 'Chin-up', group: 'back', needs: ['Pull-up bar'], sets: 3, reps: 6 },
  { name: 'Band-assisted pull-up', group: 'back', needs: ['Pull-up bar', 'Resistance bands'], sets: 3, reps: 8 },
  { name: 'Resistance band row', group: 'back', needs: ['Resistance bands'], sets: 3, reps: 15 },
  { name: 'Band lat pulldown', group: 'back', needs: ['Resistance bands'], sets: 3, reps: 15 },
  { name: 'Barbell bent-over row', group: 'back', needs: ['Barbell'], sets: 4, reps: 8 },
  { name: 'Kettlebell row', group: 'back', needs: ['Kettlebell'], sets: 3, reps: 10 },
  { name: 'Suspension inverted row', group: 'back', needs: ['Suspension trainer'], sets: 3, reps: 10 },
  { name: 'Cable lat pulldown', group: 'back', needs: ['Cable machine'], sets: 3, reps: 12 },
  { name: 'Seated cable row', group: 'back', needs: ['Cable machine'], sets: 3, reps: 12 },
  { name: 'Superman hold', group: 'back', needs: [], sets: 3, reps: 30, unit: 'sec' },
  { name: 'Prone Y-T-W raise', group: 'back', needs: [], sets: 3, reps: 8 },

  // ---------- shoulders ----------
  { name: 'Dumbbell shoulder press', group: 'shoulders', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Seated dumbbell shoulder press', group: 'shoulders', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 10 },
  { name: 'Arnold press', group: 'shoulders', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Dumbbell lateral raise', group: 'shoulders', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Dumbbell front raise', group: 'shoulders', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Rear delt fly', group: 'shoulders', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Dumbbell upright row', group: 'shoulders', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Pike push-up', group: 'shoulders', needs: [], sets: 3, reps: 8 },
  { name: 'Plank shoulder tap', group: 'shoulders', needs: [], sets: 3, reps: 20 },
  { name: 'Band face pull', group: 'shoulders', needs: ['Resistance bands'], sets: 3, reps: 15 },
  { name: 'Band pull-apart', group: 'shoulders', needs: ['Resistance bands'], sets: 3, reps: 15 },
  { name: 'Band lateral raise', group: 'shoulders', needs: ['Resistance bands'], sets: 3, reps: 15 },
  { name: 'Barbell overhead press', group: 'shoulders', needs: ['Barbell'], sets: 4, reps: 8 },
  { name: 'Kettlebell overhead press', group: 'shoulders', needs: ['Kettlebell'], sets: 3, reps: 8 },
  { name: 'Kettlebell halo', group: 'shoulders', needs: ['Kettlebell'], sets: 3, reps: 10 },
  { name: 'Cable lateral raise', group: 'shoulders', needs: ['Cable machine'], sets: 3, reps: 12 },

  // ---------- biceps ----------
  { name: 'Dumbbell biceps curl', group: 'biceps', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Hammer curl', group: 'biceps', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Concentration curl', group: 'biceps', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Incline dumbbell curl', group: 'biceps', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 10 },
  { name: 'Zottman curl', group: 'biceps', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Barbell curl', group: 'biceps', needs: ['Barbell'], sets: 3, reps: 10 },
  { name: 'Band biceps curl', group: 'biceps', needs: ['Resistance bands'], sets: 3, reps: 15 },
  { name: 'Suspension biceps curl', group: 'biceps', needs: ['Suspension trainer'], sets: 3, reps: 12 },
  { name: 'Cable curl', group: 'biceps', needs: ['Cable machine'], sets: 3, reps: 12 },
  { name: 'Chin-up hold', group: 'biceps', needs: ['Pull-up bar'], sets: 3, reps: 20, unit: 'sec' },

  // ---------- triceps ----------
  { name: 'Overhead triceps extension', group: 'triceps', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Dumbbell skullcrusher', group: 'triceps', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 10 },
  { name: 'Dumbbell triceps kickback', group: 'triceps', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Close-grip dumbbell press', group: 'triceps', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 10 },
  { name: 'Bench dips', group: 'triceps', needs: ['Bench'], sets: 3, reps: 12 },
  { name: 'Close-grip push-up', group: 'triceps', needs: [], sets: 3, reps: 10 },
  { name: 'Diamond push-up', group: 'triceps', needs: [], sets: 3, reps: 8 },
  { name: 'Band triceps pushdown', group: 'triceps', needs: ['Resistance bands'], sets: 3, reps: 15 },
  { name: 'Cable triceps pushdown', group: 'triceps', needs: ['Cable machine'], sets: 3, reps: 12 },
  { name: 'Suspension triceps extension', group: 'triceps', needs: ['Suspension trainer'], sets: 3, reps: 12 },

  // ---------- legs (quads/hamstrings/calves) ----------
  { name: 'Bodyweight squat', group: 'legs', needs: [], sets: 3, reps: 15 },
  { name: 'Goblet squat', group: 'legs', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Kettlebell goblet squat', group: 'legs', needs: ['Kettlebell'], sets: 3, reps: 12 },
  { name: 'Dumbbell Romanian deadlift', group: 'legs', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Reverse lunge', group: 'legs', needs: [], sets: 3, reps: 10 },
  { name: 'Lateral lunge', group: 'legs', needs: [], sets: 3, reps: 10 },
  { name: 'Dumbbell walking lunge', group: 'legs', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Bulgarian split squat', group: 'legs', needs: ['Bench'], sets: 3, reps: 10 },
  { name: 'Dumbbell Bulgarian split squat', group: 'legs', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 8 },
  { name: 'Dumbbell step-up', group: 'legs', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 10 },
  { name: 'Box step-up', group: 'legs', needs: ['Plyo box'], sets: 3, reps: 10 },
  { name: 'Barbell back squat', group: 'legs', needs: ['Barbell', 'Squat rack'], sets: 4, reps: 8 },
  { name: 'Barbell front squat', group: 'legs', needs: ['Barbell', 'Squat rack'], sets: 4, reps: 6 },
  { name: 'Barbell deadlift', group: 'legs', needs: ['Barbell'], sets: 4, reps: 5 },
  { name: 'Slider hamstring curl', group: 'legs', needs: ['Sliders'], sets: 3, reps: 10 },
  { name: 'Stability ball hamstring curl', group: 'legs', needs: ['Stability ball'], sets: 3, reps: 12 },
  { name: 'Suspension squat', group: 'legs', needs: ['Suspension trainer'], sets: 3, reps: 15 },
  { name: 'Calf raise', group: 'legs', needs: [], sets: 3, reps: 20 },
  { name: 'Dumbbell calf raise', group: 'legs', needs: ['Dumbbells'], sets: 3, reps: 15 },
  { name: 'Wall sit', group: 'legs', needs: [], sets: 3, reps: 40, unit: 'sec' },
  { name: 'Jump squat', group: 'legs', needs: [], sets: 3, reps: 10 },

  // ---------- glutes ----------
  { name: 'Glute bridge', group: 'glutes', needs: [], sets: 3, reps: 15 },
  { name: 'Single-leg glute bridge', group: 'glutes', needs: [], sets: 3, reps: 10 },
  { name: 'Dumbbell hip thrust', group: 'glutes', needs: ['Dumbbells', 'Bench'], sets: 3, reps: 12 },
  { name: 'Barbell hip thrust', group: 'glutes', needs: ['Barbell', 'Bench'], sets: 4, reps: 10 },
  { name: 'Single-leg Romanian deadlift', group: 'glutes', needs: ['Dumbbells'], sets: 3, reps: 8 },
  { name: 'Kettlebell deadlift', group: 'glutes', needs: ['Kettlebell'], sets: 3, reps: 12 },
  { name: 'Donkey kick', group: 'glutes', needs: [], sets: 3, reps: 15 },
  { name: 'Fire hydrant', group: 'glutes', needs: [], sets: 3, reps: 15 },
  { name: 'Band lateral walk', group: 'glutes', needs: ['Resistance bands'], sets: 3, reps: 15 },
  { name: 'Band clamshell', group: 'glutes', needs: ['Resistance bands'], sets: 3, reps: 15 },
  { name: 'Cable kickback', group: 'glutes', needs: ['Cable machine'], sets: 3, reps: 12 },
  { name: 'Curtsy lunge', group: 'glutes', needs: [], sets: 3, reps: 10 },
  { name: 'Stability ball hip thrust', group: 'glutes', needs: ['Stability ball'], sets: 3, reps: 12 },

  // ---------- core ----------
  { name: 'Plank', group: 'core', needs: [], sets: 3, reps: 40, unit: 'sec' },
  { name: 'Side plank (each side)', group: 'core', needs: [], sets: 3, reps: 30, unit: 'sec' },
  { name: 'Hollow body hold', group: 'core', needs: [], sets: 3, reps: 30, unit: 'sec' },
  { name: 'Dead bug', group: 'core', needs: [], sets: 3, reps: 12 },
  { name: 'Bicycle crunch', group: 'core', needs: [], sets: 3, reps: 20 },
  { name: 'Bird dog', group: 'core', needs: [], sets: 3, reps: 10 },
  { name: 'Lying leg raise', group: 'core', needs: [], sets: 3, reps: 12 },
  { name: 'Reverse crunch', group: 'core', needs: [], sets: 3, reps: 15 },
  { name: 'V-up', group: 'core', needs: [], sets: 3, reps: 10 },
  { name: 'Dumbbell Russian twist', group: 'core', needs: ['Dumbbells'], sets: 3, reps: 20 },
  { name: 'Dumbbell side bend', group: 'core', needs: ['Dumbbells'], sets: 3, reps: 12 },
  { name: 'Hanging knee raise', group: 'core', needs: ['Pull-up bar'], sets: 3, reps: 10 },
  { name: 'Ab wheel rollout', group: 'core', needs: ['Ab wheel'], sets: 3, reps: 8 },
  { name: 'Stability ball rollout', group: 'core', needs: ['Stability ball'], sets: 3, reps: 10 },
  { name: 'Stability ball crunch', group: 'core', needs: ['Stability ball'], sets: 3, reps: 15 },
  { name: 'Slider mountain climber', group: 'core', needs: ['Sliders'], sets: 3, reps: 30, unit: 'sec' },
  { name: 'Slider body saw', group: 'core', needs: ['Sliders'], sets: 3, reps: 10 },
  { name: 'Pallof press', group: 'core', needs: ['Resistance bands'], sets: 3, reps: 12 },
  { name: 'Cable woodchop', group: 'core', needs: ['Cable machine'], sets: 3, reps: 12 },
  { name: 'Medicine ball slam', group: 'core', needs: ['Medicine ball'], sets: 3, reps: 12 },
  { name: 'Suspension pike', group: 'core', needs: ['Suspension trainer'], sets: 3, reps: 10 },

  // ---------- full body ----------
  { name: 'Burpee', group: 'full', needs: [], sets: 3, reps: 8 },
  { name: 'Bear crawl', group: 'full', needs: [], sets: 3, reps: 30, unit: 'sec' },
  { name: 'Dumbbell thruster', group: 'full', needs: ['Dumbbells'], sets: 3, reps: 10 },
  { name: 'Dumbbell swing', group: 'full', needs: ['Dumbbells'], sets: 3, reps: 15 },
  { name: 'Dumbbell clean and press', group: 'full', needs: ['Dumbbells'], sets: 3, reps: 8 },
  { name: 'Dumbbell man maker', group: 'full', needs: ['Dumbbells'], sets: 3, reps: 6 },
  { name: 'Dumbbell snatch', group: 'full', needs: ['Dumbbells'], sets: 3, reps: 8 },
  { name: 'Kettlebell swing', group: 'full', needs: ['Kettlebell'], sets: 3, reps: 15 },
  { name: 'Kettlebell Turkish get-up', group: 'full', needs: ['Kettlebell'], sets: 3, reps: 3 },
  { name: 'Kettlebell clean and press', group: 'full', needs: ['Kettlebell'], sets: 3, reps: 8 },
  { name: 'Barbell clean', group: 'full', needs: ['Barbell'], sets: 4, reps: 5 },
  { name: 'Medicine ball wall ball', group: 'full', needs: ['Medicine ball'], sets: 3, reps: 12 },
  { name: 'Suspension burpee', group: 'full', needs: ['Suspension trainer'], sets: 3, reps: 8 },

  // ---------- cardio / conditioning ----------
  { name: 'Jumping jacks', group: 'cardio', needs: [], sets: 4, reps: 45, unit: 'sec' },
  { name: 'High knees', group: 'cardio', needs: [], sets: 4, reps: 30, unit: 'sec' },
  { name: 'Butt kicks', group: 'cardio', needs: [], sets: 4, reps: 30, unit: 'sec' },
  { name: 'Mountain climber', group: 'cardio', needs: [], sets: 4, reps: 30, unit: 'sec' },
  { name: 'Skater hops', group: 'cardio', needs: [], sets: 4, reps: 30, unit: 'sec' },
  { name: 'Burpee intervals', group: 'cardio', needs: [], sets: 5, reps: 30, unit: 'sec' },
  { name: 'Shadow boxing', group: 'cardio', needs: [], sets: 3, reps: 2, unit: 'min' },
  { name: 'Brisk walk', group: 'cardio', needs: [], sets: 1, reps: 20, unit: 'min' },
  { name: 'Easy jog', group: 'cardio', needs: [], sets: 1, reps: 20, unit: 'min' },
  { name: 'Jump rope intervals', group: 'cardio', needs: ['Jump rope'], sets: 6, reps: 60, unit: 'sec' },
  { name: 'Jump rope steady', group: 'cardio', needs: ['Jump rope'], sets: 1, reps: 10, unit: 'min' },
  { name: 'Box jump', group: 'cardio', needs: ['Plyo box'], sets: 4, reps: 8 },
  { name: 'Kettlebell swing intervals', group: 'cardio', needs: ['Kettlebell'], sets: 6, reps: 30, unit: 'sec' },
  { name: 'Dumbbell thruster intervals', group: 'cardio', needs: ['Dumbbells'], sets: 5, reps: 30, unit: 'sec' },
  { name: 'Medicine ball slam intervals', group: 'cardio', needs: ['Medicine ball'], sets: 5, reps: 30, unit: 'sec' },
  { name: 'Treadmill incline walk', group: 'cardio', needs: ['Treadmill'], sets: 1, reps: 20, unit: 'min' },
  { name: 'Treadmill intervals (1 min fast / 1 min easy)', group: 'cardio', needs: ['Treadmill'], sets: 1, reps: 16, unit: 'min' },
  { name: 'Bike steady ride', group: 'cardio', needs: ['Stationary bike'], sets: 1, reps: 20, unit: 'min' },
  { name: 'Bike sprints (30s hard / 90s easy)', group: 'cardio', needs: ['Stationary bike'], sets: 1, reps: 16, unit: 'min' },
  { name: 'Rowing steady', group: 'cardio', needs: ['Rowing machine'], sets: 1, reps: 15, unit: 'min' },
  { name: 'Rowing intervals (250 m hard / 1 min easy)', group: 'cardio', needs: ['Rowing machine'], sets: 1, reps: 15, unit: 'min' },
  { name: 'Elliptical steady', group: 'cardio', needs: ['Elliptical'], sets: 1, reps: 20, unit: 'min' },

  // ---------- mobility / stretching ----------
  { name: "World's greatest stretch", group: 'mobility', needs: [], sets: 2, reps: 5 },
  { name: 'Cat-cow', group: 'mobility', needs: [], sets: 2, reps: 10 },
  { name: "Child's pose", group: 'mobility', needs: [], sets: 2, reps: 45, unit: 'sec' },
  { name: 'Hip flexor stretch (each side)', group: 'mobility', needs: [], sets: 2, reps: 45, unit: 'sec' },
  { name: 'Pigeon stretch (each side)', group: 'mobility', needs: [], sets: 2, reps: 45, unit: 'sec' },
  { name: 'Hamstring stretch', group: 'mobility', needs: [], sets: 2, reps: 45, unit: 'sec' },
  { name: '90/90 hip switch', group: 'mobility', needs: [], sets: 2, reps: 10 },
  { name: 'Thoracic spine rotation', group: 'mobility', needs: [], sets: 2, reps: 10 },
  { name: 'Deep squat hold', group: 'mobility', needs: [], sets: 2, reps: 45, unit: 'sec' },
  { name: 'Doorway chest stretch', group: 'mobility', needs: [], sets: 2, reps: 45, unit: 'sec' },
  { name: 'Downward dog to cobra', group: 'mobility', needs: [], sets: 2, reps: 8 },
  { name: 'Band shoulder dislocate', group: 'mobility', needs: ['Resistance bands'], sets: 2, reps: 10 },
  { name: 'Foam roll upper back', group: 'mobility', needs: ['Foam roller'], sets: 1, reps: 2, unit: 'min' },
  { name: 'Foam roll quads and IT band', group: 'mobility', needs: ['Foam roller'], sets: 1, reps: 2, unit: 'min' },
  { name: 'Foam roll calves and hamstrings', group: 'mobility', needs: ['Foam roller'], sets: 1, reps: 2, unit: 'min' }
];

// "12 reps", "40 sec" or "20 min" for an exercise's reps field.
function fmtAmount(e) {
  if (e.unit === 'sec') return `${e.reps} sec`;
  if (e.unit === 'min') return `${e.reps} min`;
  return `${e.reps} reps`;
}

// Rough minutes for one exercise: work + rest per set, plus a minute to set up.
function estimateMinutes(ex) {
  if (ex.unit === 'min') return ex.sets * ex.reps + (ex.sets - 1) + 1;
  const work = ex.unit === 'sec' ? ex.reps : ex.reps * 3;
  const rest = ex.group === 'mobility' ? 10 : ex.unit === 'sec' ? 30 : 60;
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
