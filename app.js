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
  proteinGoal: null, // 하루 목표 단백질 g (안 정했으면 체중 × 1.6 제안)
  weeklyGoal: 3,     // 주 몇 번 운동할지
  waterGoal: 8,      // 하루 물 몇 잔
  routines: {},      // 저장해둔 루틴 { 이름: [{name, reps, sets, minutes}] }
  partGoals: {},     // 부위별 주간 목표 세트 수 { 가슴: 12, ... } — 안 정하면 비교 안 함
  volGoals: {},      // 부위별 주간 목표 볼륨(kg) { 가슴: 6000, ... } — 안 정하면 비교 안 함
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

// 운동 이름으로 부위 추정. MET_TABLE과 같은 규칙 — 위에서 먼저 걸리는 줄을 쓰므로 순서가 중요하다.
const PART_TABLE = [
  ['유산소', /줄넘기|버피|hiit|인터벌|크로스핏|타바타|달리기|러닝|런닝|조깅|뛰기|트레드밀|수영|자전거|바이크|사이클|스피닝|로잉|일립티컬|스텝퍼|유산소|에어로빅|등산|하이킹|계단|걷기|산책|워킹|복싱|배드민턴|테니스|농구|축구|풋살/],
  ['코어', /플랭크|복근|코어|크런치|윗몸|레그레이즈|브릿지|트위스트|앱롤러|할로우|사이드밴드/],
  ['하체', /스쿼트|데드리프트|런지|레그프레스|레그컬|레그익스텐션|힙쓰러스트|힙스러스트|카프|하체|둔근|스플릿|점프/],
  // 팔을 가슴·어깨보다 먼저 본다. "케이블푸시다운"이 케이블(가슴)로 먼저 걸리면 안 된다.
  ['팔', /컬|삼두|이두|트라이셉|바이셉|킥백|푸시다운|딥스머신|암컬|프리처/],
  ['어깨', /숄더|어깨|레터럴|오버헤드|밀리터리|슈러그|아놀드|프론트레이즈|리어델트|후면삼각|측면삼각/],
  ['등', /풀업|턱걸이|철봉|로우|랫|등운동|시티드로|바벨로|백익스텐션|페이스풀|풀다운|친업|굿모닝/],
  ['가슴', /벤치|푸시업|팔굽혀펴기|가슴|체스트|플라이|펙덱|딥스|크로스오버|풀오버|덤벨프레스|머신프레스|인클라인|디클라인/],
  ['전신', /요가|필라테스|스트레칭|폼롤러|케틀벨|마운틴클라이머|점핑잭|trx|스내치|클린/],
];
const PART_ORDER = ['가슴', '등', '하체', '어깨', '팔', '코어', '유산소', '전신', '기타'];
// 계획을 세울 때 "빠진 곳"을 보려면 안 한 부위도 보여야 한다
const MAIN_PARTS = ['가슴', '등', '하체', '어깨', '팔', '코어'];
function partOf(name) {
  const n = metKey(name);
  for (const [part, re] of PART_TABLE) if (re.test(n)) return part;
  return '기타';
}

// 자동완성에 미리 넣어두는 흔한 운동들. 직접 쓴 이름이 먼저 오고 이게 뒤에 붙는다.
// 표기가 흔들리면(벤치프레스 / 벤치 프레스) 같은 운동으로 안 묶여서 최고기록·추이가 갈린다.
const COMMON_EX = [
  '벤치프레스', '인클라인벤치프레스', '덤벨프레스', '인클라인덤벨프레스', '체스트프레스',
  '케이블크로스오버', '펙덱플라이', '덤벨플라이', '딥스', '푸시업',
  '랫풀다운', '풀업', '바벨로우', '덤벨로우', '시티드로우', '티바로우', '페이스풀', '백익스텐션',
  '스쿼트', '핵스쿼트', '레그프레스', '레그컬', '레그익스텐션', '런지', '힙쓰러스트', '카프레이즈',
  '데드리프트', '루마니안데드리프트',
  '오버헤드프레스', '숄더프레스', '아놀드프레스', '사이드레터럴레이즈', '프론트레이즈', '리어델트', '슈러그',
  '바벨컬', '덤벨컬', '해머컬', '프리처컬', '트라이셉익스텐션', '케이블푸시다운', '킥백',
  '플랭크', '크런치', '레그레이즈', '러시안트위스트', '앱롤러',
  '런닝머신', '사이클', '로잉머신', '일립티컬', '스텝퍼', '줄넘기', '버피',
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
  syncAfterEdit();           // 잠잠해지면 Gist에도 올린다 (sync.js)
}

let state = load();
let currentDate = todayStr();
let kcalTouched = false;  // 칼로리를 직접 고쳤으면 자동 계산으로 덮어쓰지 않는다
let pendingPhoto = null;  // 식단 폼에서 고른 사진 id (아직 기록에 안 붙은 상태)
let favCache = [];        // 자주 먹는 음식 칩이 가리키는 목록
let range = 7;            // 통계 기간 (일)
let liftPick = '';        // 중량 추이로 보고 있는 운동
let volPart = '';         // 볼륨 추이로 보고 있는 부위
let exSheetName = null;   // 상세를 열어 둔 운동 이름 (안 열었으면 null)
let sheetPushed = false;  // 상세를 열면서 history에 한 칸 넣었는지 (휴대폰 뒤로가기로 닫으려고)

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
  return !d || (d.meals.length === 0 && d.workouts.length === 0 && !d.note && !d.weight && !d.water && !d.sessionMin);
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
function rememberFood(name, amount, kcal, protein) {
  const key = foodName(name);
  if (!key || !(kcal > 0)) return;
  const grams = amountToGrams(amount, null) ?? DEFAULT_UNITS['인분'];
  if (!state.profile.foods) state.profile.foods = {};
  state.profile.foods[key] = {
    kcal100: Math.round(kcal / grams * 1000) / 10,
    protein: protein > 0 ? Math.round(protein / grams * 1000) / 10 : 0,
    units: {},
  };
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
  const per = (g) => ({
    kcal: Math.round(hit.food.kcal100 * g / 100),
    protein: Math.round((hit.food.protein || 0) * g / 100 * 10) / 10,
    grams: g,
    key: hit.key,
  });
  const grams = amountToGrams(amount, hit.food);
  if (grams != null) return { ...per(grams), assumed: false };
  // 양을 안 적었거나 모르는 단위면 1인분 기준으로 추정
  const base = hit.food.units?.['인분'] ?? hit.food.units?.['개'] ?? hit.food.units?.['그릇'] ?? 100;
  return { ...per(base), assumed: true };
}

function updateMealHint() {
  const name = $('#foodName').value;
  const est = estimateKcal(name, $('#foodAmount').value);
  const hint = $('#mealHint');
  if (!est) {
    if (!kcalTouched) { $('#foodKcal').value = ''; $('#foodProtein').value = ''; }
    const kcal = Number($('#foodKcal').value);     // 비운 뒤에 읽어야 직전 음식 값이 섞이지 않는다
    hint.innerHTML = !name.trim() ? ''
      : kcal > 0
        ? `표에 없는 음식이에요. <button type="button" class="link-btn" id="rememberFood">＋ 이 음식 기억하기</button>`
        : '표에 없는 음식이에요. 칼로리를 직접 적어 주세요.';
    return;
  }
  const custom = state.profile.foods?.[est.key] ? ' (내가 등록한 음식)' : '';
  hint.textContent = `🧮 ${est.key} ${est.grams}g 기준 약 ${est.kcal} kcal · 단백질 ${est.protein}g${custom}${est.assumed ? ' · 양을 안 적어 1인분으로 추정' : ''}`;
  if (!kcalTouched) { $('#foodKcal').value = est.kcal; $('#foodProtein').value = est.protein || ''; }
}
function resetMealForm() {
  $('#foodName').value = $('#foodAmount').value = $('#foodKcal').value = $('#foodProtein').value = '';
  $('#mealHint').textContent = '';
  $('#photoName').textContent = '';
  $('#mealPhoto').value = '';
  pendingPhoto = null;
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
// 세트를 완료한 시각(set.doneAt)으로 세트 사이 쉰 시간을 되짚는다.
// 20분이 넘으면 쉰 게 아니라 자리를 비운 것으로 보고 뺀다.
const MAX_REST_SEC = 20 * 60;
function restGaps(w) {
  const stamps = w.sets.map((s) => Number(s.doneAt) || 0).filter(Boolean).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < stamps.length; i++) {
    const sec = Math.round((stamps[i] - stamps[i - 1]) / 1000);
    if (sec > 0 && sec <= MAX_REST_SEC) gaps.push(sec);
  }
  return gaps;
}
function avgRest(w) {
  const gaps = restGaps(w);
  return gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0;
}
function mmss(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function volumeOf(w) {
  return countedSets(w).reduce((v, s) => v + (Number(s.reps) || 0) * (Number(s.weight) || 0), 0);
}
// 1회 최대 중량 추정 (Epley). 100kg×1(=100)보다 90kg×8(=114)이 더 센 기록인데,
// 최고 중량만 보면 그걸 구분하지 못해서 세트끼리 비교할 땐 이 값을 쓴다.
function oneRM(weight, reps) {
  if (!(weight > 0) || !(reps > 0)) return 0;
  if (reps === 1) return Math.round(weight);      // 1회를 실제로 들었으면 그게 곧 1RM (공식대로면 3% 부풀려진다)
  if (reps > 12) reps = 12;                       // 고반복은 공식이 과하게 잡혀 12회로 제한
  return Math.round(weight * (1 + reps / 30));
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
        const rm = oneRM(weight, reps);
        const better = !best
          || rm > best.rm
          || (rm === best.rm && weight > best.weight)   // 같은 1RM이면 더 무겁게 든 쪽
          || (!rm && !best.rm && reps > best.reps);     // 맨몸 운동은 횟수로
        if (better) best = { weight, reps, rm, date };
      }
    }
  }
  return best;
}

// ---------- 점진적 과부하 제안 ----------
// 지난번에 목표 횟수를 다 채웠으면 다음엔 조금 올리라고 알려준다.
// "다 채웠다"는 완료 체크한 세트가 2개 이상이고, 그 세트들의 횟수가 모두 첫 세트 이상인 경우.
function overloadTip(name, before = currentDate) {
  const last = lastRecord(name, before);
  if (!last) return null;
  const sets = countedSets(last.workout);
  if (sets.length < 2) return null;
  const target = Number(sets[0].reps) || 0;
  if (!target) return null;
  const allDone = sets.every((s) => (Number(s.reps) || 0) >= target);
  if (!allDone) return null;

  const weight = Number(sets[0].weight) || 0;
  if (weight > 0) {
    const step = Number(state.profile.weightStep) || 2.5;
    return { kind: 'weight', from: weight, to: Math.round((weight + step) * 100) / 100, reps: target, date: last.date };
  }
  // 맨몸 운동은 무게 대신 횟수를 올린다
  return { kind: 'reps', from: target, to: target + 2, date: last.date };
}
function overloadText(tip) {
  return tip.kind === 'weight'
    ? `💪 지난번 ${tip.from}kg × ${tip.reps}회를 다 채웠어요. 오늘은 ${tip.to}kg 어때요?`
    : `💪 지난번 ${tip.from}회를 다 채웠어요. 오늘은 ${tip.to}회 어때요?`;
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
// 운동을 한 날인지 (세트가 하나라도 있는 날)
function didWorkout(date) {
  return (state.days[date]?.workouts?.length || 0) > 0;
}
// 오늘(또는 어제)부터 거꾸로 세는 연속 운동 일수.
// 오늘 아직 안 했어도 어제까지 이어온 기록은 살아 있는 것으로 본다.
function workoutStreak(from = todayStr()) {
  let start = from;
  if (!didWorkout(start)) {
    start = shiftDate(from, -1);
    if (!didWorkout(start)) return 0;
  }
  let n = 0;
  for (let d = start; didWorkout(d); d = shiftDate(d, -1)) n += 1;
  return n;
}
// 이번 주(월요일 시작) 운동한 날 수
function weekStart(date = currentDate) {
  const d = new Date(date + 'T00:00:00');
  const back = (d.getDay() + 6) % 7;      // 월요일을 0으로
  return shiftDate(date, -back);
}
function weeklyCount(date = currentDate) {
  const start = weekStart(date);
  let n = 0;
  for (let i = 0; i < 7; i++) if (didWorkout(shiftDate(start, i))) n += 1;
  return n;
}
// 그 부위를 마지막으로 한 날 (보고 있는 날 이전까지)
function lastPartDay(part, before = currentDate) {
  for (const date of Object.keys(state.days).filter((d) => d <= before).sort().reverse()) {
    if (state.days[date].workouts.some((w) => partOf(w.name) === part)) return date;
  }
  return null;
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
function restText(date) {
  if (!date) return '안 함';
  const n = daysBetween(date, currentDate);
  return n === 0 ? '오늘' : n === 1 ? '어제' : `${n}일 전`;
}

// 최근 N일 부위별 세트 수
function partBalance(days = range, endDate = currentDate) {
  const tally = new Map(PART_ORDER.map((p) => [p, 0]));
  for (let i = 0; i < days; i++) {
    const d = state.days[shiftDate(endDate, -i)];
    d?.workouts?.forEach((w) => {
      const n = countedSets(w).length;
      tally.set(partOf(w.name), (tally.get(partOf(w.name)) || 0) + n);
    });
  }
  return [...tally].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
}

function dayIntake(d) {
  return d.meals.reduce((s, m) => s + (Number(m.kcal) || 0), 0);
}
function dayProtein(d) {
  return Math.round(d.meals.reduce((s, m) => s + (Number(m.protein) || 0), 0));
}
// 목표를 안 정했으면 체중 1kg당 1.6g을 기준으로 제안한다 (근력 운동 시 흔히 쓰는 값)
function proteinGoal() {
  const g = Number(state.profile.proteinGoal);
  return g > 0 ? g : Math.round(bodyWeight() * 1.6);
}

// ---------- 실행취소 ----------
// 지우기 직전 상태를 통째로 들고 있다가 되돌린다. 개인용 기록이라 크기가 작아 이 방식이 가장 단순하다.
let undoSnapshot = null;
let undoTimer = null;
// 사진은 되돌리기로 살릴 수 없으니 바로 지우지 않고, 되돌릴 수 없게 된 뒤에 지운다.
let photosToDrop = [];
function dropPhotosNow() {
  photosToDrop.forEach((id) => deletePhoto(id));
  photosToDrop = [];
}

function pushUndo(label) {
  dropPhotosNow();              // 앞 기록은 이제 되돌릴 수 없으니 그 사진은 정리
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
  dropPhotosNow();              // 되돌릴 기회가 끝났으니 사진도 정리
}
function undo() {
  if (!undoSnapshot) return;
  photosToDrop = [];            // 되살리므로 사진은 그대로 둔다
  state = JSON.parse(undoSnapshot);
  save();
  hideUndo();
  applyTheme();
  render();
}

// ---------- 화면 꺼짐 방지 ----------
// 운동하는 동안 폰이 꺼지면 세트마다 다시 켜야 한다. 세션이 도는 동안만 붙잡는다.
// 화면을 가리면 브라우저가 알아서 풀어버리므로 돌아올 때 다시 잡아야 한다.
let wakeLock = null;

async function keepScreenOn(on) {
  if (!('wakeLock' in navigator)) return;
  try {
    if (on) {
      if (wakeLock) return;
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; renderSession(); });
    } else if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;             // 배터리 절약 모드 등에서는 거절당한다
  }
  renderSession();
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && sessionOn()) keepScreenOn(true);
});

// ---------- 운동 세션 (전체 시간) ----------
// 시작을 누르면 그 날에 시작 시각을 적어두고, 끝내면 분으로 바꿔 저장한다.
let sessionTicker = null;

function sessionOn() {
  return Number(day().sessionStart) > 0;
}
function toggleSession() {
  const d = day();
  if (sessionOn()) {
    const mins = Math.max(1, Math.round((Date.now() - d.sessionStart) / 60000));
    d.sessionMin = (Number(d.sessionMin) || 0) + mins;
    d.sessionStart = null;
    keepScreenOn(false);
  } else {
    d.sessionStart = Date.now();
    keepScreenOn(true);
  }
  save();
  renderSession();
  renderWorkouts();
}
function renderSession() {
  const d = state.days[currentDate];
  const done = Number(d?.sessionMin) || 0;
  const running = Number(d?.sessionStart) > 0;
  const live = running ? Math.floor((Date.now() - d.sessionStart) / 60000) : 0;
  const total = done + live;

  $('#sessionBtn').textContent = running ? '⏹ 운동 끝내기' : '▶️ 운동 시작';
  $('#sessionBtn').classList.toggle('primary', !running);
  $('#sessionBtn').classList.toggle('running', running);
  $('#sessionText').innerHTML = running
    ? `진행 중 · ${total}분${wakeLock ? ' · <span class="tip">🔆 화면 안 꺼짐</span>' : ''}`
    : (total ? `오늘 ${total}분 운동` : '눌러서 시간을 재요');

  clearInterval(sessionTicker);
  if (running) sessionTicker = setInterval(renderSession, 20000);
  else if (wakeLock && !sessionOn()) keepScreenOn(false);
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
  renderPlan();
  renderRoutines();
  renderSession();
  renderSync();
  updateExHint();
  const note = $('#dayNote');
  if (document.activeElement !== note) note.value = day().note ?? '';
  if (exSheetName) renderExSheet();   // 열어 둔 상세도 같이 갱신 (안 하면 방금 적은 세트가 안 보인다)
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

  const prot = dayProtein(d);
  const pg = proteinGoal();
  $('#proteinBar').hidden = !meals.length;
  if (meals.length) {
    const pct = Math.min(100, Math.round(prot / pg * 100));
    $('#proteinBar').innerHTML = `
      <div class="bar-head"><span>🥩 단백질</span><strong>${prot} / ${pg} g</strong></div>
      <div class="bar"><span style="width:${pct}%"></span></div>`;
  }

  renderFavorites();
  renderWater();
  renderMealCopyBtn();
  renderMyFoods();
  const goalInput = $('#goalKcal');
  if (document.activeElement !== goalInput) goalInput.value = state.profile.goal ?? '';
  const pgInput = $('#proteinGoal');
  if (document.activeElement !== pgInput) pgInput.value = state.profile.proteinGoal ?? '';
  $('#proteinGoalHint').textContent = state.profile.proteinGoal
    ? '' : `안 적으면 체중 × 1.6 = ${proteinGoal()}g으로 잡아요.`;

  $('#mealList').innerHTML = MEAL_ORDER.map((type) => {
    const list = meals.filter((m) => m.type === type);
    if (!list.length) return '';
    const sub = list.reduce((s, m) => s + (Number(m.kcal) || 0), 0);
    const subP = Math.round(list.reduce((s, m) => s + (Number(m.protein) || 0), 0));
    return `<div class="card"><h3>${type} <span class="muted">${sub ? sub + ' kcal' : ''}${subP ? ` · 단백질 ${subP}g` : ''}</span></h3>
      ${list.map((m) => `<div class="item">
        ${m.photo ? `<span class="photo-wrap"><img data-photo="${esc(m.photo)}" alt="" loading="lazy"></span>` : ''}
        <div class="grow">${esc(m.name)} <span class="muted">${esc(m.amount)}${m.kcal ? ' · ' + m.kcal + ' kcal' : ''}${m.protein ? ' · 단백질 ' + m.protein + 'g' : ''}</span></div>
        <button class="del" data-del-meal="${m.id}" aria-label="삭제">✕</button>
      </div>`).join('')}</div>`;
  }).join('');

  fillPhotos($('#mealList'));   // 사진은 IndexedDB에 있어서 그린 뒤에 채운다
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

function renderWater() {
  const cups = Number(day().water) || 0;
  const goal = Number(state.profile.waterGoal) || 8;
  $('#waterRow').innerHTML = `
    <div class="bar-head"><span>💧 물</span><strong>${cups} / ${goal}잔</strong></div>
    <div class="cups">
      ${Array.from({ length: goal }, (_, i) => `<span class="cup ${i < cups ? 'on' : ''}"></span>`).join('')}
    </div>
    <div class="row water-btns">
      <button data-water="-1" aria-label="한 잔 빼기">−</button>
      <button data-water="1" class="primary">💧 한 잔 마심</button>
    </div>`;
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
          <div>${esc(key)} <span class="muted">100g당 ${f.kcal100} kcal${f.protein ? ` · 단백질 ${f.protein}g` : ''}</span></div>
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
      : pr.rm ? `🏆 최고 ${pr.weight} kg × ${pr.reps}회 <span class="muted">(1RM ${pr.rm}kg)</span>`
      : `🏆 최고 ${pr.reps}회`;
    const isNewPr = pr && pr.date === currentDate;   // 보고 있는 날에 세운 기록
    const last = lastRecord(w.name);
    const tip = overloadTip(w.name);
    const rest = avgRest(w);
    const todayRm = Math.max(0, ...countedSets(w).map((x) => oneRM(Number(x.weight) || 0, Number(x.reps) || 0)));
    return `<div class="card">
    <div class="item"><h3><button class="ex-title" data-ex-detail="${esc(w.name)}">${esc(w.name)} <span aria-hidden="true">›</span></button></h3>
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
    <input class="ex-note" type="text" placeholder="메모 (그립, 자세, 컨디션…)"
           value="${esc(w.note ?? '')}" data-ex-note="${w.id}">
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
      <span class="muted">${done ? `${done}/${w.sets.length}세트 완료 · ` : ''}볼륨 ${vol.toLocaleString()} kg${
        todayRm ? ` · 오늘 1RM ${todayRm}kg` : ''}${rest ? ` · 휴식 ${mmss(rest)}` : ''}</span>
    </div>
    ${last ? `<div class="item pr">
      <span class="muted">↩ 지난번 ${fmtDate(last.date)}</span>
      <span class="muted">${setsText(last.workout)}</span>
    </div>${last.workout.note ? `<div class="item pr"><span class="muted">📝 ${esc(last.workout.note)}</span></div>` : ''}` : ''}
    ${tip ? `<div class="item pr"><span class="tip">${overloadText(tip)}</span></div>` : ''}
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
function lineChart(points, { unit, cls, fmt }) {
  if (points.length < 1) return '';
  const W = 340, H = 150, L = 38, R = 8, T = 12, B = 22;
  const plotW = W - L - R, plotH = H - T - B;
  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.15;
  lo -= pad; hi += pad;
  // 눈금은 읽을 수 있는 수로. 안 다듬으면 여백 15% 때문에 "94.95" 같은 값이 축에 박힌다.
  const tick = fmt ?? ((v) => (hi - lo >= 10 ? Math.round(v) : Math.round(v * 10) / 10));
  const x = (i) => points.length === 1 ? L + plotW / 2 : L + (i / (points.length - 1)) * plotW;
  const y = (v) => T + plotH - ((v - lo) / (hi - lo)) * plotH;

  const grid = [0, 0.5, 1].map((f) => {
    const gy = T + plotH - f * plotH;
    return `<line x1="${L}" y1="${gy}" x2="${W - R}" y2="${gy}" class="grid"/>
            <text x="${L - 6}" y="${gy + 4}" class="axis" text-anchor="end">${tick(lo + (hi - lo) * f)}</text>`;
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

// 그 운동을 한 날마다 그날의 최고 1RM.
// 그냥 최고 중량으로 그리면 "같은 무게로 횟수를 늘린 날"이 제자리처럼 보인다.
function liftHistory(name) {
  const key = metKey(name);
  return Object.keys(state.days).sort().map((date) => {
    const w = state.days[date].workouts.find((x) => metKey(x.name) === key);
    if (!w) return null;
    const top = Math.max(0, ...countedSets(w).map((s) => oneRM(Number(s.weight) || 0, Number(s.reps) || 0)));
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

// ---------- 운동 상세 ----------
// 한 운동의 모든 기록을 최근 날짜부터. 같은 날 같은 운동을 두 번 적었으면 둘 다 남긴다.
function exerciseLog(name) {
  const key = metKey(name);
  const out = [];
  for (const date of Object.keys(state.days).sort().reverse()) {
    for (const w of state.days[date].workouts) {
      if (metKey(w.name) === key) out.push({ date, w });
    }
  }
  return out;
}

const SHEET_ROWS = 30;   // 기록이 쌓여도 한 번에 다 그리면 무겁다

function openExSheet(name) {
  if (!String(name ?? '').trim()) return;
  exSheetName = name;
  // 휴대폰 뒤로가기로 닫히게 한 칸 넣어 둔다 (없으면 앱에서 나가 버린다)
  if (!sheetPushed) {
    try { history.pushState({ exSheet: 1 }, ''); sheetPushed = true; } catch { /* file://에서 막히면 그냥 버튼으로 닫는다 */ }
  }
  document.body.classList.add('sheet-open');
  renderExSheet();
}

function closeExSheet(fromPop = false) {
  if (!exSheetName) return;
  exSheetName = null;
  $('#exSheet').hidden = true;
  document.body.classList.remove('sheet-open');
  if (sheetPushed && !fromPop) history.back();   // 뒤로가기로 닫힌 게 아니면 넣어 둔 칸을 되돌린다
  sheetPushed = false;
}

function renderExSheet() {
  const name = exSheetName;
  const log = exerciseLog(name);
  $('#exSheet').hidden = false;
  $('#exSheetTitle').textContent = name;
  if (!log.length) {
    $('#exSheetBody').innerHTML = '<p class="muted">아직 이 운동 기록이 없어요.</p>';
    return;
  }

  const sets = log.reduce((n, x) => n + countedSets(x.w).length, 0);
  const vol = log.reduce((v, x) => v + volumeOf(x.w), 0);
  // 맨몸 운동은 볼륨이 늘 0이라 타일이 비어 보인다. 그럴 땐 총 횟수를 보여준다.
  const reps = log.reduce((n, x) => n + countedSets(x.w).reduce((r, t) => r + (Number(t.reps) || 0), 0), 0);
  const pr = personalBest(name);
  const dates = [...new Set(log.map((x) => x.date))];
  const first = dates[dates.length - 1];
  const points = liftHistory(name);
  const notes = log.filter((x) => x.w.note);

  const prText = !pr ? ''
    : pr.rm ? `🏆 최고 <b>${pr.weight} kg × ${pr.reps}회</b> <span class="muted">(1RM ${pr.rm}kg)</span>`
    : `🏆 최고 <b>${pr.reps}회</b>`;

  const rows = log.slice(0, SHEET_ROWS).map(({ date, w }) => `
    <div class="log-row">
      <button class="link-btn" data-goto="${date}">${fmtDate(date)}</button>
      <span>${esc(setsText(w))}</span>
      <span class="muted">${volumeOf(w) ? volumeOf(w).toLocaleString() + ' kg' : `${countedSets(w).length}세트`}</span>
    </div>`).join('');

  $('#exSheetBody').innerHTML = `
    <p class="muted">${partOf(name)} · MET ${metOf(name)} · ${dates.length}번 함
      · 처음 ${fmtDate(first)} · 마지막 ${restText(dates[0])}</p>
    <div class="tiles">
      <div class="tile"><span class="muted">총 세트</span><strong>${sets}</strong></div>
      ${vol ? `<div class="tile"><span class="muted">총 볼륨</span><strong>${Math.round(vol).toLocaleString()}<small> kg</small></strong></div>
      <div class="tile"><span class="muted">최고 1RM</span><strong>${pr?.rm || '-'}<small>${pr?.rm ? ' kg' : ''}</small></strong></div>`
      : `<div class="tile"><span class="muted">총 횟수</span><strong>${reps.toLocaleString()}<small> 회</small></strong></div>
      <div class="tile"><span class="muted">최고</span><strong>${pr?.reps || '-'}<small>${pr?.reps ? ' 회' : ''}</small></strong></div>`}
    </div>
    ${prText ? `<p class="pr-line">${prText} <span class="muted">${fmtDate(pr.date)}</span></p>` : ''}
    <h4>1RM 추이 <span class="muted">(전체 기간)</span></h4>
    ${points.length >= 2
      ? lineChart(points, { unit: 'kg', cls: 'l' })
      : `<p class="muted">${points.length ? '기록이 하나뿐이라 아직 선이 안 그려져요.' : '중량 기록이 없어요. (맨몸 운동은 그려지지 않아요)'}</p>`}
    ${notes.length ? `<h4>📝 메모</h4>${notes.slice(0, SHEET_ROWS).map(({ date, w }) => `
      <div class="log-row"><button class="link-btn" data-goto="${date}">${fmtDate(date)}</button>
        <span>${esc(w.note)}</span></div>`).join('')}` : ''}
    <h4>기록 ${log.length > SHEET_ROWS ? `<span class="muted">(최근 ${SHEET_ROWS}개)</span>` : ''}</h4>
    ${rows}`;
}

function renderBalance() {
  const counts = new Map(partBalance());
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  const card = $('#balanceCard');
  if (!total && !Object.keys(state.days).some((d) => state.days[d].workouts.length)) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  // 안 한 부위도 보여야 뭐가 빠졌는지 안다. 오래 쉰 순으로 세워서 바로 "오늘 뭐 하지"가 보이게.
  const names = [...new Set([...MAIN_PARTS, ...counts.keys()])];
  const rows = names.map((part) => {
    const last = lastPartDay(part);
    return { part, n: counts.get(part) || 0, last, rest: last ? daysBetween(last, currentDate) : 999 };
  }).sort((a, b) => b.rest - a.rest || a.n - b.n);

  // 목표는 "주간" 기준이라 7일을 볼 때만 견준다
  const goals = range === 7 ? (state.profile.partGoals || {}) : {};
  const max = Math.max(1, ...rows.map((r) => r.n));
  $('#balanceList').innerHTML = rows.map((r) => {
    const goal = Number(goals[r.part]) || 0;
    const pct = goal ? Math.min(100, Math.round(r.n / goal * 100)) : Math.round(r.n / max * 100);
    return `<div class="bal ${r.rest >= 999 ? 'never' : ''}">
      <span class="bal-name">${r.part}</span>
      <span class="bar ${goal && r.n >= goal ? 'full' : ''}"><span style="width:${pct}%"></span></span>
      <span class="bal-n">${goal ? `${r.n}/${goal}` : (r.n ? r.n + '세트' : '-')}</span>
      <span class="bal-ago">${restText(r.last)}</span>
    </div>`;
  }).join('');

  // 목표를 입력하는 중에 다시 그리면 칸이 통째로 갈려서 입력이 끊긴다.
  // (여기서 return해 버리면 아래 안내 문구까지 건너뛰므로 이 블록만 건너뛴다)
  const goalBox = $('#partGoals');
  if (!goalBox.contains(document.activeElement)) {
    goalBox.innerHTML = MAIN_PARTS.map((p) => `
      <label class="goal-cell">${p}
        <input type="number" inputmode="numeric" min="0" max="60" step="2"
               value="${state.profile.partGoals?.[p] ?? ''}" placeholder="-" data-part-goal="${p}">
      </label>`).join('');
  }

  // 오늘 할 것 추천: 주요 부위 중 가장 오래 쉰 둘
  const due = rows.filter((r) => MAIN_PARTS.includes(r.part) && r.rest >= 2).slice(0, 2);
  const short = Object.keys(goals).filter((p) => (counts.get(p) || 0) < Number(goals[p]));
  $('#balanceHint').innerHTML = due.length
    ? `💡 <b>오늘은 ${due.map((r) => r.part).join('·')} 차례</b>예요. (가장 오래 쉬었어요)` +
      (short.length ? ` · 목표까지 ${short.map((p) => `${p} ${goals[p] - (counts.get(p) || 0)}세트`).join(', ')}` : '')
    : `최근 ${range}일 · 총 ${total}세트`;
}

function renderStreak() {
  const streak = workoutStreak();
  const wk = weeklyCount();
  const goal = Number(state.profile.weeklyGoal) || 3;
  $('#streakTiles').innerHTML = `
    <div class="tile"><span class="muted">이번 주</span><strong>${wk}<small> / ${goal}회</small></strong></div>
    <div class="tile"><span class="muted">연속</span><strong>${streak}<small> 일</small></strong></div>
    <div class="tile"><span class="muted">주간 목표</span>
      <input id="weeklyGoal" type="number" inputmode="numeric" min="1" max="7" value="${goal}"></div>`;
  $('#streakMsg').textContent = wk >= goal
    ? '🎉 이번 주 목표를 채웠어요!'
    : `이번 주 ${goal - wk}번 더 하면 목표 달성이에요.`;
}

// 최근 7일과 그 앞 7일을 견줘 한 줄로 정리한다.
function weekReport(endDate = currentDate) {
  const sum = (from, to) => {
    let sets = 0, vol = 0, burn = 0, intake = 0, days = 0, minutes = 0, mealDays = 0;
    for (let d = from; d <= to; d = shiftDate(d, 1)) {
      const day = state.days[d];
      if (!day) continue;
      const w = day.workouts || [];
      if (w.length) days += 1;
      w.forEach((x) => { sets += countedSets(x).length; vol += volumeOf(x); minutes += minutesOf(x); });
      burn += dayBurn(d);
      const kcal = dayIntake(day);
      if (kcal) { intake += kcal; mealDays += 1; }   // 안 적은 날까지 나누면 평균이 엉뚱해진다
    }
    return { sets, vol, burn, intake, days, minutes, mealDays };
  };
  const now = sum(shiftDate(endDate, -6), endDate);
  const prev = sum(shiftDate(endDate, -13), shiftDate(endDate, -7));
  const prs = [];
  for (let i = 0; i < 7; i++) {
    const d = shiftDate(endDate, -i);
    (state.days[d]?.workouts || []).forEach((w) => {
      const pb = personalBest(w.name);
      if (pb && pb.date === d && !prs.includes(w.name)) prs.push(w.name);
    });
  }
  return { now, prev, prs };
}
function pctText(now, prev) {
  if (!prev) return now ? ' <span class="up">(새로)</span>' : '';
  const diff = Math.round((now - prev) / prev * 100);
  if (!diff) return ' <span class="muted">(지난주와 같음)</span>';
  return ` <span class="${diff > 0 ? 'up' : 'down'}">(${diff > 0 ? '+' : ''}${diff}%)</span>`;
}

function renderReport() {
  const { now, prev, prs } = weekReport();
  const card = $('#reportCard');
  if (!now.days && !prev.days) { card.hidden = true; return; }
  card.hidden = false;
  $('#reportBody').innerHTML = `
    <div class="item"><span>운동한 날</span><strong>${now.days}일${pctText(now.days, prev.days)}</strong></div>
    <div class="item"><span>총 세트</span><strong>${now.sets}세트${pctText(now.sets, prev.sets)}</strong></div>
    <div class="item"><span>총 볼륨</span><strong>${now.vol.toLocaleString()} kg${pctText(now.vol, prev.vol)}</strong></div>
    <div class="item"><span>운동 시간</span><strong>${now.minutes}분${pctText(now.minutes, prev.minutes)}</strong></div>
    <div class="item"><span>소모 칼로리</span><strong>${now.burn.toLocaleString()} kcal${pctText(now.burn, prev.burn)}</strong></div>
    ${now.mealDays ? `<div class="item"><span>평균 섭취 <span class="muted">(적은 ${now.mealDays}일)</span></span><strong>${Math.round(now.intake / now.mealDays)} kcal${pctText(Math.round(now.intake / now.mealDays), prev.mealDays ? Math.round(prev.intake / prev.mealDays) : 0)}</strong></div>` : ''}
    ${prs.length ? `<p class="tip">🎉 이번 주 신기록: ${prs.map(esc).join(', ')}</p>` : ''}`;
}

// 기간을 날짜/주 단위로 쪼개 그 부위의 볼륨을 더한다.
// 7일이면 하루씩, 그보다 길면 한 주씩 묶어야 막대가 너무 잘아지지 않는다.
// 묶음은 보고 있는 날에서 거꾸로 센다. 앞에서부터 세면 기간이 step으로 딱 나뉘지 않을 때
// 오늘이 들어 있는 마지막 며칠이 빠져서, 방금 한 운동이 그래프에 안 나온다.
function partVolumeBuckets(part, days = range, endDate = currentDate) {
  const step = days <= 7 ? 1 : 7;
  const out = [];
  for (let i = 0; i < days; i += step) {
    const to = shiftDate(endDate, -i);
    const from = shiftDate(endDate, -Math.min(i + step - 1, days - 1));
    let vol = 0;
    for (let d = from; d <= to; d = shiftDate(d, 1)) {
      (state.days[d]?.workouts || []).forEach((w) => {
        if (partOf(w.name) === part) vol += volumeOf(w);
      });
    }
    out.unshift({ date: to, from, days: Math.min(i + step, days) - i, value: Math.round(vol) });
  }
  return out;
}

// 부위별 주간 볼륨 목표 (kg). 안 정하면 0이라 비교하지 않는다.
function volGoal(part) {
  const g = state.profile.volGoals;
  return g && Object.hasOwn(g, part) ? Number(g[part]) || 0 : 0;
}

// 목표를 정할 때 참고할 최근 4주 평균. 100kg 단위로 다듬어야 고르기 편하다.
function avgWeekVolume(part) {
  const weeks = partVolumeBuckets(part, 28).filter((b) => b.days === 7);
  if (!weeks.length) return 0;
  const avg = weeks.reduce((s, b) => s + b.value, 0) / weeks.length;
  return Math.round(avg / 100) * 100;
}

function renderVolumeChart() {
  const card = $('#volCard');
  // 볼륨이 잡히는 부위만 (맨몸·유산소는 볼륨이 0이라 그릴 게 없다)
  const parts = PART_ORDER.filter((p) => partVolumeBuckets(p, 90).some((b) => b.value > 0));
  if (!parts.length) { card.hidden = true; return; }
  card.hidden = false;
  if (!parts.includes(volPart)) volPart = parts[0];
  $('#volPick').innerHTML = parts.map((p) =>
    `<option value="${p}"${p === volPart ? ' selected' : ''}>${p}</option>`).join('');
  renderVolGoalBox();

  const buckets = partVolumeBuckets(volPart);
  const total = buckets.reduce((s, b) => s + b.value, 0);
  const goal = volGoal(volPart);
  if (!total) {
    $('#volChart').innerHTML = `<p class="muted">이 기간에 ${volPart} 볼륨 기록이 없어요.</p>`;
    return;
  }
  const stepName = range <= 7 ? '하루' : '한 주';
  // 목표는 "주간" 기준이다. 7일을 볼 때는 막대가 하루씩이라 선을 그으면 안 되고(하루 목표가 아니다),
  // 합계가 곧 이번 주 볼륨이라 글로 견준다. 30·90일은 막대가 한 주씩이라 선이 그대로 맞는다.
  const weekly = range > 7;
  let goalText = '';
  if (goal && weekly) {
    const full = buckets.filter((b) => b.days === 7);
    const hit = full.filter((b) => b.value >= goal).length;
    goalText = ` · 주간 목표 ${goal.toLocaleString()} kg (${full.length}주 중 ${hit}주 달성)`;
  } else if (goal) {
    const left = goal - total;
    goalText = ` · 주간 목표 ${goal.toLocaleString()} kg (${Math.round(total / goal * 100)}%` +
      (left > 0 ? `, ${left.toLocaleString()} kg 남음)` : ', 달성 🎉)');
  }
  $('#volChart').innerHTML =
    `<p class="muted">${stepName}씩 · 최근 ${range}일 합계 ${total.toLocaleString()} kg${goalText}</p>` +
    barChart(buckets, { unit: 'kg', cls: 'v', goal: weekly ? goal : 0 });
}

// 목표 칸은 그래프와 따로 그린다. 같이 그리면 숫자를 치는 동안 칸이 갈려서 입력이 끊긴다.
function renderVolGoalBox() {
  const box = $('#volGoalBox');
  // 숫자를 치는 동안에만 건드리지 않는다. 버튼에 포커스가 있다고 건너뛰면
  // "평균으로"를 눌러도 칸에 값이 안 들어간 것처럼 보인다.
  if (box.querySelector('input') === document.activeElement) return;
  const avg = avgWeekVolume(volPart);
  box.innerHTML = `
    <label class="goal-cell">${volPart} 주간 목표
      <input type="number" inputmode="numeric" min="0" max="200000" step="100"
             value="${volGoal(volPart) || ''}" placeholder="${avg || '-'}" data-vol-goal="${volPart}">
    </label><span class="unit">kg</span>
    ${avg ? `<button class="link-btn" data-vol-goal-avg="${avg}">최근 4주 평균(${avg.toLocaleString()})으로</button>` : ''}`;
}

// 축 눈금용 짧은 수. 1500을 "2k"로 적으면 절반 눈금이 최댓값과 같아 보이므로 소수 한 자리를 남긴다.
function shortNum(v) {
  if (v < 1000) return String(v);
  const k = v / 1000;
  return (k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)) + 'k';
}

// 값 하나짜리 막대그래프 (부위별 볼륨용). 색이 하나라 범례 없이 제목으로 구분한다.
function barChart(points, { unit, cls, goal = 0 }) {
  const W = 340, H = 150, L = 42, R = 8, T = 12, B = 22;
  const plotW = W - L - R, plotH = H - T - B;
  // 목표선도 축 안에 들어와야 보인다. 목표를 아직 한참 못 넘겼어도 선이 잘리면 안 된다.
  const top = Math.max(1, goal, ...points.map((p) => p.value));
  const step = plotW / points.length;
  const barW = Math.max(2, Math.min(28, step * 0.62));
  const y = (v) => T + plotH - (v / top) * plotH;
  const labelEvery = Math.ceil(points.length / 6);

  const grid = [0, 0.5, 1].map((f) => {
    const gy = T + plotH - f * plotH;
    const v = Math.round(top * f);
    return `<line x1="${L}" y1="${gy}" x2="${W - R}" y2="${gy}" class="grid"/>
            <text x="${L - 6}" y="${gy + 4}" class="axis" text-anchor="end">${shortNum(v)}</text>`;
  }).join('');

  const bars = points.map((p, i) => {
    const cx = L + step * i + step / 2;
    const h = T + plotH - y(p.value);
    const when = p.from && p.from !== p.date ? `${fmtDate(p.from)}~${fmtDate(p.date)}` : fmtDate(p.date);
    return `<g><title>${when} · ${p.value.toLocaleString()}${unit}</title>
      ${p.value ? `<path d="${barPath(cx - barW / 2, y(p.value), barW, h)}" class="${cls}-bar"/>` : ''}</g>
      ${i % labelEvery === 0 ? `<text x="${cx.toFixed(1)}" y="${H - 6}" class="axis" text-anchor="middle">${fmtDate(p.date)}</text>` : ''}`;
  }).join('');

  const goalLine = goal ? `<line x1="${L}" y1="${y(goal).toFixed(1)}" x2="${W - R}" y2="${y(goal).toFixed(1)}" class="goal-line"/>
    <text x="${W - R}" y="${(y(goal) - 4).toFixed(1)}" class="axis" text-anchor="end">목표</text>` : '';

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${grid}${goalLine}${bars}</svg>`;
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
  return [...d.workouts.flatMap((w) => [w.name, w.note ?? '']), ...d.meals.map((m) => m.name), d.note ?? '']
    .join(' ').toLowerCase();
}

function renderHistory() {
  renderStreak();
  renderReport();
  renderWeekChart();
  renderBalance();
  renderWeightChart();
  renderLiftChart();
  renderVolumeChart();
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
          ${d.workouts.length && date !== currentDate
            ? `<button class="link-btn day-copy" data-copy-day="${date}">↩ 이 날 운동 불러오기</button>` : ''}
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
  const tip = name ? overloadTip(name) : null;
  $('#exHint').innerHTML = last
    ? `↩ 지난번 ${fmtDate(last.date)}: ${esc(setsText(last.workout))}` +
      (last.workout.note ? `<br>📝 ${esc(last.workout.note)}` : '') +
      (tip ? `<br><span class="tip">${overloadText(tip)}</span>` : '')
    : (name ? '처음 하는 운동이에요.' : '');
  // 올릴 중량을 폼에 미리 채워 준다 (직접 적은 값은 건드리지 않는다)
  if (tip?.kind === 'weight' && !$('#exWeight').value) $('#exWeight').value = tip.to;
  if (tip?.kind === 'reps' && last) $('#exReps').value = tip.to;
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

// ---------- 루틴 ----------
// 루틴은 "무슨 운동을 몇 세트 몇 회" 까지만 담는다. 중량은 저장하지 않고 불러올 때
// 그 운동의 최근 기록에서 가져온다. 안 그러면 석 달 전 무게가 그대로 따라온다.
function routineFrom(workouts) {
  return workouts.map((w) => ({
    name: w.name,
    sets: w.sets.length,
    reps: Number(w.sets[0]?.reps) || 10,
    minutes: w.minutes ?? null,
  }));
}
// 오늘 한 부위로 이름을 지어 준다 (예: "가슴·어깨 날")
function suggestRoutineName(workouts) {
  const counts = new Map();
  workouts.forEach((w) => {
    const p = partOf(w.name);
    counts.set(p, (counts.get(p) || 0) + w.sets.length);
  });
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([p]) => p);
  return top.length ? `${top.join('·')} 날` : '내 루틴';
}

function saveRoutine() {
  const workouts = day().workouts;
  if (!workouts.length) return;
  const name = prompt('루틴 이름을 정해 주세요.', suggestRoutineName(workouts));
  if (!name?.trim()) return;
  const key = name.trim();
  if (state.profile.routines?.[key] && !confirm(`'${key}' 루틴이 이미 있어요. 지금 운동으로 바꿀까요?`)) return;
  (state.profile.routines ??= {})[key] = routineFrom(workouts);
  save();
  render();
  alert(`'${key}' 루틴을 저장했어요. 다음엔 한 번에 불러올 수 있어요.`);
}

function loadRoutineByName(key) {
  const items = state.profile.routines?.[key];
  if (!items || !confirm(`'${key}' 루틴 ${items.length}종을 불러올까요?\n중량은 그 운동의 최근 기록으로 채워요.`)) return;
  day().plan = key;                                    // 불러온 루틴이 곧 오늘의 계획
  items.forEach((it) => {
    const last = lastRecord(it.name, shiftDate(currentDate, 1));   // 오늘 것까지 포함해서 최근
    const weight = last ? (Number(last.workout.sets.at(-1)?.weight) || null) : null;
    day().workouts.push({
      id: uid(),
      name: it.name,
      minutes: it.minutes,
      sets: Array.from({ length: Math.max(1, it.sets) }, () => ({ reps: it.reps, weight, done: false })),
    });
  });
  save();
  render();
}

// ---------- 오늘의 계획 ----------
// 루틴을 "오늘 할 것"으로 걸어두면, 기록하면서 뭘 했고 뭐가 남았는지 보인다.
// 루틴 이름만 날짜에 적어두고(day.plan), 남은 것은 그때그때 기록과 견줘서 계산한다.
function planItems(date = currentDate) {
  const d = state.days[date];
  const items = state.profile.routines?.[d?.plan];
  if (!items) return null;
  const doneNames = new Set((d.workouts || []).map((w) => metKey(w.name)));
  return items.map((it) => {
    const w = (d.workouts || []).find((x) => metKey(x.name) === metKey(it.name));
    return {
      name: it.name,
      target: it.sets,
      done: w ? doneCount(w) : 0,
      added: !!w,
      hit: w ? doneCount(w) >= it.sets : false,
      inList: doneNames.has(metKey(it.name)),
    };
  });
}

function renderPlan() {
  const card = $('#planCard');
  const items = planItems();
  const routines = Object.keys(state.profile.routines || {});
  if (!items) {
    // 아직 안 골랐으면 고를 수 있게만 해 둔다
    card.hidden = !routines.length || day().workouts.length > 0;
    if (!card.hidden) {
      card.innerHTML = `<h3>🗒 오늘의 계획</h3>
        <p class="hint">루틴을 걸어두면 뭘 했고 뭐가 남았는지 보여드려요.</p>
        <div class="chips">${routines.map((r) => `<button class="chip" data-set-plan="${esc(r)}">${esc(r)}</button>`).join('')}</div>`;
    }
    return;
  }
  card.hidden = false;
  const doneCnt = items.filter((i) => i.hit).length;
  card.innerHTML = `
    <div class="card-head">
      <h3>🗒 ${esc(day().plan)}</h3>
      <span class="muted">${doneCnt}/${items.length} 완료</span>
    </div>
    <div class="bar ${doneCnt >= items.length ? 'full' : ''}">
      <span style="width:${Math.round(doneCnt / items.length * 100)}%"></span>
    </div>
    <div class="plan-list">
      ${items.map((i) => `<div class="plan-row ${i.hit ? 'hit' : ''}">
        <span>${i.hit ? '✅' : i.added ? '▶' : '⬜'} ${esc(i.name)}</span>
        <span class="muted">${i.done}/${i.target}세트${
          !i.added ? ` <button class="link-btn" data-plan-add="${esc(i.name)}:${i.target}">+ 추가</button>` : ''}</span>
      </div>`).join('')}
    </div>
    <button class="link-btn" data-clear-plan="1">계획 내리기</button>`;
}

function renderRoutines() {
  const list = Object.entries(state.profile.routines || {});
  const hasToday = day().workouts.length > 0;
  $('#routineCard').hidden = !list.length && !hasToday;
  $('#routineCard').innerHTML = `
    <h3>📋 내 루틴</h3>
    ${list.length ? list.map(([key, items]) => `
      <div class="item routine">
        <div>
          <strong>${esc(key)}</strong>
          <p class="hint">${items.map((i) => esc(i.name)).join(', ')} · ${items.reduce((s, i) => s + i.sets, 0)}세트</p>
        </div>
        <span class="routine-btns">
          <button data-load-routine="${esc(key)}" class="primary">불러오기</button>
          <button class="del" data-del-routine="${esc(key)}" aria-label="삭제">✕</button>
        </span>
      </div>`).join('')
      : '<p class="hint">자주 하는 운동을 루틴으로 저장해두면 한 번에 불러올 수 있어요.</p>'}
    ${hasToday ? '<button id="saveRoutineBtn" class="wide-btn">💾 오늘 운동을 루틴으로 저장</button>' : ''}`;
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
  // 내가 쓴 이름을 앞에 두고, 안 써 본 흔한 운동을 뒤에 붙인다.
  // 이름이 같은지는 metKey 기준으로 보므로 대소문자·앞뒤 공백 차이로 중복되지 않는다.
  const mine = new Set();
  const seen = new Set();
  const exNames = [];
  const foodNames = new Set(Object.keys(FOOD_DB));
  Object.values(state.days).forEach((d) => {
    d.workouts.forEach((w) => mine.add(w.name));
    d.meals.forEach((m) => foodNames.add(m.name));
  });
  [...mine, ...COMMON_EX].forEach((n) => {
    const key = metKey(n);
    if (!key || seen.has(key)) return;
    seen.add(key);
    exNames.push(n);
  });
  $('#exSuggestions').innerHTML = exNames.map((n) => `<option value="${esc(n)}">`).join('');
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

// ---------- 날짜 이동 연출 ----------
// 날짜만 조용히 바뀌면 바뀐 걸 알아채기 어렵다. 내용이 옆에서 밀려 들어오게 하고
// 요일이 적힌 알약을 잠깐 띄운다.
const MAIN = document.querySelector('main');
const SLIDE_PX = 60;              // 이만큼 쓸어야 날짜가 넘어간다
let pillTimer = null;

function reduceMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
function dateLabel(date) {
  const d = new Date(date + 'T00:00:00');
  const w = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  const rel = date === todayStr() ? ' · 오늘'
    : date === shiftDate(todayStr(), -1) ? ' · 어제'
    : date === shiftDate(todayStr(), 1) ? ' · 내일' : '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${w})${rel}`;
}
function showDatePill() {
  const el = $('#datePill');
  el.textContent = dateLabel(currentDate);
  // 탭 바로 아래에 띄운다. 화면 크기에 따라 헤더 높이가 달라져서 그때그때 잰다.
  el.style.top = `${document.querySelector('.tabs').getBoundingClientRect().bottom + 6}px`;
  el.hidden = false;
  el.classList.remove('pop');
  void el.offsetWidth;            // 같은 방향으로 연달아 넘겨도 다시 재생되게
  el.classList.add('pop');
  clearTimeout(pillTimer);
  pillTimer = setTimeout(() => { el.hidden = true; }, 1200);
}
// 날짜 넘김 연출: 화면 전체(main)가 진행 방향으로 빠져나갔다가, 반대편에서 다시 들어온다.
// 나가는 것과 들어오는 것을 같은 요소 하나로 처리해야 방향이 엇갈리지 않는다.
// (예전에는 main이 제자리로 튕겨 돌아오는 동시에 패널이 반대로 들어와 서로 상쇄됐다)
const LEAVE_MS = 120;
const ENTER_MS = 300;
const SLIDE_OUT = 32;             // 나갈 때 옆으로 비키는 정도 (%)
let animating = false;

let animTimers = [];
function clearAnim() {
  animTimers.forEach(clearTimeout);
  animTimers = [];
}

// dir: 1이면 다음 날, -1이면 이전 날
function goToDate(date, dir) {
  if (date === currentDate) return;
  if (reduceMotion() || !dir) {
    currentDate = date;
    render();
    showDatePill();
    return;
  }
  // 날짜는 먼저 확정한다. 연출이 끝날 때 바꾸면 빠르게 두 번 누를 때
  // 두 번째가 같은 날짜를 가리켜 하루만 넘어간다.
  currentDate = date;
  clearAnim();                    // 진행 중이던 연출은 접고 지금 위치에서 이어서
  animating = true;
  MAIN.classList.remove('dragging', 'entering', 'no-anim');
  MAIN.classList.add('leaving');
  MAIN.style.transform = `translateX(${dir > 0 ? -SLIDE_OUT : SLIDE_OUT}%)`;
  MAIN.style.opacity = '0';

  animTimers.push(setTimeout(() => {
    render();
    showDatePill();
    window.scrollTo(0, 0);        // 새 날짜는 맨 위부터 보이게

    // 반대편에 순간이동시켜 놓고
    MAIN.classList.remove('leaving');
    MAIN.classList.add('no-anim');
    MAIN.style.transform = `translateX(${dir > 0 ? SLIDE_OUT : -SLIDE_OUT}%)`;
    void MAIN.offsetWidth;        // 여기서 한 번 끊어줘야 아래 값이 애니메이션으로 이어진다

    // 제자리로 쫀득하게 들어온다
    MAIN.classList.remove('no-anim');
    MAIN.classList.add('entering');
    MAIN.style.transform = '';
    MAIN.style.opacity = '';
    animTimers.push(setTimeout(() => {
      MAIN.classList.remove('entering');
      animating = false;
    }, ENTER_MS));
  }, LEAVE_MS));
}
function stepDate(delta) {
  goToDate(shiftDate(currentDate, delta), delta);
}

// ---------- 이벤트 ----------
document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
function showTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === name));
}

$('#date').addEventListener('change', (e) => {
  const next = e.target.value || todayStr();
  goToDate(next, next > currentDate ? 1 : -1);
});
$('#prevDay').addEventListener('click', () => stepDate(-1));
$('#nextDay').addEventListener('click', () => stepDate(1));

$('#todayBtn').addEventListener('click', () => {
  const t = todayStr();
  goToDate(t, t > currentDate ? 1 : -1);
});
$('#historySearch').addEventListener('input', renderHistory);
$('#liftPick').addEventListener('change', (e) => { liftPick = e.target.value; renderLiftChart(); });
$('#volPick').addEventListener('change', (e) => { volPart = e.target.value; renderVolumeChart(); });
document.addEventListener('input', (e) => {
  if (e.target.id === 'weeklyGoal') {
    const v = Number(e.target.value);
    state.profile.weeklyGoal = v > 0 ? Math.min(7, v) : 3;
    saveSoon();
    $('#streakMsg').textContent = '';
  } else if (e.target.dataset.partGoal) {
    const v = Number(e.target.value);
    (state.profile.partGoals ??= {});
    if (v > 0) state.profile.partGoals[e.target.dataset.partGoal] = Math.min(60, v);
    else delete state.profile.partGoals[e.target.dataset.partGoal];
    saveSoon();
  } else if (e.target.dataset.volGoal) {
    const v = Number(e.target.value);
    (state.profile.volGoals ??= {});
    if (v > 0) state.profile.volGoals[e.target.dataset.volGoal] = Math.min(200000, Math.round(v));
    else delete state.profile.volGoals[e.target.dataset.volGoal];
    saveSoon();
    renderVolumeChart();   // 목표 칸은 포커스가 있어서 다시 안 그려지고, 그래프만 갱신된다
  }
});
$('#undoBtn').addEventListener('click', undo);

// 좌우로 쓸어서 날짜 이동. 손가락을 따라 내용이 밀리고, 덜 쓸면 제자리로 돌아온다.
// 세로 스크롤을 방해하면 안 되므로 가로로 확실히 움직였을 때만 따라간다.
let touch = null;
MAIN.addEventListener('touchstart', (e) => {
  if (animating) { touch = null; return; }
  touch = e.touches.length === 1
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY, engaged: false }
    : null;
}, { passive: true });

MAIN.addEventListener('touchmove', (e) => {
  if (!touch || e.touches.length !== 1) return;
  const dx = e.touches[0].clientX - touch.x;
  const dy = e.touches[0].clientY - touch.y;
  if (!touch.engaged) {
    if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) { touch = null; return; }  // 세로 스크롤
    if (Math.abs(dx) < 16) return;
    touch.engaged = true;
    MAIN.classList.add('dragging');
  }
  MAIN.style.transform = `translateX(${dx * 0.45}px)`;   // 손가락을 따라오되 살짝 저항이 있게
}, { passive: true });

function endSwipe(dx) {
  MAIN.classList.remove('dragging');
  MAIN.style.transform = '';
  if (Math.abs(dx) < SLIDE_PX) return;
  stepDate(dx < 0 ? 1 : -1);
}
MAIN.addEventListener('touchend', (e) => {
  if (!touch) return;
  const engaged = touch.engaged;
  const dx = e.changedTouches[0].clientX - touch.x;
  touch = null;
  endSwipe(engaged ? dx : 0);
}, { passive: true });
MAIN.addEventListener('touchcancel', () => {
  if (!touch) return;
  touch = null;
  endSwipe(0);
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
$('#sessionBtn').addEventListener('click', toggleSession);
$('#restStop').addEventListener('click', stopRest);
$('#restPlus').addEventListener('click', () => { restEndAt += 30000; drawRest(); });

$('#mealPhoto').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('#photoName').textContent = '넣는 중…';
  try {
    if (pendingPhoto) await deletePhoto(pendingPhoto);   // 다시 고르면 앞 사진은 버린다
    pendingPhoto = await savePhoto(file);
    $('#photoName').textContent = '✓ 첨부됨';
  } catch (err) {
    pendingPhoto = null;
    $('#photoName').textContent = '';
    alert(`사진을 넣지 못했어요. ${err.message}`);
  }
});

$('#foodName').addEventListener('input', updateMealHint);
$('#foodAmount').addEventListener('input', updateMealHint);
$('#foodKcal').addEventListener('input', () => { kcalTouched = true; updateMealHint(); });
$('#foodProtein').addEventListener('input', () => { kcalTouched = true; });
$('#proteinGoal').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  state.profile.proteinGoal = v > 0 ? v : null;
  saveSoon();
  renderMeals();
});
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
    protein: $('#foodProtein').value ? Number($('#foodProtein').value) : null,
    photo: pendingPhoto,
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

// 사진을 누르면 크게 본다
document.addEventListener('click', (e) => {
  const img = e.target.closest('img[data-photo]');
  if (!img?.src) return;
  const box = $('#photoView');
  $('#photoViewImg').src = img.src;
  box.hidden = false;
});
$('#photoView').addEventListener('click', () => { $('#photoView').hidden = true; });

$('#exSheetClose').addEventListener('click', () => closeExSheet());
$('#liftDetail').addEventListener('click', () => openExSheet(liftPick));
window.addEventListener('popstate', () => closeExSheet(true));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeExSheet(); $('#photoView').hidden = true; }
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
    if (meal?.photo) photosToDrop.push(meal.photo);   // 되돌리기 시간이 지나면 지운다
  } else if (ds.delWorkout) {
    const w = findWorkout(ds.delWorkout);
    if (!w || !confirm('이 운동을 삭제할까요?')) return;
    pushUndo(`'${w?.name ?? '운동'}' 삭제함`);
    day().workouts = day().workouts.filter((x) => x.id !== ds.delWorkout);
    markDeleted(ds.delWorkout);
  } else if (ds.toggle) {
    const [id, i] = ds.toggle.split(':');
    const set = findWorkout(id)?.sets[i];
    if (!set) return;
    set.done = !set.done;
    set.doneAt = set.done ? Date.now() : null;   // 세트 사이 쉰 시간을 재는 기준
    if (set.done) startRest();      // 세트를 끝냈으니 휴식 시작
  } else if (ds.step) {
    const [id, i, field, dir] = ds.step.split(':');
    const set = findWorkout(id)?.sets[i];
    if (!set) return;
    const unit = field === 'weight' ? (Number(state.profile.weightStep) || 2.5) : 1;
    const next = (Number(set[field]) || 0) + unit * Number(dir);
    set[field] = next > 0 ? Math.round(next * 100) / 100 : (field === 'reps' ? 0 : null);
  } else if (ds.copyDay) {
    const src = state.days[ds.copyDay];
    if (!src?.workouts.length) return;
    if (!confirm(`${fmtDate(ds.copyDay)} 운동 ${src.workouts.length}종을 ${fmtDate(currentDate)}로 불러올까요?`)) return;
    src.workouts.forEach((w) => day().workouts.push({
      id: uid(), name: w.name, minutes: w.minutes,
      sets: w.sets.map((x) => ({ reps: x.reps, weight: x.weight, done: false })),
    }));
    showTab('workouts');
  } else if (ds.setPlan) {
    day().plan = ds.setPlan;
  } else if (ds.clearPlan) {
    day().plan = null;
  } else if (ds.planAdd) {
    const [name, sets] = ds.planAdd.split(':');
    const last = lastRecord(name, shiftDate(currentDate, 1));
    const tip = overloadTip(name);
    const weight = tip?.kind === 'weight' ? tip.to : (last ? Number(last.workout.sets.at(-1)?.weight) || null : null);
    const reps = state.profile.routines?.[day().plan]?.find((i) => metKey(i.name) === metKey(name))?.reps || 10;
    day().workouts.push({
      id: uid(), name, minutes: null,
      sets: Array.from({ length: Math.max(1, Number(sets) || 1) }, () => ({ reps, weight, done: false })),
    });
  } else if (ds.loadRoutine) {
    loadRoutineByName(ds.loadRoutine);
    return;                          // loadRoutineByName이 알아서 저장·렌더링한다
  } else if (ds.delRoutine) {
    if (!confirm(`'${ds.delRoutine}' 루틴을 지울까요?`)) return;
    pushUndo(`루틴 '${ds.delRoutine}' 삭제함`);
    delete state.profile.routines[ds.delRoutine];
  } else if (t.id === 'saveRoutineBtn') {
    saveRoutine();
    return;
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
  } else if (ds.water) {
    const cups = Math.max(0, (Number(day().water) || 0) + Number(ds.water));
    day().water = cups || null;
  } else if (ds.range) {
    range = Number(ds.range);
    document.querySelectorAll('#rangeSeg button').forEach((b) => b.classList.toggle('on', b === t));
    renderHistory();
    return;
  } else if (ds.fav) {
    const m = favCache[Number(ds.fav)]?.meal;
    if (!m) return;
    day().meals.push({ id: uid(), type: $('#mealType').value, name: m.name, amount: m.amount, kcal: m.kcal, protein: m.protein });
  } else if (ds.copyMeals) {
    const src = state.days[ds.copyMeals];
    if (!confirm(`${fmtDate(ds.copyMeals)} 식단 ${src.meals.length}개를 그대로 불러올까요?`)) return;
    src.meals.forEach((m) => day().meals.push({ ...m, id: uid() }));
  } else if (ds.delFood) {
    if (!confirm(`등록한 음식 '${ds.delFood}'을(를) 지울까요?`)) return;
    pushUndo(`등록 음식 '${ds.delFood}' 삭제함`);
    delete state.profile.foods[ds.delFood];
  } else if (t.id === 'rememberFood') {
    rememberFood($('#foodName').value, $('#foodAmount').value, Number($('#foodKcal').value), Number($('#foodProtein').value));
    kcalTouched = false;
    updateMealHint();
    renderMyFoods();
    return;
  } else if (ds.addSet) {
    const w = findWorkout(ds.addSet);
    if (!w) return;
    const last = w.sets[w.sets.length - 1] || { reps: 10, weight: null };
    w.sets.push({ reps: last.reps, weight: last.weight, done: false });
  } else if (ds.delSet) {
    const [id, i] = ds.delSet.split(':');
    const w = findWorkout(id);
    if (!w) return;
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
  } else if (ds.volGoalAvg) {
    (state.profile.volGoals ??= {})[volPart] = Number(ds.volGoalAvg);
    save();
    renderVolumeChart();
    return;
  } else if (ds.exDetail) {
    openExSheet(ds.exDetail);
    return;                        // 보기만 하는 거라 저장할 것도, 다시 그릴 것도 없다
  } else if (ds.goto) {
    closeExSheet();                // 상세에서 날짜를 눌렀으면 상세는 닫고 그 날로 간다
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
  if (ds.exNote) {
    const w = findWorkout(ds.exNote);
    if (!w) return;
    w.note = e.target.value.trim() || null;
  } else if (ds.minutes) {
    const w = findWorkout(ds.minutes);
    if (!w) return;
    const v = Number(e.target.value);
    w.minutes = v > 0 ? v : null;
  } else if (ds.met) {
    const v = Number(e.target.value);
    setCustomMet(ds.met, v > 0 ? Math.min(20, Math.max(1, v)) : 0);   // 0이면 자동 추정으로 복귀
  } else if (ds.edit) {
    const [id, i, field] = ds.edit.split(':');
    const set = findWorkout(id)?.sets[i];
    if (!set) return;
    const v = e.target.value;
    set[field] = v === '' ? null : Number(v);
  } else {
    return;
  }
  save();
  // change는 포커스가 빠지는 도중에 오기도 해서, 바로 다시 그리면 브라우저가 에러를 낸다. 한 틱 미룬다.
  setTimeout(refreshTotals, 0);
});

// ---------- 백업 ----------
function downloadJson(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);   // 바로 해제하면 브라우저가 받다 말 수 있다
}

$('#exportBtn').addEventListener('click', () => downloadJson(state, `fitness-log-${todayStr()}.json`));

// 사진까지 한 파일로. 사진은 기기에만 있어서 이걸로만 다른 기기에 옮길 수 있다.
$('#exportPhotoBtn').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = '사진 모으는 중…';
  try {
    const photos = await collectPhotos();
    const n = Object.keys(photos).length;
    if (!n && !confirm('옮길 사진이 없어요. 그래도 내보낼까요?')) return;
    downloadJson({ ...state, photos }, `fitness-log-사진포함-${todayStr()}.json`);
    if (n) alert(`사진 ${n}장을 함께 담았어요.`);
  } catch (err) {
    alert(`사진을 담지 못했어요. ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '📷 사진까지 내보내기';
  }
});

$('#prunePhotoBtn').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  try {
    const n = await prunePhotos();
    alert(n ? `쓰지 않는 사진 ${n}장을 정리했어요.` : '정리할 사진이 없어요.');
  } catch {
    alert('사진을 정리하지 못했어요.');
  }
  btn.disabled = false;
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
    const pics = await restorePhotos(data.photos);   // 사진이 들어있는 백업이면 같이 복원
    if (pics) render();
    alert([
      changed ? `${changed}일치를 합쳤어요.` : '가져온 파일에 새로운 내용이 없어요.',
      pics ? `사진 ${pics}장도 가져왔어요.` : '',
    ].filter(Boolean).join('\n'));
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
