// Training Log app: state, UI, logging, history, suggestions and sync glue.
// localStorage is the source of truth; cloud writes are mirrored after each local write.
'use strict';

const STORAGE_KEY = 'workoutLog_v1';
const EQUIPMENT_STORAGE = 'equipment_v1';
const EQUIP_UPDATED_STORAGE = 'equipmentUpdated_v1'; // last profile edit (equipment and synced settings)
const SYNCED_STORAGE = 'syncedIds_v1';
const THEME_STORAGE = 'theme_v1';
const SETTINGS_STORAGE = 'settings_v1';
// AI proxy (worker/), backed by Gemini. Available to everyone with daily limits
// enforced by the Worker; signed-in Google users get higher limits. Empty = disabled.
const AI_PROXY_URL = 'https://workout-ai.tejjammy.workers.dev';
// JSON shape the proxy asks Gemini to return for a workout suggestion.
const WORKOUT_SCHEMA = {
  type: 'object',
  properties: {
    focus: { type: 'string' },
    reason: { type: 'string' },
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
  required: ['focus', 'reason', 'exercises']
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
// Synced settings. Theme is per device and lives in THEME_STORAGE instead.
const DEFAULT_SETTINGS = { aiPick: true, chime: true, keepAwake: true, restSeconds: 90, weeklyGoal: 4, goalHistory: [] };
let settings = { ...DEFAULT_SETTINGS, ...load(SETTINGS_STORAGE, {}) };
let exerciseRowCount = 0;

function persistWorkouts() { save(STORAGE_KEY, workouts); }
function addEntry(entry) {
  workouts.unshift(entry);
  workouts.sort((a, b) => new Date(b.date) - new Date(a.date));
  persistWorkouts();
  cloudCall(() => cloud.saveWorkout(entry));
  renderToday();
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
  document.body.classList.remove('no-tabs');
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
  return { equipment, settings, updatedAt: load(EQUIP_UPDATED_STORAGE, 0) };
}
// Accepts only known settings with the right types, so a bad profile can't break the app.
function cleanSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    const v = raw?.[k];
    if (Array.isArray(def) ? Array.isArray(v) : typeof v === typeof def) out[k] = v;
  }
  out.goalHistory = out.goalHistory.filter(g => g && typeof g.week === 'string' && Number.isFinite(g.goal));
  return out;
}
function applyProfile(p) {
  if (Array.isArray(p.equipment)) {
    equipment = p.equipment.filter(x => typeof x === 'string');
    save(EQUIPMENT_STORAGE, equipment);
  }
  if (p.settings) {
    settings = cleanSettings(p.settings);
    save(SETTINGS_STORAGE, settings);
  }
  save(EQUIP_UPDATED_STORAGE, p.updatedAt || 0);
  renderEquipment();
  renderSettings();
  renderToday();
}
function touchProfile() {
  save(EQUIP_UPDATED_STORAGE, Date.now());
  cloudCall(() => cloud.saveProfile(profileData()));
}
function setSetting(key, value) {
  settings[key] = value;
  save(SETTINGS_STORAGE, settings);
  touchProfile();
  renderSettings();
}

// ---------- Settings screen ----------
function renderSettings() {
  setSeg('restSeg', settings.restSeconds);
  document.querySelectorAll('[data-pref]').forEach(row => row.setAttribute('aria-checked', !!settings[row.dataset.pref]));
}
document.querySelectorAll('[data-pref]').forEach(row => row.addEventListener('click', () => {
  const key = row.dataset.pref;
  setSetting(key, !settings[key]);
  if (key === 'aiPick' && settings.aiPick) generatePlan({});
}));
onSeg('restSeg', v => setSetting('restSeconds', Number(v)));
renderSettings();

// Number steppers: buttons with data-step="<input id>" and data-by="<delta>".
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-step]');
  if (!btn) return;
  const input = $(btn.dataset.step);
  const min = Number(input.min || 0), max = Number(input.max || Infinity);
  const v = Math.min(max, Math.max(min, (parseFloat(input.value) || 0) + Number(btn.dataset.by)));
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

// ---------- Manual workout log (sheet) ----------
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
      <input type="number" class="ex-weight" min="0" inputmode="decimal" value="${esc(prefill?.weight ?? 0)}"></label>
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
$('logRegion').innerHTML = Object.entries(REGIONS).map(([k, r]) => `<option value="${k}">${esc(r.label)}</option>`).join('');

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
// Opens the manual log sheet, optionally pre-filled (e.g. with today's plan).
function openLogSheet(prefill) {
  $('logDate').value = today();
  $('logDate').max = today();
  $('logDuration').value = prefill?.minutes || 30;
  $('logRegion').value = prefill?.focus || 'full';
  resetExerciseRows(prefill?.exercises);
  setStatus('saveStatus', '');
  openSheet('sheet-log');
}
$('logManualBtn').addEventListener('click', () => openLogSheet());
// A past date is saved at noon so it can't slip into a neighbouring day across time zones.
function entryDate(dateStr) {
  return !dateStr || dateStr === today() ? new Date().toISOString() : new Date(dateStr + 'T12:00').toISOString();
}
$('saveLogBtn').addEventListener('click', () => {
  const duration = parseInt($('logDuration').value) || 0;
  const exercises = readExerciseRows();
  if (exercises.length === 0) {
    setStatus('saveStatus', 'Add at least one exercise before saving.', 'err');
    return;
  }
  addEntry({ id: Date.now(), date: entryDate($('logDate').value), duration, region: $('logRegion').value, exercises });
  closeSheet();
  toast('Workout saved');
});

// ---------- Activity sheet ----------
const DEFAULT_ACTIVITY_CHIPS = ['Outdoor walk', 'Pickleball', 'Hike', 'Yoga', 'Cycling'];
let actChoice = null; // selected chip name, or '' for "Other…"
$('activityList').innerHTML = ACTIVITIES.map(a => `<option value="${esc(a)}">`).join('');

function lastActivity(name) {
  return workouts.find(w => w.type === 'activity' && (!name || w.activity === name));
}
function activityChips() {
  const recent = [...new Set(workouts.filter(w => w.type === 'activity').map(w => w.activity))];
  return [...new Set([...recent, ...DEFAULT_ACTIVITY_CHIPS])].slice(0, 5);
}
function renderActivityChips() {
  $('actChips').innerHTML = [...activityChips().map(n => [n, n]), ['', 'Other…']].map(([v, label]) =>
    `<button class="chip ${actChoice === v ? 'on' : ''}" aria-pressed="${actChoice === v}" data-act="${esc(v)}">${esc(label)}</button>`).join('');
  $('actName').hidden = actChoice !== '';
}
function chooseActivity(name) {
  actChoice = name;
  renderActivityChips();
  const last = name && lastActivity(name);
  $('actDuration').value = last?.duration || 30;
  if (last?.effort) setSeg('effortSeg', last.effort);
  if (name === '') $('actName').focus();
}
$('actChips').addEventListener('click', e => { const c = e.target.closest('[data-act]'); if (c) chooseActivity(c.dataset.act); });
onSeg('effortSeg', v => setSeg('effortSeg', v));
onSeg('distUnitSeg', v => setSeg('distUnitSeg', v));
$('sheet-activity').addEventListener('sheet-open', () => {
  const last = lastActivity();
  setSeg('effortSeg', 'Moderate');
  setSeg('distUnitSeg', last?.distanceUnit || 'mi');
  $('actName').value = ''; $('actDistance').value = ''; $('actNotes').value = '';
  setStatus('activityStatus', '');
  chooseActivity(activityChips()[0]);
});
$('saveActivityBtn').addEventListener('click', () => {
  const activity = actChoice || $('actName').value.trim();
  const duration = parseInt($('actDuration').value) || 0;
  if (!activity || duration <= 0) {
    setStatus('activityStatus', activity ? 'Enter a duration.' : 'Name the activity.', 'err');
    return;
  }
  const entry = { id: Date.now(), date: new Date().toISOString(), type: 'activity', activity, duration, exercises: [] };
  const distance = parseFloat($('actDistance').value);
  if (distance > 0) { entry.distance = distance; entry.distanceUnit = $('distUnitSeg').querySelector('.on')?.dataset.v || 'mi'; }
  const effort = $('effortSeg').querySelector('.on')?.dataset.v;
  if (effort) entry.effort = effort;
  const notes = $('actNotes').value.trim();
  if (notes) entry.notes = notes;
  addEntry(entry);
  closeSheet();
  toast(`${activity} logged`);
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

// ---------- Today: plan ----------
const PLAN_STORAGE = 'todayPlan_v1';
const MINUTES_STORAGE = 'minutes_v1';
const MINUTE_CHOICES = [20, 30, 45];
let minutes = load(MINUTES_STORAGE, 30);
let plan = load(PLAN_STORAGE, null); // { day, focus, minutes, source, label?, reason?, exercises }
let planToken = 0;
let aiTimer;

const shortLabel = region => (REGIONS[region]?.label || 'Workout').split(' (')[0].split(' / ')[0];
const UPPER_REGIONS = ['upper', 'push', 'pull', 'chest', 'back', 'shoulders', 'arms'];
const LOWER_REGIONS = ['lower', 'legs', 'glutes'];

// Simple rotation from the last strength session: upper → lower → full body → upper.
function autoFocus() {
  for (const w of workouts) {
    if (w.type === 'activity' || !REGIONS[w.region]) continue;
    if (UPPER_REGIONS.includes(w.region)) return 'lower';
    if (LOWER_REGIONS.includes(w.region)) return 'full';
    if (w.region === 'full') return 'upper';
  }
  return 'full';
}

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
function withLastWeights(exercises) {
  const weights = lastWeights();
  return exercises.map(e => weights[e.name] ? { ...e, weight: weights[e.name] } : e);
}
function libraryWorkout(mins, region) {
  const w = buildLibraryWorkout({ minutes: mins, region, equipment, lastDone: lastDoneMap() });
  return { ...w, exercises: withLastWeights(w.exercises) };
}

// Builds today's plan from the library right away, then asks the AI for a better one
// in the background when that's enabled. `focus` overrides the automatic pick for today.
function generatePlan({ focus, debounce = 0 } = {}) {
  const day = today();
  const chosen = focus || (plan && plan.day === day ? plan.focus : autoFocus());
  const lib = libraryWorkout(minutes, chosen);
  plan = { day, focus: chosen, minutes, source: 'library', exercises: lib.exercises };
  save(PLAN_STORAGE, plan);
  setStatus('planStatus', '');
  renderToday();
  clearTimeout(aiTimer);
  if (settings.aiPick && AI_PROXY_URL && lib.exercises.length) aiTimer = setTimeout(requestAiPlan, debounce);
}

async function requestAiPlan() {
  const token = ++planToken;
  const { focus, minutes: mins } = plan;
  $('planStatus').className = 'note';
  $('planStatus').innerHTML = '<span class="spinner"></span> Personalizing with AI…';
  try {
    const ai = await aiSuggestion(mins, focus);
    if (token !== planToken || plan.focus !== focus || plan.minutes !== mins) return;
    plan = { ...plan, source: 'ai', label: ai.focus, reason: ai.reason, exercises: withLastWeights(ai.exercises) };
    save(PLAN_STORAGE, plan);
    renderToday();
    setStatus('planStatus', Number.isFinite(ai.remaining) && ai.remaining <= 3
      ? `${ai.remaining} AI pick${ai.remaining === 1 ? '' : 's'} left today.` : '');
  } catch (err) {
    if (token !== planToken) return;
    setStatus('planStatus', err.status === 429
      ? 'Today\'s AI picks are used up, so this one is from the library.'
      : 'AI is unavailable right now, so this one is from the library.');
  }
}

function renderToday() {
  if (!plan) return;
  const label = plan.source === 'ai' && plan.label ? plan.label : shortLabel(plan.focus);
  $('todayTitle').textContent = `${label} · ${plan.minutes} min`;
  $('planReason').hidden = !(plan.source === 'ai' && plan.reason);
  $('planReasonText').textContent = plan.reason || '';
  $('planList').innerHTML = plan.exercises.length
    ? plan.exercises.map((e, i) => `<div class="plan-row"><span class="plan-n">${i + 1}</span><span class="plan-name">${esc(e.name)}</span>
        <span class="plan-meta">${esc(e.sets)}×${esc(fmtReps(e))}${e.weight ? ' · ' + esc(e.weight) : ''}</span></div>`).join('')
    : '<div class="empty">Nothing fits that time with your equipment. Try more minutes, another focus, or add equipment in Settings.</div>';
  $('startBtn').disabled = !plan.exercises.length;
  renderMinuteChips();
  renderResume();
  const done = workouts.filter(w => localDate(w.date) === today());
  $('loggedBanner').hidden = !done.length;
  $('loggedBanner').textContent = done.some(w => w.type !== 'activity')
    ? '✓ Today\'s workout is logged. Anything else is a bonus.'
    : `✓ ${done[0]?.activity || 'Activity'} logged today. A workout is a bonus.`;
}

function renderMinuteChips() {
  const custom = !MINUTE_CHOICES.includes(minutes);
  $('minuteChips').innerHTML =
    MINUTE_CHOICES.map(m => `<button class="chip ${m === minutes ? 'on' : ''}" aria-pressed="${m === minutes}" data-min="${m}">${m}m</button>`).join('') +
    `<button class="chip ${custom ? 'on' : ''}" aria-pressed="${custom}" data-min="custom">${custom ? minutes + 'm' : 'Custom'}</button>` +
    '<button class="chip text" data-min="shuffle">Shuffle</button>';
}
function setMinutes(m) {
  minutes = m;
  save(MINUTES_STORAGE, minutes);
  generatePlan({ debounce: 700 });
}
$('minuteChips').addEventListener('click', e => {
  const c = e.target.closest('[data-min]');
  if (!c) return;
  const v = c.dataset.min;
  if (v === 'shuffle') { generatePlan({ debounce: 700 }); toast('Swapped in different exercises, same focus'); }
  else if (v === 'custom') { $('customMinutes').value = minutes; openSheet('sheet-minutes'); $('customMinutes').select(); }
  else setMinutes(Number(v));
});
$('customMinutesBtn').addEventListener('click', () => {
  const m = Math.round(Number($('customMinutes').value));
  if (!(m >= 5 && m <= 180)) { $('customMinutes').focus(); return; }
  closeSheet();
  setMinutes(m);
});
$('customMinutes').addEventListener('keydown', e => { if (e.key === 'Enter') $('customMinutesBtn').click(); });

// Focus override sheet
$('sheet-focus').addEventListener('sheet-open', () => {
  const suggested = autoFocus();
  const last = workouts.find(w => w.type !== 'activity' && REGIONS[w.region]);
  $('focusNote').textContent = last
    ? `Suggested: ${shortLabel(suggested)}, since your last workout was ${shortLabel(last.region).toLowerCase()}.`
    : `Suggested: ${shortLabel(suggested)}.`;
  $('focusChips').innerHTML = Object.keys(REGIONS).map(k =>
    `<button class="chip ${k === plan.focus ? 'on' : ''}" aria-pressed="${k === plan.focus}" data-focus="${k}">${esc(shortLabel(k))}${k === suggested ? ' · suggested' : ''}</button>`).join('');
});
$('focusChips').addEventListener('click', e => {
  const c = e.target.closest('[data-focus]');
  if (!c) return;
  closeSheet();
  generatePlan({ focus: c.dataset.focus });
});


// Asks the AI proxy for a workout. Signed-in Google users send their ID token for the higher limit.
async function aiSuggestion(mins, region) {
  const regionLabel = REGIONS[region].label;
  const recent = workouts.slice(0, 10).map(w => w.type === 'activity'
    ? { date: localDate(w.date), activity: `${w.activity} ${w.duration}min${w.effort ? ' ' + w.effort : ''}` }
    : { date: localDate(w.date), focus: shortLabel(w.region),
        exercises: w.exercises.map(e => `${e.name} ${e.sets}x${fmtReps(e)}${e.weight ? '@' + e.weight + 'lb' : ''}`) });
  const systemPrompt = `You plan a single home strength workout. Use ONLY the equipment listed by the user (plus bodyweight). Respond with ONLY valid JSON matching this shape:
{"focus": "short label like 'Upper body push'", "reason": "one sentence", "exercises": [{"name": "string", "sets": number, "reps": number, "weight": number, "unit": "reps" or "sec" or "min"}]}
Use unit "sec" (reps = seconds per set) for holds and timed intervals, and "min" (reps = minutes) for steady cardio blocks. Weight is in lb, 0 for bodyweight; when an exercise appears in the history, base its weight on that, adding 5 lb if all sets were completed last time. Pick a number of exercises that fits the given minutes (roughly 5-8 minutes per exercise including rest). Hit the requested focus area. History may include sports or cardio activities; account for their fatigue (e.g. go easier on legs after a long hike). Vary exercises and avoid repeating the same movements as recent history when possible.
"reason" is one friendly sentence of at most 20 words telling the user why this workout suits today, referring to their recent history when it helps. No exclamation marks.`;
  const userPrompt = `Today is ${today()}.
Minutes available: ${mins}.
Focus: ${regionLabel}.
Equipment: ${equipment.length ? equipment.join(', ') : 'none'}.
Recent history (most recent first): ${recent.length ? JSON.stringify(recent) : 'none logged yet'}.
Plan today's workout.`;

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
    focus: String(parsed.focus || shortLabel(region)).slice(0, 40),
    reason: String(parsed.reason || '').slice(0, 200),
    exercises: parsed.exercises.slice(0, 12).map(e => ({
      name: String(e.name || 'Exercise').slice(0, 80),
      sets: Math.min(10, Math.max(1, Math.round(Number(e.sets)) || 3)),
      reps: Math.max(1, Math.round(Number(e.reps)) || 10),
      weight: Math.max(0, Number(e.weight) || 0),
      ...(e.unit === 'sec' || e.unit === 'min' ? { unit: e.unit } : {})
    }))
  };
}

// ---------- Live workout ----------
const SESSION_STORAGE = 'activeSession_v1';
const RESUME_WINDOW = 3 * 3600000; // reopen straight into a session touched in the last 3 hours
let session = load(SESSION_STORAGE, null);
let ticker = null, wakeLock = null, audioCtx = null;

const mmss = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0'); };
const amount = (reps, unit) => unit === 'sec' ? `${reps}s` : unit === 'min' ? `${reps} min` : `${reps}`;
const repsStep = unit => unit === 'sec' ? 5 : 1;

function saveSession() {
  if (session) { session.updatedAt = Date.now(); save(SESSION_STORAGE, session); }
  else try { localStorage.removeItem(SESSION_STORAGE); } catch {}
}
// Most recent logged occurrence of an exercise, before this session.
function previous(name) {
  for (const w of workouts) {
    const e = w.exercises.find(x => x.name === name);
    if (e) return { ...e, maxWeight: Math.max(e.weight || 0, ...(e.log || []).map(s => s.weight || 0)) };
  }
  return null;
}

function usesWeights(e) {
  const lib = LIBRARY.find(x => x.name === e.name);
  return lib ? lib.needs.some(n => /dumbbell|kettlebell|barbell|medicine ball/i.test(n)) : e.weight > 0;
}

// Screens without the tab bar
function showScreen(name) {
  document.body.classList.toggle('no-tabs', name === 'live' || name === 'done');
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  window.scrollTo(0, 0);
}

// ----- Chime, vibration and wake lock -----
function unlockAudio() {
  // iOS only plays Web Audio started from a tap, so create/resume the context on taps.
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); } catch {}
}
function chime() {
  if (!settings.chime) return;
  try {
    const ctx = audioCtx;
    if (ctx) [0, 0.22].forEach(d => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + d;
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.2);
    });
  } catch {}
  try { navigator.vibrate?.([120, 80, 120]); } catch {}
}
async function keepAwake(on) {
  try {
    if (on && settings.keepAwake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session && session.phase !== 'done') { keepAwake(true); renderLive(); }
});

// ----- Session lifecycle -----
function startSession(exercises, { focus, label } = {}) {
  unlockAudio();
  const list = exercises.map(e => ({ name: e.name, sets: e.sets, reps: e.reps, weight: e.weight || 0, ...(e.unit ? { unit: e.unit } : {}), done: [] }));
  session = { id: Date.now(), startedAt: Date.now(), focus, label, exercises: list, ex: 0, set: 0,
    reps: list[0].reps, weight: list[0].weight, phase: 'set', restEndsAt: 0, restTotal: 0, lastLabel: '' };
  saveSession();
  openLive();
}
function openLive() {
  if (session.phase === 'done') { renderDone(); showScreen('done'); return; }
  showScreen('live');
  keepAwake(true);
  renderLive();
  clearInterval(ticker);
  ticker = setInterval(tick, 250);
}
function closeSession() {
  clearInterval(ticker);
  keepAwake(false);
  session = null;
  saveSession();
  showTab('today');
  renderToday();
}
function tick() {
  if (!session || session.phase === 'done') return;
  if (session.phase === 'rest' && Date.now() >= session.restEndsAt) {
    // Chime only if the rest actually ended just now, not while the phone was away.
    if (Date.now() - session.restEndsAt < 3000) chime();
    session.phase = 'set';
    saveSession();
    renderLive();
    return;
  }
  renderClock();
}
function renderClock() {
  $('elapsed').textContent = mmss((Date.now() - session.startedAt) / 1000);
  if (session.phase !== 'rest') return;
  const left = Math.max(0, (session.restEndsAt - Date.now()) / 1000);
  $('restLeft').textContent = mmss(Math.ceil(left));
  $('restOf').textContent = 'of ' + mmss(session.restTotal);
  $('ring').style.setProperty('--pct', (100 - Math.round(left / session.restTotal * 100)) + '%');
}

function renderLive() {
  if (!session) return;
  if (session.phase === 'rest' && Date.now() >= session.restEndsAt) session.phase = 'set';
  const l = session, cur = l.exercises[l.ex], rest = l.phase === 'rest';
  $('setView').hidden = rest;
  $('restView').hidden = !rest;
  $('swapBtn').hidden = rest;
  $('segs').innerHTML = l.exercises.map((e, i) => {
    const pct = i < l.ex ? 100 : i > l.ex ? 0 : Math.round(e.done.length / e.sets * 100);
    return `<div style="background:linear-gradient(90deg,var(--ink) ${pct}%,var(--line) ${pct}%)"></div>`;
  }).join('');
  if (rest) {
    $('restHeader').textContent = l.lastLabel;
    $('upNextName').textContent = cur.name;
    $('upNextDetail').textContent = `Set ${l.set + 1} of ${cur.sets} · ${amount(l.reps, cur.unit)}${cur.unit ? '' : ' reps'}${l.weight ? ' @ ' + l.weight + ' lb' : ''}`;
  } else {
    $('exCount').textContent = `Exercise ${l.ex + 1} of ${l.exercises.length}`;
    $('exName').textContent = cur.name;
    const prev = previous(cur.name);
    $('exLast').textContent = prev
      ? `Last time: ${prev.sets}×${amount(prev.reps, prev.unit)}${prev.weight ? ' @ ' + prev.weight + ' lb' : ''}`
      : usesWeights(cur)
        ? 'New exercise. Pick a weight that feels like 7/10.'
        : 'New exercise. Stop a couple of reps short of your limit.';
    $('pips').innerHTML = Array.from({ length: cur.sets }, (_, i) => {
      const d = cur.done[i];
      return d ? `<div class="done">✓ ${esc(amount(d.reps, cur.unit))}</div>`
        : `<div class="${i === l.set ? 'cur' : ''}">Set ${i + 1}</div>`;
    }).join('');
    $('repsLabel').textContent = cur.unit === 'sec' ? 'Seconds' : cur.unit === 'min' ? 'Minutes' : 'Reps';
    if (document.activeElement !== $('liveReps')) $('liveReps').value = l.reps;
    if (document.activeElement !== $('liveWeight')) $('liveWeight').value = l.weight ? l.weight : 'BW';
    $('setDoneBtn').textContent = `Set ${l.set + 1} done`;
    const next = l.exercises[l.ex + 1];
    $('nextHint').textContent = l.set + 1 < cur.sets ? `Then rest ${mmss(settings.restSeconds)}`
      : next ? `Next · ${next.name} ${next.sets}×${amount(next.reps, next.unit)}` : 'Last set. Finish strong.';
  }
  renderClock();
}

function setDone() {
  unlockAudio();
  const l = session, cur = l.exercises[l.ex];
  cur.done.push({ reps: l.reps, weight: l.weight });
  l.lastLabel = `${cur.name} · set ${cur.done.length} of ${cur.sets} ✓`;
  const restFor = () => { l.phase = 'rest'; l.restTotal = settings.restSeconds; l.restEndsAt = Date.now() + settings.restSeconds * 1000; };
  if (cur.done.length < cur.sets) {
    l.set = cur.done.length;
    restFor();
  } else if (l.ex + 1 < l.exercises.length) {
    l.ex++; l.set = 0;
    const n = l.exercises[l.ex];
    l.reps = n.reps; l.weight = n.weight;
    restFor();
  } else {
    finishSession();
    return;
  }
  saveSession();
  renderLive();
}
$('setDoneBtn').addEventListener('click', setDone);

// Steppers and typed values
function adjust(field, by) {
  const cur = session.exercises[session.ex];
  session[field] = field === 'reps' ? Math.max(1, session.reps + by * repsStep(cur.unit)) : Math.max(0, session.weight + by * 5);
  saveSession();
  renderLive();
}
$('repsDown').addEventListener('click', () => adjust('reps', -1));
$('repsUp').addEventListener('click', () => adjust('reps', 1));
$('weightDown').addEventListener('click', () => adjust('weight', -1));
$('weightUp').addEventListener('click', () => adjust('weight', 1));
$('liveReps').addEventListener('change', e => { session.reps = Math.max(1, Math.round(Number(e.target.value)) || session.reps); saveSession(); renderLive(); });
$('liveWeight').addEventListener('focus', e => { if (e.target.value === 'BW') e.target.value = ''; e.target.select(); });
$('liveWeight').addEventListener('change', e => { const v = parseFloat(e.target.value); session.weight = v > 0 ? v : 0; saveSession(); });
$('liveWeight').addEventListener('blur', () => renderLive());

// Rest controls
$('restMinus').addEventListener('click', () => { session.restEndsAt = Math.max(Date.now() + 1000, session.restEndsAt - 15000); saveSession(); renderClock(); });
$('restPlus').addEventListener('click', () => {
  session.restEndsAt += 15000;
  session.restTotal = Math.max(session.restTotal, Math.ceil((session.restEndsAt - Date.now()) / 1000));
  saveSession(); renderClock();
});
$('skipRestBtn').addEventListener('click', () => { session.phase = 'set'; saveSession(); renderLive(); });

// Swap the current exercise for another one from the same muscle group that the equipment allows.
$('swapBtn').addEventListener('click', () => {
  const l = session, cur = l.exercises[l.ex];
  if (cur.done.length) { toast('Swap before the first set of an exercise.'); return; }
  const group = groupOf(cur.name);
  const have = new Set(equipment.map(e => e.toLowerCase()));
  const used = new Set(l.exercises.map(e => e.name));
  const options = LIBRARY.filter(ex => ex.group === group && !used.has(ex.name) && ex.needs.every(n => have.has(n.toLowerCase())));
  if (!options.length) { toast('No swap available for this one.'); return; }
  const lastDone = lastDoneMap();
  options.sort((a, b) => (lastDone[a.name] || 0) - (lastDone[b.name] || 0));
  const alt = options[0];
  const weight = lastWeights()[alt.name] || 0;
  l.exercises[l.ex] = { name: alt.name, sets: cur.sets, reps: alt.reps, weight, ...(alt.unit ? { unit: alt.unit } : {}), done: [] };
  l.reps = alt.reps; l.weight = weight;
  saveSession();
  renderLive();
  toast('Swapped to ' + alt.name);
});

// End early: with nothing done, just leave; otherwise review and save what's done.
$('endBtn').addEventListener('click', () => {
  if (!session.exercises.some(e => e.done.length)) { closeSession(); return; }
  finishSession();
});

// ----- Workout complete -----
function finishSession() {
  session.phase = 'done';
  session.finishedAt = Date.now();
  saveSession();
  clearInterval(ticker);
  keepAwake(false);
  renderDone();
  showScreen('done');
}
function sessionSummary() {
  const done = session.exercises.filter(e => e.done.length);
  const sets = done.reduce((a, e) => a + e.done.length, 0);
  const volume = done.reduce((a, e) => a + (e.unit ? 0 : e.done.reduce((b, d) => b + d.reps * d.weight, 0)), 0);
  const minutes = Math.max(1, Math.round(((session.finishedAt || Date.now()) - session.startedAt) / 60000));
  const improvements = [];
  for (const e of done) {
    const prev = previous(e.name);
    if (!prev) continue;
    const mw = Math.max(...e.done.map(d => d.weight));
    const mr = Math.max(...e.done.filter(d => d.weight === mw).map(d => d.reps));
    if (mw > prev.maxWeight) improvements.push({ name: e.name, delta: `${prev.maxWeight || 'BW'} → ${mw} lb` });
    else if (mw === prev.maxWeight && mr > prev.reps) improvements.push({ name: e.name, delta: `+${mr - prev.reps} ${e.unit === 'sec' ? 'sec' : e.unit === 'min' ? 'min' : 'reps'}` });
  }
  return { done, sets, volume, minutes, improvements };
}
function doneHeadline() { return { eyebrow: 'Workout complete', sub: '' }; }
function renderDone() {
  const s = sessionSummary();
  const head = doneHeadline();
  $('doneEyebrow').textContent = head.eyebrow;
  $('doneSub').textContent = head.sub;
  $('doneSub').hidden = !head.sub;
  const vol = s.volume >= 1000 ? (s.volume / 1000).toFixed(1) + 'k' : String(Math.round(s.volume));
  $('doneStats').innerHTML = [[s.minutes, 'minutes'], [s.sets, s.sets === 1 ? 'set' : 'sets'], [vol, 'lb moved']]
    .map(([v, k]) => `<div><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
  $('improveTitle').textContent = s.improvements.length ? 'Better than last time' : 'Showed up. That counts.';
  $('improvements').innerHTML = s.improvements.map(i => `<div class="imp"><b>${esc(i.name)}</b><span class="tag">${esc(i.delta)}</span></div>`).join('');
  const remaining = session.exercises.some(e => e.done.length < e.sets);
  $('keepGoingBtn').hidden = !remaining;
}
$('saveSessionBtn').addEventListener('click', () => {
  const s = sessionSummary();
  const entry = {
    id: session.id,
    date: new Date(session.startedAt).toISOString(),
    duration: s.minutes,
    region: session.focus || 'full',
    exercises: s.done.map(e => {
      const last = e.done[e.done.length - 1];
      return { name: e.name, sets: e.done.length, reps: last.reps, weight: last.weight, ...(e.unit ? { unit: e.unit } : {}), log: e.done };
    })
  };
  closeSession();
  addEntry(entry);
  toast(savedToast());
});
function savedToast() { return 'Workout saved'; }
$('keepGoingBtn').addEventListener('click', () => {
  const l = session;
  l.phase = 'set';
  l.ex = l.exercises.findIndex(e => e.done.length < e.sets);
  const cur = l.exercises[l.ex];
  l.set = cur.done.length;
  const lastSet = cur.done[cur.done.length - 1];
  l.reps = lastSet?.reps ?? cur.reps; l.weight = lastSet?.weight ?? cur.weight;
  delete l.finishedAt;
  saveSession();
  openLive();
});
$('discardBtn').addEventListener('click', () => { if (confirm('Discard this workout? Nothing will be saved.')) closeSession(); });

// ----- Start and resume -----
$('startBtn').addEventListener('click', () => {
  if (session && !confirm('You have an unfinished workout. Start a new one instead?')) return;
  startSession(plan.exercises, { focus: plan.focus, label: plan.label });
});
function renderResume() {
  $('resumeCard').hidden = !session;
  if (session) {
    const done = session.exercises.reduce((a, e) => a + e.done.length, 0);
    $('resumeSub').textContent = `Started ${new Date(session.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${done} set${done === 1 ? '' : 's'} done`;
  }
}
$('resumeBtn').addEventListener('click', () => { unlockAudio(); openLive(); });
$('resumeDiscardBtn').addEventListener('click', () => {
  if (!session.exercises.some(e => e.done.length) || confirm('Discard the unfinished workout?')) closeSession();
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

// ---------- Start ----------
if (!plan || plan.day !== today()) generatePlan(); else renderToday();
// Reopen straight into a workout that was interrupted recently (reload, locked phone).
if (session && Date.now() - (session.updatedAt || 0) < RESUME_WINDOW) openLive();
// A new day brings a new plan, even if the app stayed open overnight.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && plan?.day !== today()) generatePlan();
});

// ---------- PWA ----------
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
