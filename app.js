// Training Log app: state, UI, logging, history, suggestions and sync glue.
// localStorage is the source of truth; cloud writes are mirrored after each local write.
'use strict';

const STORAGE_KEY = 'workoutLog_v1';
const EQUIPMENT_STORAGE = 'equipment_v1';
const REGION_STORAGE = 'region_v1';
const EQUIP_UPDATED_STORAGE = 'equipmentUpdated_v1'; // last profile edit (equipment and synced settings)
const SYNCED_STORAGE = 'syncedIds_v1';
const THEME_STORAGE = 'theme_v1';
// AI proxy (worker/), backed by Gemini. Available to everyone with daily limits
// enforced by the Worker; signed-in Google users get higher limits. Empty = disabled.
const AI_PROXY_URL = 'https://workout-ai.tejjammy.workers.dev';
// JSON shape the proxy asks Gemini to return for a workout suggestion.
const WORKOUT_SCHEMA = {
  type: 'object',
  properties: {
    focus: { type: 'string' },
    exercises: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' }, sets: { type: 'integer' }, reps: { type: 'integer' },
          weight: { type: 'number' }, unit: { type: 'string', enum: ['reps', 'sec', 'min'] }
        },
        required: ['name', 'sets', 'reps', 'weight', 'unit']
      }
    }
  },
  required: ['focus', 'exercises']
};

// The old bring-your-own Anthropic key option was removed; don't leave a key behind.
try { localStorage.removeItem('anthropicApiKey_v1'); } catch {}

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function setStatus(elId, text, kind) {
  const el = $(elId);
  el.textContent = text;
  el.className = el.className.replace(/\b(err|ok)\b/g, '').trim() + (kind ? ' ' + kind : '');
  if (kind === 'ok') setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 2500);
}
function fmtReps(e) { return e.unit === 'sec' ? `${e.reps}s` : e.unit === 'min' ? `${e.reps} min` : `${e.reps}`; }
let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// ---------- State ----------
let workouts = load(STORAGE_KEY, []);
let equipment = load(EQUIPMENT_STORAGE, ['Dumbbells', 'Bench']);
let exerciseRowCount = 0;
let currentRegion = 'full';

function persistWorkouts() { save(STORAGE_KEY, workouts); }
function addEntry(entry) {
  workouts.unshift(entry);
  workouts.sort((a, b) => new Date(b.date) - new Date(a.date));
  persistWorkouts();
  cloudCall(() => cloud.saveWorkout(entry));
}

// ---------- Theme (per device, not synced) ----------
const themeMedia = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const pref = load(THEME_STORAGE, 'system');
  const night = pref === 'night' || (pref === 'system' && themeMedia.matches);
  document.documentElement.dataset.theme = night ? 'night' : 'day';
  document.querySelector('meta[name=theme-color]').content = night ? '#141517' : '#F4F2EE';
  setSeg('themeSeg', pref);
}
themeMedia.addEventListener?.('change', applyTheme);

// Segmented controls: buttons with data-v; `on` marks the selected one.
function setSeg(id, value) {
  $(id).querySelectorAll('button').forEach(b => {
    const on = b.dataset.v === String(value);
    b.classList.toggle('on', on);
    if (b.getAttribute('role') === 'radio') b.setAttribute('aria-checked', on);
  });
}
function onSeg(id, fn) {
  $(id).addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) fn(b.dataset.v); });
}
onSeg('themeSeg', v => { save(THEME_STORAGE, v); applyTheme(); });
applyTheme();

// ---------- Tabs ----------
function showTab(tab) {
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + tab));
  window.scrollTo(0, 0);
  if (tab === 'history') renderHistory();
}
document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('todayTag').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

// ---------- Bottom sheets ----------
let openSheetEl = null, sheetReturnFocus = null;
function openSheet(id) {
  closeSheet(false);
  sheetReturnFocus = document.activeElement;
  $('sheetHost').hidden = false;
  openSheetEl = $(id);
  openSheetEl.hidden = false;
  openSheetEl.scrollTop = 0;
  openSheetEl.querySelector('button, input, select, textarea, a')?.focus({ preventScroll: true });
  openSheetEl.dispatchEvent(new Event('sheet-open'));
}
function closeSheet(restoreFocus = true) {
  if (!openSheetEl) return;
  openSheetEl.hidden = true;
  openSheetEl = null;
  $('sheetHost').hidden = true;
  if (restoreFocus) sheetReturnFocus?.focus?.({ preventScroll: true });
}
document.addEventListener('click', e => {
  const opener = e.target.closest('[data-open]');
  if (opener) { openSheet(opener.dataset.open); return; }
  if (e.target.closest('[data-close]')) closeSheet();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && openSheetEl) closeSheet(); });

// ---------- Region picker ----------
$('regionSel').innerHTML = Object.entries(REGIONS).map(([k, r]) => `<option value="${k}">${esc(r.label)}</option>`).join('');
try { const r = localStorage.getItem(REGION_STORAGE); if (REGIONS[r]) currentRegion = r; } catch {}
$('regionSel').value = currentRegion;
$('regionSel').addEventListener('change', e => {
  currentRegion = e.target.value;
  try { localStorage.setItem(REGION_STORAGE, currentRegion); } catch {}
});

// ---------- Equipment ----------
function persistEquipment() {
  save(EQUIPMENT_STORAGE, equipment);
  touchProfile();
}
function renderEquipment() {
  const custom = equipment.filter(e => !EQUIPMENT_PRESETS.includes(e));
  $('equipChips').innerHTML =
    EQUIPMENT_PRESETS.map(p => `<button class="chip ${equipment.includes(p) ? 'on' : ''}" aria-pressed="${equipment.includes(p)}" data-preset="${esc(p)}">${esc(p)}</button>`).join('') +
    custom.map(c => `<button class="chip on" data-custom="${esc(c)}" aria-label="Remove ${esc(c)}">${esc(c)} <span class="x" aria-hidden="true">×</span></button>`).join('');
  $('equipRowSub').textContent = equipment.length ? equipment.slice(0, 3).join(', ') + (equipment.length > 3 ? '…' : '') : 'Bodyweight only';
  $('equipRowValue').textContent = `${equipment.length} ›`;
}
$('equipChips').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  if (chip.dataset.preset) {
    const p = chip.dataset.preset;
    equipment = equipment.includes(p) ? equipment.filter(x => x !== p) : [...equipment, p];
  } else if (chip.dataset.custom) {
    equipment = equipment.filter(x => x !== chip.dataset.custom);
  }
  persistEquipment();
  renderEquipment();
});
function addCustomEquipment() {
  const v = $('customEquip').value.trim();
  if (!v) return;
  if (!equipment.some(x => x.toLowerCase() === v.toLowerCase())) equipment.push(v);
  $('customEquip').value = '';
  persistEquipment();
  renderEquipment();
}
$('addEquipBtn').addEventListener('click', e => { e.preventDefault(); addCustomEquipment(); });
$('customEquip').addEventListener('keydown', e => { if (e.key === 'Enter') addCustomEquipment(); });
renderEquipment();

// ---------- Synced profile (equipment + settings), newest edit wins ----------
function profileData() {
  return { equipment, updatedAt: load(EQUIP_UPDATED_STORAGE, 0) };
}
function applyProfile(p) {
  if (Array.isArray(p.equipment)) {
    equipment = p.equipment.filter(x => typeof x === 'string');
    save(EQUIPMENT_STORAGE, equipment);
  }
  save(EQUIP_UPDATED_STORAGE, p.updatedAt || 0);
  renderEquipment();
}
function touchProfile() {
  save(EQUIP_UPDATED_STORAGE, Date.now());
  cloudCall(() => cloud.saveProfile(profileData()));
}

// ---------- Manual workout form ----------
function addExerciseRow(prefill) {
  exerciseRowCount++;
  const row = document.createElement('div');
  row.className = 'ex-row';
  if (prefill?.unit) row.dataset.unit = prefill.unit;
  const n = exerciseRowCount;
  row.innerHTML = `
    <label><div class="mini">Exercise</div>
      <input type="text" class="ex-name" value="${esc(prefill?.name)}" placeholder="e.g. Goblet squat" aria-label="Exercise ${n} name"></label>
    <label><div class="mini">Sets</div>
      <input type="number" class="ex-sets" min="1" inputmode="numeric" value="${esc(prefill?.sets || 3)}"></label>
    <label><div class="mini">${prefill?.unit === 'sec' ? 'Secs' : prefill?.unit === 'min' ? 'Mins' : 'Reps'}</div>
      <input type="number" class="ex-reps" min="1" inputmode="numeric" value="${esc(prefill?.reps || 10)}"></label>
    <label><div class="mini">Lb</div>
      <input type="number" class="ex-weight" min="0" inputmode="decimal" value="${esc(prefill?.weight ?? 20)}"></label>
    <button class="del" aria-label="Remove exercise ${n}">×</button>`;
  row.querySelector('.del').addEventListener('click', () => row.remove());
  $('exerciseRows').appendChild(row);
}
function resetExerciseRows(list) {
  $('exerciseRows').innerHTML = '';
  exerciseRowCount = 0;
  if (list && list.length) list.forEach(addExerciseRow); else addExerciseRow();
}
$('addExerciseBtn').addEventListener('click', () => addExerciseRow());
addExerciseRow();

function readExerciseRows() {
  const exercises = [];
  document.querySelectorAll('#exerciseRows .ex-row').forEach(r => {
    const name = r.querySelector('.ex-name').value.trim();
    if (!name) return;
    const ex = {
      name,
      sets: parseInt(r.querySelector('.ex-sets').value) || 0,
      reps: parseInt(r.querySelector('.ex-reps').value) || 0,
      weight: parseFloat(r.querySelector('.ex-weight').value) || 0
    };
    if (r.dataset.unit) ex.unit = r.dataset.unit;
    exercises.push(ex);
  });
  return exercises;
}
$('saveLogBtn').addEventListener('click', () => {
  const duration = parseInt($('logDuration').value) || 0;
  const exercises = readExerciseRows();
  if (exercises.length === 0) {
    setStatus('saveStatus', 'Add at least one exercise before saving.', 'err');
    return;
  }
  addEntry({ id: Date.now(), date: new Date().toISOString(), duration, region: currentRegion, exercises });
  toast('Workout saved');
  setStatus('saveStatus', '');
  resetExerciseRows();
});

// ---------- Log mode + activity logging ----------
function setLogMode(mode) {
  document.querySelectorAll('#logMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('strengthForm').hidden = mode !== 'strength';
  $('activityForm').hidden = mode !== 'activity';
}
document.querySelectorAll('#logMode button').forEach(b => b.addEventListener('click', () => setLogMode(b.dataset.mode)));
$('activityList').innerHTML = ACTIVITIES.map(a => `<option value="${esc(a)}">`).join('');

$('saveActivityBtn').addEventListener('click', () => {
  const activity = $('actName').value.trim();
  const duration = parseInt($('actDuration').value) || 0;
  if (!activity || duration <= 0) {
    setStatus('saveStatus', 'Enter an activity and a duration.', 'err');
    return;
  }
  const entry = { id: Date.now(), date: new Date().toISOString(), type: 'activity', activity, duration, exercises: [] };
  const distance = parseFloat($('actDistance').value);
  if (distance > 0) { entry.distance = distance; entry.distanceUnit = $('actDistUnit').value; }
  if ($('actEffort').value) entry.effort = $('actEffort').value;
  const notes = $('actNotes').value.trim();
  if (notes) entry.notes = notes;
  addEntry(entry);
  toast(`${activity} logged`);
  setStatus('saveStatus', '');
  $('actName').value = ''; $('actDistance').value = ''; $('actNotes').value = '';
});

// ---------- History ----------
function totalVolume(w) {
  return w.exercises.reduce((sum, e) => sum + (e.unit ? 0 : e.sets * e.reps * (e.weight || 0)), 0);
}
function entryName(w) {
  return w.type === 'activity' ? w.activity : REGIONS[w.region]?.label || 'Workout';
}
function renderHistory() {
  const list = $('historyList');
  if (workouts.length === 0) {
    list.innerHTML = '<div class="empty">Nothing logged yet. Your workouts and activities will show up here.</div>';
    return;
  }
  const maxVolume = Math.max(...workouts.filter(w => w.type !== 'activity').map(totalVolume), 1);
  list.innerHTML = workouts.map(w => {
    const d = new Date(w.date);
    const date = `<div class="h-date"><small>${esc(d.toLocaleDateString(undefined, { weekday: 'short' }))}</small><b>${d.getDate()}</b></div>`;
    const more = `<button class="h-more" data-del="${esc(w.id)}" aria-label="Delete ${esc(entryName(w))} on ${esc(d.toLocaleDateString())}">⋯</button>`;
    if (w.type === 'activity') {
      const meta = [`${w.duration} min`, w.effort, w.distance && `${w.distance} ${w.distanceUnit || 'mi'}`, w.notes].filter(Boolean).map(esc).join(' · ');
      return `<div class="h-card">${date}<div class="h-body"><div class="h-name">${esc(w.activity)}</div><div class="h-meta">${meta}</div></div><span class="tag act">ACT</span>${more}</div>`;
    }
    const vol = totalVolume(w);
    const meta = [`${w.duration} min`, `${w.exercises.length} exercise${w.exercises.length === 1 ? '' : 's'}`, vol && `${Math.round(vol).toLocaleString()} lb`].filter(Boolean).join(' · ');
    const exList = w.exercises.map(e => `${esc(e.name)} ${esc(e.sets)}×${esc(fmtReps(e))}${e.weight ? ' @ ' + esc(e.weight) : ''}`).join(' · ');
    return `<div class="h-card">${date}<div class="h-body"><div class="h-name">${esc(entryName(w))}</div><div class="h-meta">${esc(meta)}</div>
      ${vol ? `<div class="h-bar"><div style="width:${Math.round(vol / maxVolume * 100)}%"></div></div>` : ''}
      <div class="h-ex">${exList}</div></div>${more}</div>`;
  }).join('');
}
$('historyList').addEventListener('click', e => {
  const btn = e.target.closest('[data-del]');
  if (!btn || !confirm('Delete this entry from history?')) return;
  workouts = workouts.filter(w => String(w.id) !== btn.dataset.del);
  persistWorkouts();
  cloudCall(() => cloud.removeWorkout(btn.dataset.del));
  renderHistory();
});

// ---------- Export & import ----------
const localDate = d => new Date(d).toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
const today = () => localDate(Date.now());
async function deliverFile(name, type, text) {
  const file = new File([text], name, { type });
  // On phones, offer the share sheet (Files, Drive, Mail...). Elsewhere, download.
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (err) { if (err.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}
function backupData() {
  return { app: 'training-log', version: 1, exportedAt: new Date().toISOString(), workouts, equipment };
}
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function workoutsCsv() {
  const head = ['date', 'type', 'name', 'exercise', 'sets', 'reps', 'unit', 'weight_lb', 'duration_min', 'effort', 'distance', 'distance_unit', 'notes'];
  const rows = [];
  for (const w of [...workouts].reverse()) {
    const date = localDate(w.date);
    if (w.type === 'activity') {
      rows.push([date, 'activity', w.activity, '', '', '', '', '', w.duration, w.effort, w.distance, w.distance ? w.distanceUnit || 'mi' : '', w.notes]);
    } else {
      for (const e of w.exercises) {
        rows.push([date, 'strength', entryName(w), e.name, e.sets, e.reps, e.unit || 'reps', e.weight || 0, w.duration, '', '', '', '']);
      }
    }
  }
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function aiSummary() {
  const lines = [...workouts].reverse().map(w => {
    const date = localDate(w.date);
    if (w.type === 'activity') {
      return `${date} · ${w.activity} · ${w.duration} min${w.effort ? ' · ' + w.effort : ''}${w.distance ? ` · ${w.distance} ${w.distanceUnit || 'mi'}` : ''}${w.notes ? ' · ' + w.notes : ''}`;
    }
    const ex = w.exercises.map(e => `${e.name} ${e.sets}x${fmtReps(e)}${e.weight ? ' @ ' + e.weight + ' lb' : ''}`).join('; ');
    return `${date} · ${entryName(w)} · ${w.duration} min · ${ex}`;
  });
  return `I train at home and log my workouts in an app. Below is my log, oldest first (weights in lb, "45s" means 45 seconds).
Please review it and tell me:
1. How consistent I've been, week by week.
2. Which muscle groups I'm training most and least, and anything I'm neglecting.
3. Which lifts are progressing, stalled or going backwards.
4. Two or three specific changes for the next 4 weeks.

Equipment: ${equipment.length ? equipment.join(', ') : 'bodyweight only'}.

${lines.length ? lines.join('\n') : '(no workouts logged yet)'}
`;
}
$('exportJsonBtn').addEventListener('click', async () => {
  if (await deliverFile(`training-log-${today()}.json`, 'application/json', JSON.stringify(backupData(), null, 2)))
    toast(`Backed up ${workouts.length} entries`);
});
$('exportCsvBtn').addEventListener('click', async () => {
  if (await deliverFile(`training-log-${today()}.csv`, 'text/csv', workoutsCsv())) toast('Spreadsheet exported');
});
$('copyAiBtn').addEventListener('click', async () => {
  const text = aiSummary();
  try {
    await navigator.clipboard.writeText(text);
    $('aiText').hidden = true;
    toast('Copied. Paste it into ChatGPT, Claude or Gemini.');
  } catch {
    // Clipboard can be blocked; show the text so it can be copied by hand.
    $('aiText').value = text;
    $('aiText').hidden = false;
    $('aiText').select();
    setStatus('backupStatus', 'Select all and copy the text above.');
  }
});
$('sheet-data').addEventListener('sheet-open', () => { $('aiText').hidden = true; setStatus('backupStatus', ''); });
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'training-log' || !Array.isArray(data.workouts)) throw new Error('Not a Training Log backup file.');
    const valid = data.workouts.filter(w => w && w.id != null && w.date && Array.isArray(w.exercises));
    const have = new Set(workouts.map(w => String(w.id)));
    const fresh = valid.filter(w => !have.has(String(w.id)));
    if (!confirm(`Import ${fresh.length} new entries (${valid.length - fresh.length} already here)?`)) return;
    workouts = [...workouts, ...fresh].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (Array.isArray(data.equipment)) {
      for (const item of data.equipment.filter(x => typeof x === 'string')) {
        if (!equipment.some(x => x.toLowerCase() === item.toLowerCase())) equipment.push(item);
      }
      persistEquipment();
      renderEquipment();
    }
    persistWorkouts();
    cloudCall(() => cloud.saveWorkouts(fresh));
    renderHistory();
    toast(`Imported ${fresh.length} entries`);
  } catch (err) {
    setStatus('backupStatus', 'Import failed: ' + err.message, 'err');
  }
});

// ---------- Suggestions ----------
function lastDoneMap() {
  const map = {};
  for (const w of workouts) {
    const t = new Date(w.date).getTime();
    for (const e of w.exercises) if (!(map[e.name] > t)) map[e.name] = t;
  }
  return map;
}
function lastWeights() {
  const map = {};
  for (const w of workouts) for (const e of w.exercises) if (!(e.name in map) && e.weight) map[e.name] = e.weight;
  return map;
}

// Asks the AI proxy for a workout. Signed-in Google users send their ID token for the higher limit.
async function aiSuggestion(minutes) {
  const regionLabel = REGIONS[currentRegion].label;
  const recent = workouts.slice(0, 7).map(w => w.type === 'activity'
    ? { date: String(w.date).slice(0, 10), activity: `${w.activity} ${w.duration}min${w.effort ? ' ' + w.effort : ''}` }
    : { date: String(w.date).slice(0, 10),
        exercises: w.exercises.map(e => `${e.name} ${e.sets}x${fmtReps(e)}${e.weight ? '@' + e.weight + 'lb' : ''}`) });
  const systemPrompt = `You suggest a single home strength workout. Use ONLY the equipment listed by the user (plus bodyweight). Respond with ONLY valid JSON, no markdown fences, no preamble, matching exactly this shape:
{"focus": "short label like 'Upper body push'", "exercises": [{"name": "string", "sets": number, "reps": number, "weight": number, "unit": "reps" or "sec" or "min"}]}
Use unit "sec" (reps = seconds per set) for holds and timed intervals, and "min" (reps = minutes) for steady cardio blocks. Weight is in lb, 0 for bodyweight. Pick a number of exercises that fits the given minutes (roughly 5-8 minutes per exercise including rest). Hit the requested focus area. History may include sports or cardio activities; account for their fatigue (e.g. go easier on legs after a long hike). Vary exercises and avoid repeating the same movements as recent history when possible.`;
  const userPrompt = `Minutes available: ${minutes}.
Focus: ${regionLabel}.
Equipment: ${equipment.length ? equipment.join(', ') : 'none'}.
Recent workout history (most recent first): ${recent.length ? JSON.stringify(recent) : 'none logged yet'}.
Suggest today's workout.`;

  const call = async forceRefresh => {
    const headers = { 'Content-Type': 'application/json' };
    if (cloudUser && !cloudUser.isAnonymous && window.cloud) headers.Authorization = 'Bearer ' + await cloud.getIdToken(forceRefresh);
    return fetch(AI_PROXY_URL, {
      method: 'POST', headers,
      body: JSON.stringify({ system: systemPrompt, prompt: userPrompt, schema: WORKOUT_SCHEMA })
    });
  };
  let response = await call(false);
  if (response.status === 401) response = await call(true);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `AI error ${response.status}`), { status: response.status });
  const text = data.text || '';
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  if (!Array.isArray(parsed.exercises) || !parsed.exercises.length) throw new Error('No exercises in response.');
  return {
    remaining: data.remaining,
    focus: String(parsed.focus || regionLabel),
    exercises: parsed.exercises.map(e => ({
      name: String(e.name || 'Exercise'),
      sets: Math.max(1, Math.round(Number(e.sets)) || 3),
      reps: Math.max(1, Math.round(Number(e.reps)) || 10),
      weight: Math.max(0, Number(e.weight) || 0),
      ...(e.unit === 'sec' || e.unit === 'min' ? { unit: e.unit } : {})
    }))
  };
}

function libraryWorkout(minutes) {
  const w = buildLibraryWorkout({ minutes, region: currentRegion, equipment, lastDone: lastDoneMap() });
  const weights = lastWeights();
  w.exercises.forEach(e => { if (weights[e.name]) e.weight = weights[e.name]; });
  return w;
}

$('suggestBtn').addEventListener('click', async () => {
  const minutes = parseInt($('timeAvail').value) || 30;
  $('suggestionOutput').innerHTML = '';
  let suggestion, source = 'From the built-in library', note = '', noteKind = 'err';
  if (AI_PROXY_URL) {
    $('suggestStatus').className = 'status note';
    $('suggestStatus').innerHTML = '<span class="spinner"></span> Thinking…';
    try {
      suggestion = await aiSuggestion(minutes);
      source = 'AI suggestion' + (Number.isFinite(suggestion.remaining) ? ` · ${suggestion.remaining} left today` : '');
    } catch (err) {
      if (err.status === 429) { note = 'You\'ve used today\'s AI suggestions, so here is a library workout.'; noteKind = ''; }
      else note = 'AI suggestion failed (' + err.message + '). Showing a library workout instead.';
    }
  }
  if (!suggestion) suggestion = libraryWorkout(minutes);
  setStatus('suggestStatus', note, note ? noteKind : '');

  if (!suggestion.exercises.length) {
    $('suggestionOutput').innerHTML = '<div class="empty">No exercises fit that time and equipment. Try more minutes or add equipment in Settings.</div>';
    return;
  }
  $('suggestionOutput').innerHTML = `
    <div style="margin-top:16px">
      <div style="font-weight:600;font-size:16.5px">${esc(suggestion.focus)}</div>
      <div class="note" style="margin-top:2px">${esc(source)}${suggestion.estimatedMinutes ? ` · about ${suggestion.estimatedMinutes} min` : ''}</div>
      <div class="plan" style="margin:8px 0 12px">${suggestion.exercises.map((e, i) => `
        <div class="plan-row"><span class="plan-n">${i + 1}</span><span class="plan-name">${esc(e.name)}</span>
        <span class="plan-meta">${esc(e.sets)}×${esc(fmtReps(e))}${e.weight ? ' · ' + esc(e.weight) : ''}</span></div>`).join('')}</div>
      <button class="btn btn-secondary" id="useSuggestionBtn">Use this: fill the log form</button>
    </div>`;
  $('useSuggestionBtn').addEventListener('click', () => {
    setLogMode('strength');
    resetExerciseRows(suggestion.exercises);
    $('logDuration').value = minutes;
    $('exerciseRows').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// ---------- Cloud sync (Firebase) ----------
let cloudUser = null;
let syncing = false;
let lastSync = 0;

// Fire-and-forget cloud write; local data is always saved first.
function cloudCall(fn) {
  if (!cloudUser || !window.cloud) return;
  Promise.resolve().then(fn).catch(err => setStatus('syncStatus', 'Sync error: ' + syncMessage(err), 'err'));
}
function syncMessage(err) {
  return err?.code === 'permission-denied'
    ? 'permission denied. Check the Firestore rules allow this account.'
    : err?.code === 'auth/admin-restricted-operation' || err?.code === 'auth/operation-not-allowed'
    ? 'this sign-in method is not enabled in Firebase.'
    : (err?.message || String(err));
}
function agoText(t) {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'Synced just now' : m < 60 ? `Synced ${m} min ago` : `Synced ${Math.round(m / 60)} h ago`;
}
function renderSyncUI() {
  $('syncOff').hidden = !!cloudUser;
  $('syncOn').hidden = !cloudUser;
  const guest = cloudUser?.isAnonymous;
  $('syncWho').innerHTML = !cloudUser ? ''
    : guest ? '<b>Guest</b>: backed up for this device only. Link Google to sync across devices and keep access if this browser is cleared.'
    : `Signed in as <b>${esc(cloudUser.email || 'Google user')}</b>.`;
  $('linkGoogleBtn').hidden = !guest;
  $('syncRowTitle').textContent = !cloudUser ? 'Not signed in' : guest ? 'Guest backup' : (cloudUser.email || 'Signed in with Google');
  $('syncRowSub').textContent = !cloudUser ? 'Data stays in this browser' : agoText(lastSync) || 'Syncing…';
  $('syncRowValue').textContent = cloudUser ? 'Sync ›' : 'Sign in ›';
}

async function syncNow() {
  if (!cloudUser || syncing) return;
  syncing = true;
  $('syncStatus').className = 'status';
  $('syncStatus').innerHTML = '<span class="spinner"></span> Syncing…';
  try {
    const cloudList = (await cloud.fetchWorkouts()).filter(w => w && w.id != null && w.date && Array.isArray(w.exercises));
    const cloudIds = new Set(cloudList.map(w => String(w.id)));
    const meta = load(SYNCED_STORAGE, {});
    // ids this account has synced before: if one is gone from the cloud it was deleted on another device
    const prev = new Set(meta.uid === cloudUser.uid ? meta.ids : []);

    const keep = [], toPush = [];
    for (const w of workouts) {
      const id = String(w.id);
      if (cloudIds.has(id)) keep.push(w);
      else if (!prev.has(id)) { keep.push(w); toPush.push(w); }
    }
    const keepIds = new Set(keep.map(w => String(w.id)));
    const added = cloudList.filter(w => !keepIds.has(String(w.id)));
    workouts = [...keep, ...added].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (toPush.length) await cloud.saveWorkouts(toPush);

    // profile: newest edit wins
    const profile = await cloud.fetchProfile();
    const localUpdated = load(EQUIP_UPDATED_STORAGE, 0);
    if (profile && (profile.updatedAt || 0) > localUpdated) applyProfile(profile);
    else if (!profile || localUpdated > (profile.updatedAt || 0)) await cloud.saveProfile(profileData());

    persistWorkouts();
    save(SYNCED_STORAGE, { uid: cloudUser.uid, ids: workouts.map(w => String(w.id)) });
    renderEquipment();
    renderHistory();
    lastSync = Date.now();
    setStatus('syncStatus', `Synced ${workouts.length} entries.`, 'ok');
  } catch (err) {
    setStatus('syncStatus', 'Sync failed: ' + syncMessage(err), 'err');
  } finally {
    syncing = false;
    renderSyncUI();
  }
}

function initCloud() {
  $('signInBtn').disabled = false;
  $('guestBtn').disabled = false;
  $('guestBtn').addEventListener('click', () =>
    cloud.signInGuest().catch(err => setStatus('syncStatus', 'Guest sign-in failed: ' + syncMessage(err), 'err')));
  $('linkGoogleBtn').addEventListener('click', async () => {
    try {
      await cloud.linkGoogle();
      cloudUser = cloud.user;
      renderSyncUI();
      syncNow();
    } catch (err) {
      setStatus('syncStatus', 'Linking failed: ' + syncMessage(err), 'err');
    }
  });
  $('signInBtn').addEventListener('click', () =>
    cloud.signIn().catch(err => setStatus('syncStatus', 'Sign-in failed: ' + syncMessage(err), 'err')));
  $('signOutBtn').addEventListener('click', () => {
    if (cloudUser?.isAnonymous && !confirm('Signing out of a guest account loses access to its cloud backup (data on this device stays). Continue?')) return;
    cloud.signOut();
  });
  $('syncNowBtn').addEventListener('click', syncNow);
  cloud.onAuthChange(user => {
    cloudUser = user;
    renderSyncUI();
    if (user) syncNow();
  });
  // pick up changes from other devices when the app comes back to the foreground
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && cloudUser && Date.now() - lastSync > 30000) syncNow();
  });
}
if (window.cloud) initCloud();
window.addEventListener('cloud-ready', initCloud, { once: true });
window.addEventListener('cloud-failed', () => {
  $('signInBtn').textContent = 'Sync unavailable (offline?)';
}, { once: true });
renderSyncUI();

// ---------- PWA ----------
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
