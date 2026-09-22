// 데이터 구조 (localStorage "fitness-log-v1"):
// { profile: { weight, theme, mets, weightStep, restSec, foods, goal, updatedAt },
//   days: { "YYYY-MM-DD": { meals: [{id, type, name, amount, kcal}],
//                           workouts: [{id, name, minutes, sets: [{reps, weight, done}]}],
//                           note, weight, deleted: [지운 id], updatedAt } } }
// updatedAt은 기기 간 병합 기준이라 save()가 자동으로 찍는다 (stampChanges).
// 음식 칼로리 표(FOOD_DB, DEFAULT_UNITS)는 food-db.js, 동기화·병합은 sync.js에 있습니다.
// ⚠️ 동기화 토큰은 이 저장값에 넣지 않는다 (별도 키 — sync.js 참고).
const STORAGE_KEY = 'fitness-log-v1';
const MEAL_ORDER = ['아침', '점심', '저녁', '간식'];
const DEFAULT_WEIGHT = 70;      // 체중을 아직 안 적었을 때 쓰는 기본값 (kg)
const MIN_PER_SET = 3;          // 운동 시간을 안 적었을 때 세트당 추정 시간 (분)
const DEFAULT_MET = 5.0;        // 일반 웨이트 트레이닝
const DEFAULT_PROFILE = {
  weight: DEFAULT_WEIGHT,
  theme: 'dark',
  mets: {},          // 운동 이름별로 직접 지정한 MET
  weightStep: 2.5,   // 중량 ± 버튼 단위 (kg)
  restSec: 90,       // 세트 완료 시 시작하는 휴식 시간 (초)
  foods: {},         // 직접 등록한 음식 { 이름: { kcal100, units } }
  goal: null,        // 하루 목표 칼로리 (안 정했으면 null)
};

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

// 저장값이 한 번 깨지면 앱이 안 열리고 브라우저 데이터를 지우는 것 말곤 방법이 없다.
// 읽을 때 모양을 한 번 고쳐서, 이상한 날짜는 버리고 나머지는 살린다. (safeDay는 sync.js)
function sanitizeDays(days) {
  const out = {};
  if (!days || typeof days !== 'object') return out;
  for (const [date, d] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !d || typeof d !== 'object') continue;
    out[date] = safeDay(d);
  }
  return out;
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    const profile = raw.profile && typeof raw.profile === 'object' ? raw.profile : {};
    return { days: sanitizeDays(raw.days), profile: { ...DEFAULT_PROFILE, ...profile } };
  } catch {
    return { days: {}, profile: { ...DEFAULT_PROFILE } };
  }
}
// 기기 간 병합에 쓸 수정 시각. 바뀐 날짜에만 찍으려고 직전 내용과 비교한다.
// (모든 수정 지점에 일일이 touch()를 넣는 것보다 빠뜨릴 일이 없다)
let lastSeen = {};
function coreOf(obj) {
  return JSON.stringify({ ...obj, updatedAt: undefined });
}
function seedStamps() {
  lastSeen = { profile: coreOf(state.profile) };
  Object.entries(state.days).forEach(([date, d]) => { lastSeen[date] = coreOf(d); });
}
function stampChanges() {
  const now = Date.now();
  Object.entries(state.days).forEach(([date, d]) => {
    const json = coreOf(d);
    if (lastSeen[date] === json) return;
    if (lastSeen[date] !== undefined || !d.updatedAt) d.updatedAt = now;
    lastSeen[date] = json;
  });
  const pj = coreOf(state.profile);
  if (lastSeen.profile !== pj) {
    if (lastSeen.profile !== undefined || !state.profile.updatedAt) state.profile.updatedAt = now;
    lastSeen.profile = pj;
  }
}

// 입력 중에는 저장이 잦아져 기록이 많을수록 느려진다. 화면은 바로 갱신하고 저장만 미룬다.
let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, 400);
}
function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  save();
}

let storageFull = false;
function save() {
  stampChanges();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageFull = false;
  } catch (err) {
    // 공간이 꽉 차면 예외가 그대로 튀어나와 화면이 반응 없이 멈춘다. 잡아서 알려준다.
    if (!storageFull) {
      storageFull = true;
      alert('저장 공간이 꽉 찼어요.\n기록 탭에서 내보내기로 백업한 뒤, 오래된 기록을 정리해 주세요.\n(지금 적은 내용은 아직 저장되지 않았습니다)');
    }
  }
  scheduleAutoSave();        // 파일 자동 저장 (sync.js)
}

let state = load();
let currentDate = todayStr();
let kcalTouched = false;  // 칼로리를 직접 고쳤으면 자동 계산으로 덮어쓰지 않는다
let favCache = [];        // 자주 먹는 음식 칩이 가리키는 목록
let range = 7;            // 통계 기간 (일)
let liftPick = '';        // 중량 추이로 보고 있는 운동

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
  if (!state.days[date]) state.days[date] = { meals: [], workouts: [], note: '' };
  return state.days[date];
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// 앱을 연 시각에 맞는 끼니를 골라둔다. (새벽/밤은 간식)
function defaultMealType(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return '간식';
  if (h < 11) return '아침';
  if (h < 15) return '점심';
  if (h < 21) return '저녁';
  return '간식';
}
// 지운 항목의 id를 남겨둔다. 안 그러면 다른 기기와 합칠 때 지운 게 되살아난다.
function markDeleted(id, date = currentDate) {
  const d = day(date);
  (d.deleted ??= []).push(id);
}
function isEmptyDay(d) {
  return !d || (d.meals.length === 0 && d.workouts.length === 0 && !d.note && !d.weight);
}
function fmtDate(str) {
  return str.slice(5).replace('-', '/');   // 2026-09-21 → 09/21
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
function foodName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, '');
}
// 직접 등록한 음식(profile.foods)이 기본 표(FOOD_DB)보다 우선한다.
function allFoods() {
  return { ...FOOD_DB, ...(state.profile.foods || {}) };
}
function findFood(name) {
  const n = foodName(name);
  if (!n) return null;
  const table = allFoods();
  if (Object.hasOwn(table, n)) return { key: n, food: table[n] };
  let best = null;
  for (const key of Object.keys(table)) {
    if (n.endsWith(key) && (!best || key.length > best.key.length)) best = { key, food: table[key] };
  }
  return best;
}

// 표에 없는 음식을 지금 적은 양·칼로리 기준으로 등록한다.
function rememberFood(name, amount, kcal) {
  const key = foodName(name);
  if (!key || !(kcal > 0)) return;
  const grams = amountToGrams(amount, null) ?? DEFAULT_UNITS['인분'];
  if (!state.profile.foods) state.profile.foods = {};
  state.profile.foods[key] = { kcal100: Math.round(kcal / grams * 1000) / 10, units: {} };
  save();
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
  // Object.hasOwn 없이 찾으면 "1toString" 같은 입력이 프로토타입 함수를 집어 NaN이 된다
  const table = { ...DEFAULT_UNITS, ...(food?.units || {}) };
  const grams = Object.hasOwn(table, unit) ? Number(table[unit]) : 0;
  return grams > 0 ? n * grams : null;
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
    if (!kcalTouched) $('#foodKcal').value = '';   // 앞서 자동으로 채운 값을 남겨두지 않는다
    const kcal = Number($('#foodKcal').value);     // 비운 뒤에 읽어야 직전 음식 값이 섞이지 않는다
    hint.innerHTML = !name.trim() ? ''
      : kcal > 0
        ? `표에 없는 음식이에요. <button type="button" class="link-btn" id="rememberFood">＋ 이 음식 기억하기</button>`
        : '표에 없는 음식이에요. 칼로리를 직접 적어 주세요.';
    return;
  }
  const custom = state.profile.foods?.[est.key] ? ' (내가 등록한 음식)' : '';
  hint.textContent = `🧮 ${est.key} ${est.grams}g 기준 약 ${est.kcal} kcal${custom}${est.assumed ? ' · 양을 안 적어 1인분으로 추정' : ''}`;
  if (!kcalTouched) $('#foodKcal').value = est.kcal;
}
function resetMealForm() {
  $('#foodName').value = $('#foodAmount').value = $('#foodKcal').value = '';
  $('#mealHint').textContent = '';
  kcalTouched = false;
}

// ---------- 소모 칼로리 ----------
// 그 날 적은 체중 → 없으면 그 전에 마지막으로 적은 체중 → 그것도 없으면 기본값.
// 과거 기록의 소모 칼로리가 "그때 체중"으로 계산되도록 날짜별로 본다.
function bodyWeight(date = currentDate) {
  const own = Number(state.days[date]?.weight);
  if (own > 0) return own;
  const past = Object.keys(state.days)
    .filter((d) => d <= date && Number(state.days[d].weight) > 0)
    .sort().reverse()[0];
  if (past) return Number(state.days[past].weight);
  const fallback = Number(state.profile?.weight);
  return fallback > 0 ? fallback : DEFAULT_WEIGHT;
}
// 체중을 적은 날만 (추이 그래프용)
function weightEntries() {
  return Object.keys(state.days)
    .filter((d) => Number(state.days[d].weight) > 0)
    .sort()
    .map((date) => ({ date, weight: Number(state.days[date].weight) }));
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
// 시간을 직접 적었으면 그 값이 사실이므로 그대로 쓰고, 안 적었으면 완료한 세트 수로 추정한다.
function minutesOf(w) {
  const m = Number(w.minutes);
  return m > 0 ? m : countedSets(w).length * MIN_PER_SET;
}
function isEstimated(w) {
  return !(Number(w.minutes) > 0);
}
// 소모 칼로리 = MET × 체중(kg) × 시간(h)
function burnOf(w, weight = bodyWeight()) {
  return Math.round(metOf(w.name) * weight * (minutesOf(w) / 60));
}
// 완료 체크한 세트만 집계한다. 하나도 체크 안 했으면 (체크를 안 쓰는 경우) 전체를 집계.
// 덕분에 "계획만 넣어둔 세트"가 볼륨·칼로리에 먼저 잡히지 않는다.
function countedSets(w) {
  const done = w.sets.filter((s) => s.done);
  return done.length ? done : w.sets;
}
function doneCount(w) {
  return w.sets.filter((s) => s.done).length;
}
function volumeOf(w) {
  return countedSets(w).reduce((v, s) => v + (Number(s.reps) || 0) * (Number(s.weight) || 0), 0);
}
// 모든 날짜를 통틀어 이 운동의 최고 기록. 중량이 없는 맨몸 운동은 횟수로 따진다.
// 동점이면 먼저 세운 날이 남아서, 예전 기록을 다시 찍은 날은 신기록으로 치지 않는다.
function personalBest(name) {
  const key = metKey(name);
  let best = null;
  // 날짜 오름차순으로 봐야 동점일 때 "먼저 세운 날"이 남는다.
  // (Object.entries는 키를 만든 순서라 날짜순이 아니다)
  for (const date of Object.keys(state.days).sort()) {
    for (const w of state.days[date].workouts) {
      if (metKey(w.name) !== key) continue;
      for (const s of countedSets(w)) {
        const weight = Number(s.weight) || 0;
        const reps = Number(s.reps) || 0;
        if (!weight && !reps) continue;
        const better = !best
          || weight > best.weight
          || (weight === best.weight && reps > best.reps);
        if (better) best = { weight, reps, date };
      }
    }
  }
  return best;
}

// 보고 있는 날보다 이전에 같은 운동을 한 가장 최근 기록
function lastRecord(name, before = currentDate) {
  const key = metKey(name);
  if (!key) return null;
  for (const date of Object.keys(state.days).filter((d) => d < before).sort().reverse()) {
    const w = state.days[date].workouts.find((x) => metKey(x.name) === key);
    if (w) return { date, workout: w };
  }
  return null;
}
// 세트를 "60kg×10, 60×10" 처럼 짧게
function setsText(w) {
  return w.sets.map((s, i) => {
    const reps = Number(s.reps) || 0;
    const kg = Number(s.weight) || 0;
    if (!kg) return `${reps}회`;
    return i === 0 ? `${kg}kg×${reps}` : `${kg}×${reps}`;
  }).join(', ');
}
// 운동이 있는 가장 최근 이전 날짜 (루틴 불러오기용)
function lastWorkoutDate(before = currentDate) {
  return Object.keys(state.days)
    .filter((d) => d < before && state.days[d].workouts.length)
    .sort().reverse()[0] || null;
}

function dayBurn(date) {
  const d = state.days[date];
  if (!d) return 0;
  const weight = bodyWeight(date);
  return d.workouts.reduce((s, w) => s + burnOf(w, weight), 0);
}
function dayIntake(d) {
  return d.meals.reduce((s, m) => s + (Number(m.kcal) || 0), 0);
}

// ---------- 실행취소 ----------
// 지우기 직전 상태를 통째로 들고 있다가 되돌린다. 개인용 기록이라 크기가 작아 이 방식이 가장 단순하다.
let undoSnapshot = null;
let undoTimer = null;

function pushUndo(label) {
  undoSnapshot = JSON.stringify(state);
  $('#undoText').textContent = label;
  $('#undoBar').hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, 7000);
}
function hideUndo() {
  clearTimeout(undoTimer);
  $('#undoBar').hidden = true;
  undoSnapshot = null;
}
function undo() {
  if (!undoSnapshot) return;
  state = JSON.parse(undoSnapshot);
  save();
  hideUndo();
  applyTheme();
  render();
}

// ---------- 휴식 타이머 ----------
let restTimer = null;
let restEndAt = 0;        // 끝나는 시각(ms). 1초씩 빼면 화면이 꺼졌을 때 브라우저가
                          // setInterval을 늦춰서 타이머가 실제보다 느려진다.
function restLeft() {
  return Math.max(0, Math.ceil((restEndAt - Date.now()) / 1000));
}
function startRest(sec = Number(state.profile.restSec) || 90) {
  restEndAt = Date.now() + sec * 1000;
  $('#restBar').hidden = false;
  drawRest();
  clearInterval(restTimer);
  restTimer = setInterval(() => {
    drawRest();
    if (Date.now() >= restEndAt) { stopRest(); alarm(); }
  }, 250);
}
function stopRest() {
  clearInterval(restTimer);
  restTimer = null;
  restEndAt = 0;
  $('#restBar').hidden = true;
}
function drawRest() {
  const left = restLeft();
  $('#restTime').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('#restBar').classList.toggle('almost', left <= 10);
}
// 화면을 다시 켰을 때 남은 시간을 바로 맞춰 보여준다
document.addEventListener('visibilitychange', () => { if (!document.hidden && restTimer) drawRest(); });
// 파일 없이 소리를 내기 위해 WebAudio로 짧은 삐 소리를 만든다. 막혀 있으면 조용히 넘어간다.
function alarm() {
  navigator.vibrate?.([200, 100, 200]);
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
    setTimeout(() => ctx.close(), 1000);
  } catch { /* 소리를 못 내도 기능은 계속 동작해야 한다 */ }
}

// ---------- 렌더링 ----------
function render() {
  $('#date').value = currentDate;
  $('#todayBtn').hidden = currentDate === todayStr();
  renderMeals();
  renderWorkouts();
  renderHistory();
  renderSuggestions();
  renderRoutineBtn();
  renderSync();
  updateExHint();
  const note = $('#dayNote');
  if (document.activeElement !== note) note.value = day().note ?? '';
}

function renderMeals() {
  const d = day();
  const meals = d.meals;
  const total = dayIntake(d);
  const burn = dayBurn(currentDate);
  const goal = Number(state.profile.goal) || 0;
  const left = goal + burn - total;   // 소모한 만큼 더 먹을 수 있다
  const parts = [];
  if (meals.length) parts.push(`오늘 ${meals.length}개 · 총 ${total} kcal`);
  if (burn) parts.push(`🔥 ${burn} kcal 소모`);
  if (goal) parts.push(left >= 0 ? `🎯 ${left} kcal 남음` : `🎯 ${-left} kcal 초과`);
  else if (meals.length && burn) parts.push(`순 ${total - burn} kcal`);
  $('#mealSummary').textContent = parts.join(' · ');

  renderFavorites();
  renderMealCopyBtn();
  renderMyFoods();
  const goalInput = $('#goalKcal');
  if (document.activeElement !== goalInput) goalInput.value = state.profile.goal ?? '';

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

// 많이 먹은 순서대로. 같은 음식은 가장 최근에 적은 양·칼로리를 쓴다.
function favoriteFoods(limit = 6) {
  // 음식 이름이 그대로 키가 되므로 Map을 쓴다.
  // 일반 객체면 "constructor" 같은 이름이 프로토타입을 건드려 집계가 어긋난다.
  const tally = new Map();
  Object.keys(state.days).sort().forEach((date) => {
    state.days[date].meals.forEach((m) => {
      const key = foodName(m.name);
      if (!key) return;
      const cur = tally.get(key) ?? { count: 0, meal: m };
      tally.set(key, { count: cur.count + 1, meal: m });
    });
  });
  return [...tally.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

function renderFavorites() {
  const favs = favoriteFoods();
  $('#favFoods').innerHTML = favs.length
    ? `<h3>⭐ 자주 먹는 음식 <span class="hint">누르면 바로 추가돼요</span></h3>
       <div class="chips">${favs.map((f, i) => `<button class="chip" data-fav="${i}">
         ${esc(f.meal.name)} <span class="muted">${f.meal.kcal ? f.meal.kcal + 'kcal' : esc(f.meal.amount)}</span>
       </button>`).join('')}</div>`
    : '';
  $('#favFoods').hidden = !favs.length;
  favCache = favs;
}

function renderMealCopyBtn() {
  const btn = $('#loadMeals');
  const date = Object.keys(state.days)
    .filter((d) => d < currentDate && state.days[d].meals.length)
    .sort().reverse()[0];
  if (!date) { btn.hidden = true; return; }
  btn.hidden = false;
  btn.textContent = `↩ ${fmtDate(date)} 식단 ${state.days[date].meals.length}개 그대로 불러오기`;
  btn.dataset.copyMeals = date;
}

function renderMyFoods() {
  const foods = Object.entries(state.profile.foods || {});
  $('#myFoods').innerHTML = foods.length
    ? `<div class="card"><h3>🍽 내가 등록한 음식</h3>
        ${foods.map(([key, f]) => `<div class="item">
          <div>${esc(key)} <span class="muted">100g당 ${f.kcal100} kcal</span></div>
          <button class="del" data-del-food="${esc(key)}" aria-label="삭제">✕</button>
        </div>`).join('')}</div>`
    : '';
}

function renderWorkouts() {
  const workouts = day().workouts;
  const weight = bodyWeight();
  const totalSets = workouts.reduce((s, w) => s + w.sets.length, 0);
  const done = workouts.reduce((s, w) => s + doneCount(w), 0);
  const volume = workouts.reduce((s, w) => s + volumeOf(w), 0);
  const totalMin = workouts.reduce((s, w) => s + minutesOf(w), 0);
  const burn = dayBurn(currentDate);
  const setText = done ? `${done}/${totalSets}세트 완료` : `${totalSets}세트`;

  $('#workoutSummary').textContent = workouts.length
    ? `운동 ${workouts.length}종 · ${setText}${volume ? ` · 볼륨 ${volume.toLocaleString()} kg` : ''} · ${totalMin}분 · 🔥 ${burn} kcal`
    : '';

  renderBurn(workouts, weight, burn);

  $('#workoutList').innerHTML = workouts.map((w, idx) => {
    const vol = volumeOf(w);
    const done = doneCount(w);
    const pr = personalBest(w.name);
    const prText = !pr ? ''
      : pr.weight ? `🏆 최고 ${pr.weight} kg × ${pr.reps}회`
      : `🏆 최고 ${pr.reps}회`;
    const isNewPr = pr && pr.date === currentDate;   // 보고 있는 날에 세운 기록
    const last = lastRecord(w.name);
    return `<div class="card">
    <div class="item"><h3>${esc(w.name)}</h3>
      <span class="order">
        ${idx > 0 ? `<button data-move="${w.id}:-1" aria-label="위로" title="위로">↑</button>` : ''}
        ${idx < workouts.length - 1 ? `<button data-move="${w.id}:1" aria-label="아래로" title="아래로">↓</button>` : ''}
        <button class="del" data-del-workout="${w.id}" aria-label="삭제">✕</button>
      </span></div>
    <div class="item meta">
      <div class="meta-inputs">
        <label class="inline">시간
          <input type="number" inputmode="numeric" min="0" step="1" value="${w.minutes ?? ''}"
                 placeholder="${countedSets(w).length * MIN_PER_SET}" data-minutes="${w.id}">분
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
        <span class="stepper">
          <button data-step="${w.id}:${i}:weight:-1" aria-label="중량 줄이기">−</button>
          <input type="number" inputmode="decimal" min="0" step="0.5" value="${s.weight ?? ''}" placeholder="맨몸" data-edit="${w.id}:${i}:weight">
          <button data-step="${w.id}:${i}:weight:1" aria-label="중량 늘리기">+</button>
        </span>
        <span class="stepper">
          <button data-step="${w.id}:${i}:reps:-1" aria-label="횟수 줄이기">−</button>
          <input type="number" inputmode="numeric" min="0" value="${s.reps ?? ''}" data-edit="${w.id}:${i}:reps">
          <button data-step="${w.id}:${i}:reps:1" aria-label="횟수 늘리기">+</button>
        </span>
        <button class="del" data-del-set="${w.id}:${i}" aria-label="세트 삭제">✕</button>
      </div>`).join('')}
    </div>
    <div class="item meta">
      <button data-add-set="${w.id}">+ 세트 추가</button>
      <span class="muted">${done ? `${done}/${w.sets.length}세트 완료 · ` : ''}볼륨 ${vol.toLocaleString()} kg</span>
    </div>
    ${last ? `<div class="item pr">
      <span class="muted">↩ 지난번 ${fmtDate(last.date)}</span>
      <span class="muted">${setsText(last.workout)}</span>
    </div>` : ''}
    ${prText ? `<div class="item pr">
      <span>${prText}</span>
      <span class="${isNewPr ? 'new-pr' : 'muted'}">${isNewPr ? '🎉 신기록!' : pr.date}</span>
    </div>` : ''}
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

  [['#weightStep', 'weightStep'], ['#restSec', 'restSec']].forEach(([sel, key]) => {
    const el = $(sel);
    if (document.activeElement !== el) el.value = state.profile[key];
  });
  const wEl = $('#bodyWeight');
  if (document.activeElement !== wEl) wEl.value = state.days[currentDate]?.weight ?? '';
  $('#weightHint').textContent = state.days[currentDate]?.weight
    ? ''
    : `안 적으면 ${bodyWeight()} kg으로 계산해요.`;
}

// 최근 7일 섭취·소모. 같은 단위(kcal)라 축 하나에 두 계열을 나란히 둔다.
function weekData(days = range) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = shiftDate(currentDate, -i);
    const d = state.days[date];
    out.push({ date, intake: d ? dayIntake(d) : 0, burn: dayBurn(date), weight: Number(d?.weight) || null });
  }
  return out;
}

// 막대 위쪽만 둥근 path (아래는 기준선에 붙어 있어야 한다)
function barPath(x, y, w, h, r = 4) {
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y + h}V${y + rr}a${rr} ${rr} 0 0 1 ${rr} ${-rr}h${w - rr * 2}a${rr} ${rr} 0 0 1 ${rr} ${rr}V${y + h}Z`;
}

// 값이 있는 점만 잇는 꺾은선. 계열이 하나뿐이라 제목이 곧 범례 역할을 한다.
function lineChart(points, { unit, cls, fmt = (v) => v }) {
  if (points.length < 1) return '';
  const W = 340, H = 150, L = 38, R = 8, T = 12, B = 22;
  const plotW = W - L - R, plotH = H - T - B;
  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.15;
  lo -= pad; hi += pad;
  const x = (i) => points.length === 1 ? L + plotW / 2 : L + (i / (points.length - 1)) * plotW;
  const y = (v) => T + plotH - ((v - lo) / (hi - lo)) * plotH;

  const grid = [0, 0.5, 1].map((f) => {
    const gy = T + plotH - f * plotH;
    return `<line x1="${L}" y1="${gy}" x2="${W - R}" y2="${gy}" class="grid"/>
            <text x="${L - 6}" y="${gy + 4}" class="axis" text-anchor="end">${fmt(lo + (hi - lo) * f)}</text>`;
  }).join('');

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<g>
      <title>${fmtDate(p.date)} · ${p.value}${unit}</title>
      <circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4.5" class="${cls}-dot"/>
    </g>`).join('');

  // 양 끝만 직접 라벨 (점마다 숫자를 적지 않는다)
  const ends = [0, points.length - 1].filter((i, k, a) => a.indexOf(i) === k).map((i) => {
    const p = points[i];
    const anchor = i === 0 && points.length > 1 ? 'start' : points.length === 1 ? 'middle' : 'end';
    return `<text x="${x(i).toFixed(1)}" y="${(y(p.value) - 10).toFixed(1)}" class="axis" text-anchor="${anchor}">${p.value}${unit}</text>`;
  }).join('');

  const xLabels = [0, points.length - 1].filter((i, k, a) => a.indexOf(i) === k)
    .map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="axis" text-anchor="${i === 0 && points.length > 1 ? 'start' : points.length === 1 ? 'middle' : 'end'}">${fmtDate(points[i].date)}</text>`).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">
    ${grid}<path d="${path}" class="${cls}-line"/>${dots}${ends}${xLabels}</svg>`;
}

function renderWeightChart() {
  const all = weightEntries();
  const from = shiftDate(currentDate, -(range - 1));
  const points = all.filter((e) => e.date >= from && e.date <= currentDate)
    .map((e) => ({ date: e.date, value: e.weight }));
  const card = $('#weightCard');
  if (points.length < 2) {
    card.hidden = all.length === 0;
    $('#weightChart').innerHTML = all.length
      ? '<p class="muted">이 기간에 기록이 하나뿐이에요. 운동 탭에서 체중을 적으면 추이가 그려집니다.</p>'
      : '';
    return;
  }
  card.hidden = false;
  const diff = Math.round((points[points.length - 1].value - points[0].value) * 10) / 10;
  $('#weightChart').innerHTML =
    `<p class="muted">${points.length}번 기록 · ${diff > 0 ? '+' : ''}${diff} kg</p>` +
    lineChart(points, { unit: 'kg', cls: 'w', fmt: (v) => v.toFixed(1) });
}

// 그 운동을 한 날마다 그날의 최고 중량
function liftHistory(name) {
  const key = metKey(name);
  return Object.keys(state.days).sort().map((date) => {
    const w = state.days[date].workouts.find((x) => metKey(x.name) === key);
    if (!w) return null;
    const top = Math.max(0, ...countedSets(w).map((s) => Number(s.weight) || 0));
    return top > 0 ? { date, value: top } : null;
  }).filter(Boolean);
}

function renderLiftChart() {
  const names = [...new Set(Object.keys(state.days).sort().reverse()
    .flatMap((d) => state.days[d].workouts.map((w) => w.name)))];
  const card = $('#liftCard');
  if (!names.length) { card.hidden = true; return; }
  card.hidden = false;

  // 처음 열었을 땐 중량 기록이 가장 많은 운동을 보여준다 (빈 그래프로 시작하지 않게)
  if (!names.some((n) => metKey(n) === metKey(liftPick))) {
    liftPick = names.slice()
      .sort((a, b) => liftHistory(b).length - liftHistory(a).length)[0];
  }
  $('#liftPick').innerHTML = names.map((n) =>
    `<option value="${esc(n)}"${metKey(n) === metKey(liftPick) ? ' selected' : ''}>${esc(n)}</option>`).join('');

  const from = shiftDate(currentDate, -(range - 1));
  const points = liftHistory(liftPick).filter((p) => p.date >= from && p.date <= currentDate);
  if (points.length < 2) {
    $('#liftChart').innerHTML = `<p class="muted">${points.length ? '이 기간에 기록이 하나뿐이에요.' : '이 기간에 중량 기록이 없어요.'} (맨몸 운동은 중량이 없어 그려지지 않아요)</p>`;
    return;
  }
  const diff = Math.round((points[points.length - 1].value - points[0].value) * 10) / 10;
  $('#liftChart').innerHTML =
    `<p class="muted">${points.length}회 · ${diff > 0 ? '+' : ''}${diff} kg</p>` +
    lineChart(points, { unit: 'kg', cls: 'l' });
}

function renderWeekChart() {
  const data = weekData();
  const max = Math.max(1, ...data.flatMap((d) => [d.intake, d.burn]));
  const top = Math.ceil(max / 200) * 200;   // 200 단위로 올려 눈금을 깔끔하게
  const W = 340, H = 160, L = 36, R = 6, T = 10, B = 24;
  const plotW = W - L - R, plotH = H - T - B;
  const step = plotW / data.length;
  const barW = Math.max(1.5, Math.min(16, (step - Math.min(8, step * 0.25)) / 2));
  const labelEvery = Math.ceil(data.length / 7);
  const y = (v) => T + plotH - (v / top) * plotH;

  const grid = [0, 0.5, 1].map((f) => {
    const gy = T + plotH - f * plotH;
    return `<line x1="${L}" y1="${gy}" x2="${W - R}" y2="${gy}" class="grid"/>
            <text x="${L - 6}" y="${gy + 4}" class="axis" text-anchor="end">${Math.round(top * f)}</text>`;
  }).join('');

  const bars = data.map((d, i) => {
    const cx = L + step * i + step / 2;
    const x1 = cx - barW - 1, x2 = cx + 1;   // 두 막대 사이 2px 간격
    const label = fmtDate(d.date);
    return `
      <g>
        <title>${label} · 섭취 ${d.intake} kcal</title>
        ${d.intake ? `<path d="${barPath(x1, y(d.intake), barW, T + plotH - y(d.intake))}" class="bar-1"/>` : ''}
      </g>
      <g>
        <title>${label} · 소모 ${d.burn} kcal</title>
        ${d.burn ? `<path d="${barPath(x2, y(d.burn), barW, T + plotH - y(d.burn))}" class="bar-2"/>` : ''}
      </g>
      ${i % labelEvery === 0 ? `<text x="${cx}" y="${H - 8}" class="axis" text-anchor="middle">${label}</text>` : ''}`;
  }).join('');

  $('#weekChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img"
    aria-label="최근 ${range}일 섭취와 소모 칼로리">${grid}${bars}</svg>`;
  $('#weekTitle').textContent = `📊 최근 ${range}일`;

  const withWorkout = data.filter((d) => d.burn > 0).length;
  const avg = (key) => Math.round(data.reduce((s, d) => s + d[key], 0) / data.length);
  $('#weekTiles').innerHTML = `
    <div class="tile"><span class="muted">평균 섭취</span><strong>${avg('intake')}<small> kcal</small></strong></div>
    <div class="tile"><span class="muted">평균 소모</span><strong>${avg('burn')}<small> kcal</small></strong></div>
    <div class="tile"><span class="muted">운동한 날</span><strong>${withWorkout}<small> / ${range}일</small></strong></div>`;
}

// 펼쳐 둔 달을 기억한다. 안 그러면 다시 그릴 때마다 도로 접힌다.
const monthOpen = new Map();

// 하루에 들어있는 모든 글자 (검색용)
function dayText(d) {
  return [...d.workouts.map((w) => w.name), ...d.meals.map((m) => m.name), d.note ?? '']
    .join(' ').toLowerCase();
}

function renderHistory() {
  renderWeekChart();
  renderWeightChart();
  renderLiftChart();
  const q = $('#historySearch').value.trim().toLowerCase();
  const dates = Object.keys(state.days)
    .filter((d) => !isEmptyDay(state.days[d]))
    .filter((d) => !q || dayText(state.days[d]).includes(q))
    .sort().reverse();

  if (!dates.length) {
    $('#historyList').innerHTML = `<p class="muted">${q ? '검색 결과가 없어요.' : '아직 기록이 없어요.'}</p>`;
    return;
  }

  // 달별로 묶고, 가장 최근 달(또는 검색 중일 때는 전부)만 펼쳐 둔다
  const months = {};
  dates.forEach((date) => (months[date.slice(0, 7)] ??= []).push(date));

  $('#historyList').innerHTML = Object.entries(months).map(([month, list], i) => `
    <details class="month" data-month="${month}" ${q || (monthOpen.has(month) ? monthOpen.get(month) : i === 0) ? 'open' : ''}>
      <summary>${month.replace('-', '년 ')}월 <span class="muted">${list.length}일</span></summary>
      ${list.map((date) => {
        const d = state.days[date];
        const kcal = dayIntake(d);
        const burn = dayBurn(date);
        const ex = d.workouts.map((w) => `${esc(w.name)} ${w.sets.length}×${w.sets[0]?.reps ?? 0}`).join(', ');
        return `<div class="card history-day" data-goto="${date}">
          <h3>${date}</h3>
          <div class="muted">🍚 ${d.meals.length}개${kcal ? ` · ${kcal} kcal` : ''}</div>
          <div class="muted">🏋️ ${ex || '운동 없음'}${burn ? ` · 🔥 ${burn} kcal` : ''}</div>
          ${kcal && burn ? `<div class="muted">➖ 순 ${kcal - burn} kcal</div>` : ''}
          ${d.note ? `<div class="muted">📝 ${esc(d.note)}</div>` : ''}
        </div>`;
      }).join('')}
    </details>`).join('');

  // 검색 중에는 전부 펼쳐 보여주는 것이므로 그 상태를 기억하지 않는다
  if (!q) {
    $('#historyList').querySelectorAll('details.month').forEach((el) => {
      el.addEventListener('toggle', () => monthOpen.set(el.dataset.month, el.open));
    });
  }
}

function updateExHint() {
  const name = $('#exName').value.trim();
  const last = name ? lastRecord(name) : null;
  $('#exHint').textContent = last
    ? `↩ 지난번 ${fmtDate(last.date)}: ${setsText(last.workout)}`
    : (name ? '처음 하는 운동이에요.' : '');
}

function renderRoutineBtn() {
  const btn = $('#loadRoutine');
  const date = lastWorkoutDate();
  if (!date) { btn.hidden = true; return; }
  const n = state.days[date].workouts.length;
  btn.hidden = false;
  btn.textContent = `↩ ${fmtDate(date)} 운동 ${n}종 그대로 불러오기`;
  btn.dataset.routine = date;
}

// 지난 운동을 오늘로 복사한다. 완료 체크는 풀고 기록만 가져온다.
function loadRoutine(date) {
  const src = state.days[date];
  if (!src || !confirm(`${fmtDate(date)} 운동 ${src.workouts.length}종을 그대로 불러올까요?`)) return;
  src.workouts.forEach((w) => {
    day().workouts.push({
      id: uid(),
      name: w.name,
      minutes: w.minutes,
      sets: w.sets.map((s) => ({ reps: s.reps, weight: s.weight, done: false })),
    });
  });
  save();
  render();
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

$('#todayBtn').addEventListener('click', () => { currentDate = todayStr(); render(); });
$('#historySearch').addEventListener('input', renderHistory);
$('#liftPick').addEventListener('change', (e) => { liftPick = e.target.value; renderLiftChart(); });
$('#undoBtn').addEventListener('click', undo);

// 좌우로 쓸어서 날짜 이동 (세로 스크롤과 헷갈리지 않게 가로 이동이 더 클 때만)
let touch = null;
document.querySelector('main').addEventListener('touchstart', (e) => {
  touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
document.querySelector('main').addEventListener('touchend', (e) => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x;
  const dy = e.changedTouches[0].clientY - touch.y;
  touch = null;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  currentDate = shiftDate(currentDate, dx < 0 ? 1 : -1);
  render();
}, { passive: true });

$('#themeBtn').addEventListener('click', () => {
  state.profile.theme = state.profile.theme === 'light' ? 'dark' : 'light';
  save();
  applyTheme();
});

$('#bodyWeight').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  day().weight = v > 0 ? v : null;        // 그 날의 체중으로 기록
  if (v > 0) state.profile.weight = v;    // 기본값 캐시
  saveSoon();
  refreshTotals();
});

$('#exName').addEventListener('input', updateExHint);
$('#dayNote').addEventListener('input', (e) => { day().note = e.target.value; saveSoon(); });
$('#dayNote').addEventListener('blur', flushSave);

$('#weightStep').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  state.profile.weightStep = v > 0 ? v : DEFAULT_PROFILE.weightStep;
  saveSoon();
});
$('#restSec').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  state.profile.restSec = v > 0 ? v : DEFAULT_PROFILE.restSec;
  saveSoon();
});
$('#restStop').addEventListener('click', stopRest);
$('#restPlus').addEventListener('click', () => { restEndAt += 30000; drawRest(); });

$('#foodName').addEventListener('input', updateMealHint);
$('#foodAmount').addEventListener('input', updateMealHint);
$('#foodKcal').addEventListener('input', () => { kcalTouched = true; updateMealHint(); });
$('#goalKcal').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  state.profile.goal = v > 0 ? v : null;
  saveSoon();
  renderMeals();
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
    const meal = day().meals.find((m) => m.id === ds.delMeal);
    if (!confirm(`'${meal?.name ?? '이 기록'}'을(를) 삭제할까요?`)) return;
    pushUndo(`'${meal?.name ?? '기록'}' 삭제함`);
    day().meals = day().meals.filter((m) => m.id !== ds.delMeal);
    markDeleted(ds.delMeal);
  } else if (ds.delWorkout) {
    const w = findWorkout(ds.delWorkout);
    if (!confirm('이 운동을 삭제할까요?')) return;
    pushUndo(`'${w?.name ?? '운동'}' 삭제함`);
    day().workouts = day().workouts.filter((x) => x.id !== ds.delWorkout);
    markDeleted(ds.delWorkout);
  } else if (ds.toggle) {
    const [id, i] = ds.toggle.split(':');
    const set = findWorkout(id).sets[i];
    set.done = !set.done;
    if (set.done) startRest();      // 세트를 끝냈으니 휴식 시작
  } else if (ds.step) {
    const [id, i, field, dir] = ds.step.split(':');
    const set = findWorkout(id).sets[i];
    const unit = field === 'weight' ? (Number(state.profile.weightStep) || 2.5) : 1;
    const next = (Number(set[field]) || 0) + unit * Number(dir);
    set[field] = next > 0 ? Math.round(next * 100) / 100 : (field === 'reps' ? 0 : null);
  } else if (ds.routine) {
    loadRoutine(ds.routine);
    return;                          // loadRoutine이 알아서 저장·렌더링한다
  } else if (ds.move) {
    const [id, dir] = ds.move.split(':');
    const list = day().workouts;
    const i = list.findIndex((w) => w.id === id);
    const j = i + Number(dir);
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
  } else if (ds.range) {
    range = Number(ds.range);
    document.querySelectorAll('#rangeSeg button').forEach((b) => b.classList.toggle('on', b === t));
    renderHistory();
    return;
  } else if (ds.fav) {
    const m = favCache[Number(ds.fav)]?.meal;
    if (!m) return;
    day().meals.push({ id: uid(), type: $('#mealType').value, name: m.name, amount: m.amount, kcal: m.kcal });
  } else if (ds.copyMeals) {
    const src = state.days[ds.copyMeals];
    if (!confirm(`${fmtDate(ds.copyMeals)} 식단 ${src.meals.length}개를 그대로 불러올까요?`)) return;
    src.meals.forEach((m) => day().meals.push({ ...m, id: uid() }));
  } else if (ds.delFood) {
    if (!confirm(`등록한 음식 '${ds.delFood}'을(를) 지울까요?`)) return;
    pushUndo(`등록 음식 '${ds.delFood}' 삭제함`);
    delete state.profile.foods[ds.delFood];
  } else if (t.id === 'rememberFood') {
    rememberFood($('#foodName').value, $('#foodAmount').value, Number($('#foodKcal').value));
    kcalTouched = false;
    updateMealHint();
    renderMyFoods();
    return;
  } else if (ds.addSet) {
    const w = findWorkout(ds.addSet);
    const last = w.sets[w.sets.length - 1] || { reps: 10, weight: null };
    w.sets.push({ reps: last.reps, weight: last.weight, done: false });
  } else if (ds.delSet) {
    const [id, i] = ds.delSet.split(':');
    const w = findWorkout(id);
    if (w.sets.length > 1) {
      pushUndo(`${w.name} ${Number(i) + 1}세트 삭제함`);
      w.sets.splice(Number(i), 1);
    } else if (confirm('마지막 세트예요. 이 운동을 삭제할까요?')) {
      pushUndo(`'${w.name}' 삭제함`);
      day().workouts = day().workouts.filter((x) => x.id !== id);
      markDeleted(id);
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
    const v = Number(e.target.value);
    setCustomMet(ds.met, v > 0 ? Math.min(20, Math.max(1, v)) : 0);   // 0이면 자동 추정으로 복귀
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
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);   // 바로 해제하면 브라우저가 받다 말 수 있다
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  // 같은 파일을 다시 고를 수 있으려면 값을 먼저 비워야 한다.
  // (끝에서 비우면 취소로 빠져나갈 때 안 비워져서 두 번째 선택이 먹통이 된다)
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.days) throw new Error('형식 오류');
    if (!confirm('가져온 기록을 지금 기록과 합칠까요?\n(같은 날에 적은 것도 양쪽 다 남습니다)')) return;
    pushUndo('백업 가져오기 실행함');
    // 덮어쓰지 않고 항목 단위로 합친다. 휴대폰↔PC를 파일로 주고받아도 기록이 사라지지 않게.
    const changed = mergeState(data);
    save();
    seedStamps();
    applyTheme();
    render();
    alert(changed ? `${changed}일치를 합쳤어요.` : '가져온 파일에 새로운 내용이 없어요.');
  } catch {
    alert('올바른 백업 파일이 아니에요.');
  }
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js');
}

// 홈 화면에 설치할 수 있으면 버튼을 띄운다. (https로 띄워야 뜬다)
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('#installBtn').hidden = false;
});
$('#installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#installBtn').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });

// 미뤄둔 저장은 탭을 벗어나거나 닫기 전에 반드시 반영한다
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
window.addEventListener('pagehide', flushSave);
window.addEventListener('beforeunload', flushSave);

applyTheme();
seedStamps();
$('#mealType').value = defaultMealType();
render();
initSync();
