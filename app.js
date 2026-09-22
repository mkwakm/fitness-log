// 데이터 구조 (localStorage "fitness-log-v1"):
// { profile: { weight, theme },
//   days: { "YYYY-MM-DD": { meals: [{id, type, name, amount, kcal}],
//                            workouts: [{id, name, minutes, sets: [{reps, weight, done}]}] } } }
// 음식 칼로리 표(FOOD_DB, DEFAULT_UNITS)는 food-db.js에 있습니다.
const STORAGE_KEY = 'fitness-log-v1';
const MEAL_ORDER = ['아침', '점심', '저녁', '간식'];
const DEFAULT_WEIGHT = 70;      // 체중을 아직 안 적었을 때 쓰는 기본값 (kg)
const MIN_PER_SET = 3;          // 운동 시간을 안 적었을 때 세트당 추정 시간 (분)
const DEFAULT_MET = 5.0;        // 일반 웨이트 트레이닝

// 운동 이름으로 MET(운동 강도) 추정. 위에서부터 먼저 걸리는 것을 사용하므로 순서가 중요하다.
// (예: "레그레이즈"가 6.0 줄에 안 걸리도록 그 줄에는 "레그프레스"처럼 구체적인 이름만 둔다)
// 여기서 못 찾으면 DEFAULT_MET. 값이 안 맞으면 운동 카드에서 직접 고칠 수 있다(state.profile.mets).
const MET_TABLE = [
  [/줄넘기/, 11.0],
  [/버피|hiit|인터벌|크로스핏|타바타|케틀벨|마운틴클라이머|점핑잭/, 9.0],
  [/달리기|러닝|런닝|조깅|뛰기|트레드밀/, 8.0],
  [/수영/, 7.5],
  [/자전거|바이크|사이클|스피닝|로잉|일립티컬|스텝퍼|유산소|에어로빅|복싱|배드민턴|테니스|농구|축구|풋살/, 7.0],
  [/등산|하이킹|계단/, 6.5],
  [/스쿼트|데드리프트|런지|레그프레스|레그컬|레그익스텐션|힙쓰러스트|힙스러스트|하체/, 6.0],
  [/벤치|프레스|풀업|턱걸이|철봉|로우|랫|딥스|푸시업|팔굽혀펴기|컬|숄더|어깨|가슴|등운동|케이블|플라이|펙덱|레터럴|카프|trx/, 5.0],
  [/플랭크|복근|코어|크런치|윗몸|레그레이즈|브릿지/, 3.8],
  [/걷기|산책|워킹/, 3.5],
  [/요가|필라테스|스트레칭|폼롤러/, 3.0],
];

const $ = (sel) => document.querySelector(sel);

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    return { days: raw.days || {}, profile: { weight: DEFAULT_WEIGHT, theme: 'dark', mets: {}, ...(raw.profile || {}) } };
  } catch {
    return { days: {}, profile: { weight: DEFAULT_WEIGHT, theme: 'dark', mets: {} } };
  }
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = load();
let currentDate = todayStr();
let kcalTouched = false;   // 사용자가 칼로리를 직접 고쳤으면 자동 계산으로 덮어쓰지 않는다

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

// ---------- 테마 ----------
function applyTheme() {
  const dark = state.profile.theme !== 'light';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#themeBtn').textContent = dark ? '🌙' : '☀️';
  $('#themeColor').content = dark ? '#15191b' : '#f4f6f5';
}

// ---------- 식단 칼로리 계산 ----------
// 입력한 이름에서 음식 표의 항목을 찾는다.
// 한국어는 "현미밥 / 볶음밥 / 바나나우유"처럼 뒤쪽이 핵심 단어라, 이름이 표의 키로 "끝날" 때만 잡는다.
// (그냥 포함으로 찾으면 "김치전"이 "김치"로 잡혀 칼로리가 엉뚱해진다.)
// 여러 개 걸리면 가장 긴(구체적인) 키를 쓴다. 예: "제로콜라"는 "콜라"가 아니라 "제로콜라".
function findFood(name) {
  const n = String(name ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!n) return null;
  if (FOOD_DB[n]) return { key: n, food: FOOD_DB[n] };
  let best = null;
  for (const key of Object.keys(FOOD_DB)) {
    if (n.endsWith(key) && (!best || key.length > best.key.length)) best = { key, food: FOOD_DB[key] };
  }
  return best;
}

// "200g", "1공기", "1.5개", "300ml" → 그램 수. 모르는 단위면 null.
function amountToGrams(amount, food) {
  const s = String(amount ?? '').trim().replace(/\s+/g, '');
  const m = s.match(/^([\d.]+)(.*)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!(n > 0)) return null;
  const unit = m[2] || 'g';
  if (unit === 'g' || unit === 'ml' || unit === 'cc') return n;
  if (unit === 'kg' || unit === 'l') return n * 1000;
  const grams = { ...DEFAULT_UNITS, ...(food?.units || {}) }[unit];
  return grams ? n * grams : null;
}

// 음식 이름 + 양 → { kcal, grams, key, assumed }. 모르는 음식이면 null.
function estimateKcal(name, amount) {
  const hit = findFood(name);
  if (!hit) return null;
  const grams = amountToGrams(amount, hit.food);
  if (grams != null) {
    return { kcal: Math.round(hit.food.kcal100 * grams / 100), grams, key: hit.key, assumed: false };
  }
  // 양을 안 적었거나 모르는 단위면 1인분 기준으로 추정
  const base = hit.food.units?.['인분'] ?? hit.food.units?.['개'] ?? hit.food.units?.['그릇'] ?? 100;
  return { kcal: Math.round(hit.food.kcal100 * base / 100), grams: base, key: hit.key, assumed: true };
}

function updateMealHint() {
  const name = $('#foodName').value;
  const est = estimateKcal(name, $('#foodAmount').value);
  const hint = $('#mealHint');
  if (!est) {
    hint.textContent = name.trim() ? '표에 없는 음식이에요. 칼로리를 직접 적어 주세요.' : '';
    if (!kcalTouched) $('#foodKcal').value = '';   // 앞서 자동으로 채운 값을 남겨두지 않는다
    return;
  }
  hint.textContent = `🧮 ${est.key} ${est.grams}g 기준 약 ${est.kcal} kcal${est.assumed ? ' (양을 안 적어 1인분으로 추정)' : ''}`;
  if (!kcalTouched) $('#foodKcal').value = est.kcal;
}
function resetMealForm() {
  $('#foodName').value = $('#foodAmount').value = $('#foodKcal').value = '';
  $('#mealHint').textContent = '';
  kcalTouched = false;
}

// ---------- 소모 칼로리 ----------
function bodyWeight() {
  const w = Number(state.profile?.weight);
  return w > 0 ? w : DEFAULT_WEIGHT;
}
// 운동 이름별로 직접 지정한 MET. 이름이 같으면 모든 날짜에 함께 적용된다.
function metKey(name) {
  return String(name ?? '').trim().toLowerCase();
}
function customMet(name) {
  const v = Number(state.profile.mets?.[metKey(name)]);
  return v > 0 ? v : null;
}
function setCustomMet(name, value) {
  if (!state.profile.mets) state.profile.mets = {};
  const key = metKey(name);
  if (value > 0) state.profile.mets[key] = value;
  else delete state.profile.mets[key];   // 지우면 자동 추정으로 돌아간다
}
function metOf(name) {
  return customMet(name) ?? autoMet(name);
}
function autoMet(name) {
  const n = metKey(name);
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
function volumeOf(w) {
  return w.sets.reduce((v, s) => v + (Number(s.reps) || 0) * (Number(s.weight) || 0), 0);
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
  const volume = workouts.reduce((s, w) => s + volumeOf(w), 0);
  const totalMin = workouts.reduce((s, w) => s + minutesOf(w), 0);
  const burn = dayBurn(day());

  $('#workoutSummary').textContent = workouts.length
    ? `운동 ${workouts.length}종 · ${totalSets}세트${volume ? ` · 볼륨 ${volume.toLocaleString()} kg` : ''} · ${totalMin}분 · 🔥 ${burn} kcal`
    : '';

  renderBurn(workouts, weight, burn);

  $('#workoutList').innerHTML = workouts.map((w) => {
    const vol = volumeOf(w);
    const top = Math.max(0, ...w.sets.map((s) => Number(s.weight) || 0));
    return `<div class="card">
    <div class="item"><h3>${esc(w.name)}</h3>
      <button class="del" data-del-workout="${w.id}" aria-label="삭제">✕</button></div>
    <div class="item meta">
      <div class="meta-inputs">
        <label class="inline">시간
          <input type="number" inputmode="numeric" min="0" step="1" value="${w.minutes ?? ''}"
                 placeholder="${w.sets.length * MIN_PER_SET}" data-minutes="${w.id}">분
        </label>
        <label class="inline" title="운동 강도. 직접 고치면 같은 이름의 운동에 모두 적용돼요.">MET
          <input type="number" inputmode="decimal" min="1" max="20" step="0.5" value="${metOf(w.name)}"
                 class="${customMet(w.name) ? 'custom' : ''}" data-met="${esc(w.name)}">
        </label>
        ${customMet(w.name) ? `<button class="link-btn" data-reset-met="${esc(w.name)}" title="자동 추정값으로 되돌리기">↺ 자동(${autoMet(w.name)})</button>` : ''}
      </div>
      <span class="burn-chip">🔥 ${burnOf(w, weight)} kcal${isEstimated(w) ? ' (추정)' : ''}</span>
    </div>
    <div class="set-table">
      <div class="set-row head"><span>세트</span><span>중량(kg)</span><span>횟수</span><span></span></div>
      ${w.sets.map((s, i) => `<div class="set-row ${s.done ? 'done' : ''}">
        <button class="set-no" data-toggle="${w.id}:${i}" title="완료 표시">${i + 1}${s.done ? ' ✓' : ''}</button>
        <input type="number" inputmode="decimal" min="0" step="0.5" value="${s.weight ?? ''}" placeholder="맨몸" data-edit="${w.id}:${i}:weight">
        <input type="number" inputmode="numeric" min="0" value="${s.reps ?? ''}" data-edit="${w.id}:${i}:reps">
        <button class="del" data-del-set="${w.id}:${i}" aria-label="세트 삭제">✕</button>
      </div>`).join('')}
    </div>
    <div class="item meta">
      <button data-add-set="${w.id}">+ 세트 추가</button>
      <span class="muted">${top ? `최고 ${top} kg · ` : ''}볼륨 ${vol.toLocaleString()} kg</span>
    </div>
  </div>`;
  }).join('');
}

function renderBurn(workouts, weight, burn) {
  $('#burnTotal').innerHTML = `${burn} <small>kcal</small>`;
  $('#burnList').innerHTML = workouts.length
    ? workouts.map((w) => `<div class="item">
        <div>${esc(w.name)} <span class="muted">${minutesOf(w)}분 · MET ${metOf(w.name)}${customMet(w.name) ? '(직접)' : ''}${isEstimated(w) ? ' · 시간 추정' : ''}</span></div>
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
  const exNames = new Set();
  const foodNames = new Set(Object.keys(FOOD_DB));
  Object.values(state.days).forEach((d) => {
    d.workouts.forEach((w) => exNames.add(w.name));
    d.meals.forEach((m) => foodNames.add(m.name));
  });
  $('#exSuggestions').innerHTML = [...exNames].map((n) => `<option value="${esc(n)}">`).join('');
  $('#foodSuggestions').innerHTML = [...foodNames].map((n) => `<option value="${esc(n)}">`).join('');
}

function findWorkout(id) {
  return day().workouts.find((w) => w.id === id);
}

// 합계에 영향을 주는 값이 바뀌었을 때 (음식 추천 목록은 그대로 두고) 다시 그린다.
function refreshTotals() {
  renderWorkouts();
  renderMeals();
  renderHistory();
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

$('#themeBtn').addEventListener('click', () => {
  state.profile.theme = state.profile.theme === 'light' ? 'dark' : 'light';
  save();
  applyTheme();
});

$('#bodyWeight').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  state.profile.weight = v > 0 ? v : DEFAULT_WEIGHT;
  save();
  refreshTotals();
});

$('#foodName').addEventListener('input', updateMealHint);
$('#foodAmount').addEventListener('input', updateMealHint);
$('#foodKcal').addEventListener('input', () => { kcalTouched = true; });

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
  resetMealForm();
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
  } else if (ds.delSet) {
    const [id, i] = ds.delSet.split(':');
    const w = findWorkout(id);
    if (w.sets.length > 1) {
      w.sets.splice(Number(i), 1);
    } else if (confirm('마지막 세트예요. 이 운동을 삭제할까요?')) {
      day().workouts = day().workouts.filter((x) => x.id !== id);
    } else {
      return;
    }
  } else if (ds.resetMet) {
    setCustomMet(ds.resetMet, 0);
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
  } else if (ds.met) {
    setCustomMet(ds.met, Number(e.target.value));
  } else if (ds.edit) {
    const [id, i, field] = ds.edit.split(':');
    const v = e.target.value;
    findWorkout(id).sets[i][field] = v === '' ? null : Number(v);
  } else {
    return;
  }
  save();
  // change는 포커스가 빠지는 도중에 오기도 해서, 바로 다시 그리면 브라우저가 에러를 낸다. 한 틱 미룬다.
  setTimeout(refreshTotals, 0);
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
    if (data.profile?.mets) state.profile.mets = { ...state.profile.mets, ...data.profile.mets };
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

applyTheme();
render();
