// Claude가 읽을 기록 정리 (글 한 편).
// 구글 드라이브 문서(sync.js의 drivePush)와 "글로 복사" 버튼이 같이 쓴다.
// 주 독자는 Claude다 — 무엇을 했는지, 얼마나 늘었는지, 무엇을 안 했는지가 바로 보이게 쓴다.
// 집계는 화면과 같은 함수(countedSets·volumeOf·oneRM·partOf·metKey)를 거친다. 따로 계산하면 화면과 숫자가 달라진다.
const REPORT_DAYS = 180;    // 날짜별 기록은 최근 이만큼만 (그 전은 함께 저장하는 fitness-log.json에 있다)
const REPORT_WEEKS = 4;     // 요약의 "최근 4주"

function rpNum(n) {
  return Math.round(n).toLocaleString('ko-KR');
}
function rpSeg(weight, reps) {
  const w = nonNeg(weight);
  const r = nonNeg(reps);
  return w ? `${w}×${r}` : `맨몸×${r}`;
}
// 세트 하나: W = 워밍업, ↘ = 드롭, (안 함) = 완료 체크를 쓰는 운동에서 체크 안 한 세트
function rpSet(s, checks) {
  let t = rpSeg(s.weight, s.reps) + dropsOf(s).map((d) => `↘${rpSeg(d.weight, d.reps)}`).join('');
  if (s.warmup) t = `W ${t}`;
  if (checks && !s.done) t += ' (안 함)';
  return t;
}
// 그 운동의 그 날 최고 세트: 1RM이 큰 세트, 맨몸이면 횟수가 많은 세트 (personalBest와 같은 규칙)
function rpTop(w) {
  let best = null;
  for (const s of countedSets(w)) {
    const weight = nonNeg(s.weight);
    const reps = nonNeg(s.reps);
    if (!weight && !reps) continue;
    const rm = oneRM(weight, reps);
    if (!best || rm > best.rm || (rm === best.rm && weight > best.weight) || (!rm && !best.rm && reps > best.reps)) {
      best = { weight, reps, rm };
    }
  }
  return best;
}
function rpBetter(a, b) {      // a가 b보다 센 기록인지
  if (!b) return !!a;
  if (!a) return false;
  return a.rm > b.rm || (a.rm === b.rm && a.weight > b.weight) || (!a.rm && !b.rm && a.reps > b.reps);
}
function rpTopText(t) {
  if (!t) return '-';
  return t.weight ? `${rpSeg(t.weight, t.reps)} (1RM ${t.rm}kg)` : rpSeg(0, t.reps);
}
function rpDate(date) {
  return `${date} (${WEEKDAYS[weekdayOf(date)]})`;
}
function rpAgo(date, today) {
  if (!date) return '안 함';
  const n = daysBetween(date, today);
  return `${fmtDate(date)}, ${n === 0 ? '오늘' : n === 1 ? '어제' : `${n}일 전`}`;
}

// 운동마다 모은 것: 한 날, 처음·최근·최고, 신기록을 세운 날 (날짜 오름차순으로 한 번 훑는다)
function rpExercises(dates) {
  const ex = new Map();
  for (const date of dates) {
    for (const w of state.days[date].workouts) {
      const key = metKey(w.name);
      if (!ex.has(key)) ex.set(key, { name: w.name, part: partOf(w.name), days: [], sets: 0, best: null, bestDate: null, before: null, records: new Set() });
      const e = ex.get(key);
      e.name = w.name;                       // 최근에 쓴 이름으로 부른다
      if (e.days.at(-1)?.date !== date) {
        e.days.push({ date, ws: [] });
        e.before = e.best;                   // 그 전 날짜까지의 최고 — 같은 날 앞 세트를 넘긴 건 신기록이 아니다
      }
      e.days.at(-1).ws.push(w);
      e.sets += countedSets(w).length;
      const top = rpTop(w);
      // 예전 기록을 넘긴 날만 (처음 해 본 날은 비교할 게 없다)
      if (e.before && rpBetter(top, e.before)) e.records.add(date);
      if (rpBetter(top, e.best)) {
        e.best = top;
        e.bestDate = date;
      }
    }
  }
  return ex;
}
function rpDayTop(ws) {
  return ws.map(rpTop).reduce((a, b) => (rpBetter(b, a) ? b : a), null);
}

function rpWindow(today, from, to) {   // today 기준 from~to일 전 (to 포함 안 함)
  let days = 0, sets = 0, vol = 0;
  for (let i = from; i < to; i++) {
    const d = state.days[shiftDate(today, -i)];
    if (!d?.workouts?.length) continue;
    days += 1;
    d.workouts.forEach((w) => { sets += countedSets(w).length; vol += volumeOf(w); });
  }
  return { days, sets, vol };
}

function rpSummary(dates, workDates, today) {
  const out = ['## 요약'];
  if (workDates.length) {
    out.push(`- 기록: ${workDates[0]} ~ ${workDates.at(-1)} · 운동한 날 ${workDates.length}일`);
  } else {
    out.push('- 아직 운동 기록이 없어요.');
  }
  const goal = Number(state.profile.weeklyGoal) || 0;
  const lastWeek = weeklyCount(shiftDate(weekStart(today), -7));
  out.push(`- 이번 주(${fmtDate(weekStart(today))}~): ${weeklyCount(today)}일${goal ? ` / 목표 주 ${goal}일` : ''} · 지난주 ${lastWeek}일 · 연속 ${workoutStreak(today)}일`);
  const now = rpWindow(today, 0, REPORT_WEEKS * 7);
  const prev = rpWindow(today, REPORT_WEEKS * 7, REPORT_WEEKS * 14);
  out.push(`- 최근 ${REPORT_WEEKS}주: ${now.days}일 · 본 세트 ${now.sets} · 볼륨 ${rpNum(now.vol)}kg` +
    ` (그 전 ${REPORT_WEEKS}주: ${prev.days}일 · ${prev.sets}세트 · ${rpNum(prev.vol)}kg)`);
  // 부위별 마지막으로 한 날 — 오래 쉰 순 (계획에 쓰라고)
  const parts = MAIN_PARTS.map((p) => {
    const last = lastPartDay(p, today);
    let sets = 0;
    for (let i = 0; i < REPORT_WEEKS * 7; i++) {
      state.days[shiftDate(today, -i)]?.workouts?.forEach((w) => { if (partOf(w.name) === p) sets += countedSets(w).length; });
    }
    return { p, last, sets };
  }).sort((a, b) => (a.last || '').localeCompare(b.last || ''));
  out.push(`- 부위별 마지막 (오래 쉰 순, 괄호 안은 최근 ${REPORT_WEEKS}주 세트): ` +
    parts.map((x) => `${x.p} ${x.last ? `${rpAgo(x.last, today)}` : '안 함'}${x.last ? ` (${x.sets}세트)` : ''}`).join(' · '));
  const wDate = dates.filter((d) => Number(state.days[d].weight) > 0).at(-1);
  if (wDate) out.push(`- 체중: ${state.days[wDate].weight}kg (${fmtDate(wDate)} 기록)`);
  else if (Number(state.profile.weight) > 0) out.push(`- 체중: ${state.profile.weight}kg`);
  const split = splitCfg();
  if (split) {
    const days = split.days.filter(Boolean);
    const rest = (split.rest || []).map((w) => WEEKDAYS[w]).join('·');
    out.push(`- 분할: ${days.length}분할 (${days.join(' → ')}) · 다음 차례 ${nextSplit(shiftDate(today, 1))}${rest ? ` · 쉬는 요일 ${rest}` : ''}`);
  }
  const goals = [];
  if (Number(state.profile.goal) > 0) goals.push(`하루 ${rpNum(state.profile.goal)}kcal`);
  if (Number(state.profile.proteinGoal) > 0) goals.push(`단백질 ${state.profile.proteinGoal}g`);
  const pg = Object.entries(state.profile.partGoals || {}).filter(([, n]) => Number(n) > 0);
  if (pg.length) goals.push(`부위별 주간 세트 ${pg.map(([p, n]) => `${p} ${n}`).join(', ')}`);
  if (goals.length) out.push(`- 목표: ${goals.join(' · ')}`);
  const r = state.profile.routines;
  const routines = r && typeof r === 'object' && !Array.isArray(r) ? Object.keys(r) : [];   // { 이름: [운동…] }
  if (routines.length) out.push(`- 저장한 루틴: ${routines.join(', ')}`);
  return out;
}

function rpExerciseList(ex) {
  const out = ['## 운동별 (자주 한 순)'];
  const list = [...ex.values()].sort((a, b) => b.days.length - a.days.length || b.sets - a.sets);
  if (!list.length) out.push('- 없음');
  for (const e of list) {
    const first = e.days[0];
    const last = e.days.at(-1);
    const lastSets = last.ws.flatMap((w) => w.sets.map((s) => rpSet(s, w.sets.some((x) => x.done)))).join(', ');
    const canon = exCanon(e.name);
    out.push(`- ${e.name}${canon && exKey(canon) !== exKey(e.name) ? ` (= ${canon})` : ''} [${e.part}] ${e.days.length}일 · ${e.sets}세트` +
      (e.best ? ` · 최고 ${rpTopText(e.best)}, ${fmtDate(e.bestDate)}` : '') +
      (e.days.length > 1 ? ` · 처음 ${fmtDate(first.date)} ${rpTopText(rpDayTop(first.ws))}` : '') +
      ` · 최근 ${fmtDate(last.date)}: ${lastSets}`);
  }
  return out;
}

function rpDay(date, ex) {
  const d = state.days[date];
  const out = [];
  const ws = d.workouts;
  const sets = ws.reduce((n, w) => n + countedSets(w).length, 0);
  const vol = ws.reduce((n, w) => n + volumeOf(w), 0);
  const head = [rpDate(date)];
  if (ws.length) head.push(dayParts(d).map(partLabel).join('·'), `${sets}세트`, ...(vol ? [`볼륨 ${rpNum(vol)}kg`] : []));
  if (d.split) head.push(`분할 ${d.split}`);
  if (Number(d.sessionMin) > 0) head.push(`운동 시간 ${Math.round(d.sessionMin)}분`);
  out.push(`### ${head.join(' · ')}`);
  // 슈퍼세트는 붙어 있는 묶음마다 A, B…
  let ssNo = 0;
  for (const run of ssRuns(ws)) {
    const tag = run.length > 1 ? ` (슈퍼세트 ${String.fromCharCode(65 + ssNo++)})` : '';
    for (const w of run) {
      const checks = w.sets.some((s) => s.done);
      const v = volumeOf(w);
      const rec = ex.get(metKey(w.name))?.records.has(date) ? ' · 신기록' : '';
      out.push(`- ${w.name} [${partOf(w.name)}]${tag}: ${w.sets.map((s) => rpSet(s, checks)).join(', ') || '세트 없음'}` +
        `${v ? ` · ${rpNum(v)}kg` : ''}${Number(w.minutes) > 0 ? ` · ${w.minutes}분` : ''}${rec}`);
      if (w.note) out.push(`  메모: ${w.note}`);
    }
  }
  if (d.meals?.length) {
    const items = d.meals.map((m) => `${m.type ? `${m.type} ` : ''}${m.name || '?'}${m.amount ? ` ${m.amount}` : ''}${nonNeg(m.kcal) ? ` ${rpNum(nonNeg(m.kcal))}kcal` : ''}`);
    out.push(`- 식단 ${rpNum(dayIntake(d))}kcal · 단백질 ${dayProtein(d)}g: ${items.join(', ')}`);
  }
  if (Number(d.weight) > 0) out.push(`- 체중 ${d.weight}kg`);
  if (Number(d.water) > 0) out.push(`- 물 ${d.water}잔`);
  if (d.note) out.push(`- 메모: ${d.note}`);
  return out;
}

// now: 저장 시각(테스트에서 고정하려고 받는다)
function recordText(now = new Date()) {
  const today = todayStr(now);
  const dates = Object.keys(state.days).filter((d) => d <= today && !isEmptyDay(state.days[d])).sort();
  const workDates = dates.filter((d) => state.days[d].workouts.length);
  const ex = rpExercises(workDates);
  const since = shiftDate(today, -(REPORT_DAYS - 1));
  const recent = dates.filter((d) => d >= since).reverse();
  const older = dates.length - recent.length;
  const stamp = `${today} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return [
    '# 운동 기록',
    `식단·운동 기록 앱이 기록을 고칠 때마다 자동으로 덮어쓰는 문서예요. 마지막 저장 ${stamp} · 오늘 ${rpDate(today)}`,
    '표기: 무게×횟수 (kg×회). W = 워밍업(집계에서 뺌), ↘ = 드롭세트(같은 세트에서 무게를 내려 이어 함), (안 함) = 완료 체크를 안 한 세트. 볼륨 = 본 세트의 무게×횟수 합. 1RM은 Epley 추정.',
    '',
    ...rpSummary(dates, workDates, today),
    '',
    ...rpExerciseList(ex),
    '',
    `## 날짜별 (최근부터${older ? `, 최근 ${REPORT_DAYS}일 — 그 전 ${older}일치는 fitness-log.json에` : ''})`,
    ...(recent.length ? recent.flatMap((d) => ['', ...rpDay(d, ex)]) : ['- 없음']),
  ].join('\n');
}
