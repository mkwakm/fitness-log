// 데이터 구조 (localStorage "fitness-log-v1"):
// { profile: { weight },
//   days: { "YYYY-MM-DD": { meals: [{id, type, name, amount, kcal}],
//                            workouts: [{id, name, minutes, sets: [{reps, weight, done}]}] } } }
const STORAGE_KEY = 'fitness-log-v1';
const MEAL_ORDER = ['아침', '점심', '저녁', '간식'];
const DEFAULT_WEIGHT = 70;      // 체중을 아직 안 적었을 때 쓰는 기본값 (kg)
const MIN_PER_SET = 3;          // 운동 시간을 안 적었을 때 세트당 추정 시간 (분)
const DEFAULT_MET = 5.0;        // 일반 웨이트 트레이닝

// 운동 이름으로 MET(운동 강도) 추정. 위에서부터 먼저 걸리는 것을 사용.
const MET_TABLE = [
  [/버피|hiit|인터벌|크로스핏|타바타/, 9.0],
  [/줄넘기/, 11.0],
  [/달리기|러닝|조깅|뛰기|트레드밀/, 8.0],
  [/수영/, 7.5],
  [/자전거|사이클|스피닝|로잉|일립티컬|유산소|에어로빅/, 7.0],
  [/등산|하이킹|계단/, 6.5],
  [/스쿼트|데드리프트|런지|레그프레스|레그컬|레그익스텐션|하체/, 6.0],
  [/벤치|프레스|풀업|턱걸이|로우|랫|딥스|푸시업|팔굽혀펴기|컬|숄더|어깨|가슴|등운동/, 5.0],
  [/플랭크|복근|코어|크런치|윗몸|레그레이즈/, 3.8],
  [/걷기|산책|워킹/, 3.5],
  [/요가|필라테스|스트레칭|폼롤러/, 3.0],
];

const $ = (sel) => document.querySelector(sel);

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    return { days: raw.days || {}, profile: { weight: DEFAULT_WEIGHT, ...(raw.profile || {}) } };
  } catch {
    return { days: {}, profile: { weight: DEFAULT_WEIGHT } };
  }
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = load();
let currentDate = todayStr();

function todayStr(d = new Date()) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}
function shiftDate(str, delta) {
  const d = new Date(str + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return todayStr(d);
}
function day(date = currentDate) {
  if (!state.days[date]) state.days[date] = { meals: [], workouts: [] };
  return state.days[date];
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isEmptyDay(d) {
  return !d || (d.meals.length === 0 && d.workouts.length === 0);
}

// ---------- 소모 칼로리 ----------
function bodyWeight() {
  const w = Number(state.profile?.weight);
  return w > 0 ? w : DEFAULT_WEIGHT;
}
function metOf(name) {
  const n = String(name ?? '').toLowerCase();
  for (const [re, met] of MET_TABLE) if (re.test(n)) return met;
  return DEFAULT_MET;
}
// 시간을 직접 안 적은 운동은 세트 수로 추정한다.
function minutesOf(w) {
  const m = Number(w.minutes);
  return m > 0 ? m : w.sets.length * MIN_PER_SET;
}
function isEstimated(w) {
  return !(Number(w.minutes) > 0);
}
// 소모 칼로리 = MET × 체중(kg) × 시간(h)
function burnOf(w, weight = bodyWeight()) {
  return Math.round(metOf(w.name) * weight * (minutesOf(w) / 60));
}
function dayBurn(d) {
  const weight = bodyWeight();
  return d.workouts.reduce((s, w) => s + burnOf(w, weight), 0);
}
function dayIntake(d) {
  return d.meals.reduce((s, m) => s + (Number(m.kcal) || 0), 0);
}

// ---------- 렌더링 ----------
function render() {
  $('#date').value = currentDate;
  renderMeals();
  renderWorkouts();
  renderHistory();
  renderSuggestions();
}

function renderMeals() {
  const d = day();
  const meals = d.meals;
  const total = dayIntake(d);
  const burn = dayBurn(d);
  $('#mealSummary').textContent = meals.length
    ? `오늘 ${meals.length}개 · 총 ${total} kcal${burn ? ` · 🔥 ${burn} kcal 소모 · 순 ${total - burn} kcal` : ''}`
    : '';

  $('#mealList').innerHTML = MEAL_ORDER.map((type) => {
    const list = meals.filter((m) => m.type === type);
    if (!list.length) return '';
    const sub = list.reduce((s, m) => s + (Number(m.kcal) || 0), 0);
    return `<div class="card"><h3>${type} <span class="muted">${sub ? sub + ' kcal' : ''}</span></h3>
      ${list.map((m) => `<div class="item">
        <div>${esc(m.name)} <span class="muted">${esc(m.amount)}${m.kcal ? ' · ' + m.kcal + ' kcal' : ''}</span></div>
        <button class="del" data-del-meal="${m.id}" aria-label="삭제">✕</button>
      </div>`).join('')}</div>`;
  }).join('');
}

function renderWorkouts() {
  const workouts = day().workouts;
  const weight = bodyWeight();
  const totalSets = workouts.reduce((s, w) => s + w.sets.length, 0);
  const volume = workouts.reduce((s, w) => s + w.sets.reduce((v, x) => v + (Number(x.reps) || 0) * (Number(x.weight) || 0), 0), 0);
  const totalMin = workouts.reduce((s, w) => s + minutesOf(w), 0);
  const burn = dayBurn(day());

  $('#workoutSummary').textContent = workouts.length
    ? `운동 ${workouts.length}종 · ${totalSets}세트${volume ? ` · 볼륨 ${volume.toLocaleString()} kg` : ''} · ${totalMin}분 · 🔥 ${burn} kcal`
    : '';

  renderBurn(workouts, weight, burn);

  $('#workoutList').innerHTML = workouts.map((w) => `<div class="card">
    <div class="item"><h3>${esc(w.name)}</h3>
      <button class="del" data-del-workout="${w.id}" aria-label="삭제">✕</button></div>
    <div class="item meta">
      <label class="inline">시간
        <input type="number" inputmode="numeric" min="0" step="1" value="${w.minutes ?? ''}"
               placeholder="${w.sets.length * MIN_PER_SET}" data-minutes="${w.id}">분
      </label>
      <span class="burn-chip">🔥 ${burnOf(w, weight)} kcal${isEstimated(w) ? ' (추정)' : ''}</span>
    </div>
    <div class="sets">
      ${w.sets.map((s, i) => `<div class="set ${s.done ? 'done' : ''}">
        <button data-toggle="${w.id}:${i}" title="완료 표시">${i + 1}세트${s.done ? ' ✓' : ''}</button>
        <input type="number" inputmode="numeric" min="0" value="${s.reps}" data-edit="${w.id}:${i}:reps">회
        <input type="number" inputmode="decimal" min="0" step="0.5" value="${s.weight ?? ''}" placeholder="-" data-edit="${w.id}:${i}:weight">kg
      </div>`).join('')}
      <button data-add-set="${w.id}">+ 세트</button>
      ${w.sets.length > 1 ? `<button data-remove-set="${w.id}">− 세트</button>` : ''}
    </div>
  </div>`).join('');
}

function renderBurn(workouts, weight, burn) {
  $('#burnTotal').innerHTML = `${burn} <small>kcal</small>`;
  $('#burnList').innerHTML = workouts.length
    ? workouts.map((w) => `<div class="item">
        <div>${esc(w.name)} <span class="muted">${minutesOf(w)}분 · MET ${metOf(w.name)}${isEstimated(w) ? ' · 시간 추정' : ''}</span></div>
        <strong>${burnOf(w, weight)} kcal</strong>
      </div>`).join('')
    : '<p class="muted">운동을 추가하면 소모 칼로리가 자동으로 계산돼요.</p>';

  const input = $('#bodyWeight');
  if (document.activeElement !== input) input.value = state.profile.weight;
}

function renderHistory() {
  const dates = Object.keys(state.days).filter((d) => !isEmptyDay(state.days[d])).sort().reverse();
  if (!dates.length) {
    $('#historyList').innerHTML = '<p class="muted">아직 기록이 없어요.</p>';
    return;
  }
  $('#historyList').innerHTML = dates.map((date) => {
    const d = state.days[date];
    const kcal = dayIntake(d);
    const burn = dayBurn(d);
    const ex = d.workouts.map((w) => `${esc(w.name)} ${w.sets.length}×${w.sets[0]?.reps ?? 0}`).join(', ');
    return `<div class="card history-day" data-goto="${date}">
      <h3>${date}</h3>
      <div class="muted">🍚 ${d.meals.length}개${kcal ? ` · ${kcal} kcal` : ''}</div>
      <div class="muted">🏋️ ${ex || '운동 없음'}${burn ? ` · 🔥 ${burn} kcal` : ''}</div>
      ${kcal && burn ? `<div class="muted">➖ 순 ${kcal - burn} kcal</div>` : ''}
    </div>`;
  }).join('');
}

function renderSuggestions() {
  const names = new Set();
  Object.values(state.days).forEach((d) => d.workouts.forEach((w) => names.add(w.name)));
  $('#exSuggestions').innerHTML = [...names].map((n) => `<option value="${esc(n)}">`).join('');
}

function findWorkout(id) {
  return day().workouts.find((w) => w.id === id);
}

// ---------- 이벤트 ----------
document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
function showTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === name));
}

$('#date').addEventListener('change', (e) => { currentDate = e.target.value || todayStr(); render(); });
$('#prevDay').addEventListener('click', () => { currentDate = shiftDate(currentDate, -1); render(); });
$('#nextDay').addEventListener('click', () => { currentDate = shiftDate(currentDate, 1); render(); });

$('#bodyWeight').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  state.profile.weight = v > 0 ? v : DEFAULT_WEIGHT;
  save();
  renderWorkouts();
  renderMeals();
  renderHistory();
});

$('#mealForm').addEventListener('submit', (e) => {
  e.preventDefault();
  day().meals.push({
    id: uid(),
    type: $('#mealType').value,
    name: $('#foodName').value.trim(),
    amount: $('#foodAmount').value.trim(),
    kcal: $('#foodKcal').value ? Number($('#foodKcal').value) : null,
  });
  save();
  $('#foodName').value = $('#foodAmount').value = $('#foodKcal').value = '';
  render();
});

$('#workoutForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const n = Math.max(1, Number($('#exSets').value) || 1);
  const reps = Number($('#exReps').value) || 0;
  const weight = $('#exWeight').value ? Number($('#exWeight').value) : null;
  const minutes = Number($('#exMinutes').value) > 0 ? Number($('#exMinutes').value) : null;
  day().workouts.push({
    id: uid(),
    name: $('#exName').value.trim(),
    minutes,
    sets: Array.from({ length: n }, () => ({ reps, weight, done: false })),
  });
  save();
  $('#exName').value = $('#exMinutes').value = '';
  render();
});

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, .history-day');
  if (!t) return;
  const ds = t.dataset;
  if (ds.delMeal) {
    day().meals = day().meals.filter((m) => m.id !== ds.delMeal);
  } else if (ds.delWorkout) {
    if (!confirm('이 운동을 삭제할까요?')) return;
    day().workouts = day().workouts.filter((w) => w.id !== ds.delWorkout);
  } else if (ds.toggle) {
    const [id, i] = ds.toggle.split(':');
    const s = findWorkout(id).sets[i];
    s.done = !s.done;
  } else if (ds.addSet) {
    const w = findWorkout(ds.addSet);
    const last = w.sets[w.sets.length - 1] || { reps: 10, weight: null };
    w.sets.push({ reps: last.reps, weight: last.weight, done: false });
  } else if (ds.removeSet) {
    findWorkout(ds.removeSet).sets.pop();
  } else if (ds.goto) {
    currentDate = ds.goto;
    showTab('workouts');
  } else {
    return;
  }
  save();
  render();
});

document.addEventListener('change', (e) => {
  const ds = e.target.dataset;
  if (ds.minutes) {
    const v = Number(e.target.value);
    findWorkout(ds.minutes).minutes = v > 0 ? v : null;
  } else if (ds.edit) {
    const [id, i, field] = ds.edit.split(':');
    const v = e.target.value;
    findWorkout(id).sets[i][field] = v === '' ? null : Number(v);
  } else {
    return;
  }
  save();
  renderWorkouts();
  renderMeals();
  renderHistory();
});

// ---------- 백업 ----------
$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `fitness-log-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.days) throw new Error('형식 오류');
    if (!confirm('가져온 기록을 현재 기록과 합칠까요? (같은 날짜는 가져온 기록으로 덮어씁니다)')) return;
    state.days = { ...state.days, ...data.days };
    if (Number(data.profile?.weight) > 0) state.profile.weight = Number(data.profile.weight);
    save();
    render();
    alert('가져오기 완료!');
  } catch {
    alert('올바른 백업 파일이 아니에요.');
  }
  e.target.value = '';
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js');
}

render();
