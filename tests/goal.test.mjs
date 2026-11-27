// 식단 탭 하루 목표: 다이어트·유지·벌크업·직접 탭 → 목표 계산 → 오늘 먹은 것·지난 7일과 비교.
// 기록 탭 달력에 그 날 식단(끼니별)과 "오늘 식단으로 불러오기".
import { tab, text, wait } from './lib.mjs';

export default async function (t) {
  const page = await t.open();
  await tab(page, 'meals');
  t.eq(await page.locator('#proteinBar, #goalKcal, #proteinGoal').count(), 0, '예전 단백질 막대·목표 칸 없음 (목표 카드로 합침)');
  t.eq(await page.locator('#goalSeg button').allTextContents(), ['다이어트', '유지', '벌크업', '직접'], '목표 종류 탭');
  t.eq(await page.locator('#goalSeg button.on').textContent(), '유지', '처음엔 유지');

  await page.evaluate(() => { day().weight = 80; state.profile.weight = 80; save(); render(); });
  const goals = () => page.evaluate(() => [kcalGoal(), proteinGoal()]);
  t.eq(await goals(), [2110, 128], '유지: 체중 80kg → 기초대사 어림 1,760 × 1.2 ≈ 2,110kcal · 단백질 80 × 1.6');
  await page.click('[data-goal-mode="cut"]');
  t.eq(await goals(), [1760, 160], '다이어트: −500이지만 기초대사 아래로는 안 내림 · 단백질 2.0g/kg');
  t.ok((await text(page, '#goalForm .goal-basis')).includes('기초대사 아래로는 안 내림'), '근거에 그렇게 적음');
  t.eq(await page.evaluate(() => state.profile.goalMode), 'cut', '고른 종류는 저장 (기기 간 동기화)');
  await page.click('[data-goal-mode="bulk"]');
  t.eq(await goals(), [2410, 144], '벌크업: +300 · 1.8g/kg');
  t.ok((await text(page, '#goalNote')).includes('2,410 kcal · 단백질 144g'), '제목 옆에 목표 숫자');

  // ── 내 정보(성별·나이·키) → Mifflin-St Jeor ──
  await page.click('#goalForm .goal-me summary');
  await page.click('[data-goal-sex="m"]');
  t.ok(await page.locator('#goalForm .goal-me').evaluate((e) => e.open), '다시 그려도 펼친 채로');
  await page.fill('[data-goal-field="age"]', '30');
  await page.dispatchEvent('[data-goal-field="age"]', 'input');
  await page.fill('[data-goal-field="height"]', '175');
  await page.dispatchEvent('[data-goal-field="height"]', 'input');
  t.eq(await goals(), [2400, 144], '남 30세 175cm 80kg → 기초대사 1,749 × 1.2 + 300 ≈ 2,400kcal');
  t.ok(await page.evaluate(() => { const el = document.activeElement; render(); return el.dataset.goalField === 'height' && el === document.activeElement && el.isConnected; }),
    '치는 동안 화면을 다시 그려도 칸이 안 날아감');
  t.ok((await text(page, '#goalForm .goal-basis')).includes('1,749'), '근거 줄도 따라 바뀜');
  await page.evaluate(() => { document.activeElement.blur(); render(); });
  t.ok((await text(page, '#goalForm .goal-me summary')).includes('남 · 30세 · 175cm'), '접으면 내 정보 한 줄');

  // ── 오늘 먹은 것과 비교 ──
  await page.evaluate(() => { day().meals.push({ id: uid(), type: '점심', name: '제육덮밥', amount: '1그릇', kcal: 800, protein: 35 }); save(); render(); });
  let bars = await text(page, '#goalBars');
  t.ok(bars.includes('800 / 2,400 kcal') && bars.includes('1,600 kcal 남음'), '칼로리: 먹은 것 / 목표 · 남은 것');
  t.ok(bars.includes('35 / 144 g') && bars.includes('109 g 남음'), '단백질도');
  await page.evaluate(() => { day().workouts.push({ id: uid(), name: '스쿼트', sets: [{ weight: 60, reps: 10, done: true }] }); save(); render(); });
  const burn = await page.evaluate(() => dayBurn(currentDate));
  bars = await text(page, '#goalBars');
  t.ok(burn > 0 && bars.includes(`/ ${(2400 + burn).toLocaleString()} kcal`) && bars.includes(`운동 +${burn} 포함`), '운동한 날은 소모만큼 목표가 늘어남');
  await page.evaluate(() => { day().meals.push({ id: uid(), type: '저녁', name: '피자', amount: '1판', kcal: 3000, protein: 90 }); save(); render(); });
  t.ok(await page.locator('#goalBars .goal-meter.over').count() >= 1 && (await text(page, '#goalBars')).includes('넘음'), '넘으면 빨간 막대 · "넘음"');

  // ── 지난 7일 평균 (기록한 날만 나눔) ──
  await page.evaluate(() => {
    state.days[shiftDate(todayStr(), -1)] = { note: '', workouts: [], meals: [{ id: 'a', type: '점심', name: '밥', amount: '', kcal: 2000, protein: 100 }] };
    state.days[shiftDate(todayStr(), -3)] = { note: '', workouts: [], meals: [{ id: 'b', type: '점심', name: '밥', amount: '', kcal: 1600, protein: 120 }] };
    save(); render();
  });
  const week = await text(page, '#goalBars .goal-week');
  t.ok(week.includes('1,800 kcal') && week.includes('목표보다 600 적게') && week.includes('단백질 110g') && week.includes('기록한 2일'), `지난 7일 평균과 목표 비교 (${week})`);

  // ── 직접 ──
  await page.click('[data-goal-mode="custom"]');
  await page.fill('[data-goal-field="goal"]', '2000');
  await page.dispatchEvent('[data-goal-field="goal"]', 'input');
  await page.fill('[data-goal-field="proteinGoal"]', '150');
  await page.dispatchEvent('[data-goal-field="proteinGoal"]', 'input');
  t.eq(await goals(), [2000, 150], '직접: 적은 숫자 그대로');
  t.ok((await text(page, '#goalNote')).includes('2,000 kcal'), '제목 옆 숫자도');

  // ── 기록 탭 달력: 그 날 식단, 오늘 식단으로 불러오기 ──
  await tab(page, 'history');
  const today = await page.evaluate(() => todayStr());
  await page.evaluate((d) => { calMonth = d.slice(0, 7); calPick = d; renderCalendar(); }, today);
  const det = await text(page, '#calDetail .cal-meals');
  t.ok(det.includes('점심') && det.includes('제육덮밥') && det.includes('저녁') && det.includes('피자'), '달력의 그 날 보기에 식단이 끼니별로');
  t.eq(await page.locator('#calDetail [data-copy-meals]').count(), 0, '보고 있는 날이면 불러오기 버튼 없음');
  await page.evaluate((d) => { currentDate = shiftDate(d, 2); render(); calMonth = d.slice(0, 7); calPick = d; renderCalendar(); }, today);
  await page.click('#calDetail [data-copy-meals]');
  await wait(page, 150);
  t.eq(await page.evaluate(() => day().meals.map((m) => m.name)), ['제육덮밥', '피자'], '↩ 식단으로 불러오기: 보고 있는 날로');
  t.ok(await page.evaluate(() => document.getElementById('meals').classList.contains('active')), '불러오면 식단 탭으로');

  // ── 예전에 직접 적어 둔 목표는 '직접'으로 ──
  const old = await t.open({ init: () => localStorage.setItem('fitness-log-v1', JSON.stringify({ days: {}, profile: { goal: 1800, proteinGoal: 140 } })) });
  t.eq(await old.evaluate(() => [goalMode(), kcalGoal(), proteinGoal()]), ['custom', 1800, 140], '예전에 적어 둔 목표는 그대로 (직접)');
  t.noErrors(page);
  t.noErrors(old, '예전 기록');
}
