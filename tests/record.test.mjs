// 기록하는 기본 흐름: 식단 칼로리, 세트 기록표, 완료 세트 집계, 소모 칼로리, 체중·물·세션, 되돌리기, 새로고침
import { tab, text, wait } from './lib.mjs';

export default async function (t) {
  const page = await t.open();

  // ── 식단 칼로리 자동 계산 ──
  const kcalOf = async (name, amount) => {
    await page.fill('#foodName', name);
    await page.fill('#foodAmount', amount);
    return page.inputValue('#foodKcal');
  };
  t.eq(await kcalOf('밥', '1공기'), '300', '밥 1공기 = 300kcal (143 × 210g)');
  t.eq(await kcalOf('닭가슴살', '200g'), '218', '닭가슴살 200g = 218kcal');
  t.eq(await kcalOf('바나나', '2개'), '214', '바나나 2개 = 214kcal (개당 120g)');
  t.eq(await kcalOf('현미밥', '210g'), '273', '"현미밥"은 표의 현미밥으로');
  t.eq(await kcalOf('할머니손맛김치전', ''), '', '"김치전"이 "김치"로 새지 않음 (이름 끝으로만 매칭)');
  t.ok((await text(page, '#mealHint')).includes('표에 없는'), '표에 없는 음식이면 직접 적으라고 안내');

  await kcalOf('우유', '1컵');
  await page.fill('#foodKcal', '999');
  await page.fill('#foodAmount', '2컵');
  t.eq(await page.inputValue('#foodKcal'), '999', '직접 고친 칼로리는 양을 바꿔도 안 덮어씀');
  await page.click('#mealForm button[type=submit]');
  t.eq(await page.inputValue('#foodName'), '', '추가하면 폼이 비워짐');
  t.eq(await kcalOf('밥', '1공기'), '300', '폼을 비운 뒤엔 다시 자동 계산');
  await page.click('#mealForm button[type=submit]');
  t.eq(await page.evaluate(() => day().meals.map((m) => m.kcal)), [999, 300], '식단 2개 저장');
  t.ok((await text(page, '#mealSummary')).includes('1299'), '요약에 합계 1299kcal');

  // ── 세트 기록표 ──
  await tab(page, 'workouts');
  await page.fill('#bodyWeight', '75');
  await page.dispatchEvent('#bodyWeight', 'input');
  await page.fill('#exName', '벤치프레스');
  await page.fill('#exSets', '3');
  await page.fill('#exWeight', '60');
  await page.fill('#exReps', '10');
  await page.click('#workoutForm button[type=submit]');
  await wait(page, 150);
  t.eq(await page.locator('#workoutList .set-row:not(.head)').count(), 3, '세트 3줄');

  const row2 = page.locator('#workoutList .set-row:not(.head)').nth(1);
  await row2.locator('input').first().fill('70');
  await row2.locator('input').first().dispatchEvent('change');
  await row2.locator('input').nth(1).fill('8');
  await row2.locator('input').nth(1).dispatchEvent('change');
  await wait(page, 100);
  t.eq(await page.evaluate(() => volumeOf(day().workouts[0])), 1760, '2세트만 70×8로 고치면 볼륨 1760');

  await page.click('[data-add-set]');
  await wait(page, 100);
  t.eq(await page.locator('#workoutList .set-row:not(.head)').count(), 4, '세트 추가');
  await page.locator('[data-del-set]').last().click();
  await wait(page, 100);
  t.eq(await page.locator('#workoutList .set-row:not(.head)').count(), 3, '세트 삭제');

  // ── 완료 체크한 세트만 집계 ──
  const agg = () => page.evaluate(() => {
    const w = day().workouts[0];
    return { vol: volumeOf(w), min: minutesOf(w), burn: burnOf(w, 75) };
  });
  t.eq(await agg(), { vol: 1760, min: 9, burn: 56 }, '체크 0개면 전체 집계 (3세트 × 3분, MET 5 × 75kg × 0.15h)');
  await page.locator('.set-no').nth(0).click();
  await wait(page, 100);
  await page.evaluate(() => stopRest());
  t.eq(await agg(), { vol: 600, min: 3, burn: 19 }, '1세트만 완료하면 그 세트만 집계');
  t.ok(await page.evaluate(() => day().workouts[0].sets[0].doneAt > 0), '완료 시각을 남김 (휴식 계산용)');

  // ── 시간을 적으면 그 값, MET 직접 수정 ──
  const minInput = page.locator('[data-minutes]').first();
  await minInput.fill('20');
  await minInput.dispatchEvent('change');
  await wait(page, 100);
  t.eq(await page.evaluate(() => burnOf(day().workouts[0], 75)), 125, '20분 적으면 5 × 75 × 20/60 = 125kcal');
  const met = page.locator('[data-met]').first();
  await met.fill('8');
  await met.dispatchEvent('change');
  await wait(page, 100);
  t.eq(await page.evaluate(() => [metOf('벤치프레스'), burnOf(day().workouts[0], 75)]), [8, 200], 'MET 8로 고치면 200kcal');
  t.eq(await page.evaluate(() => state.profile.mets), { '벤치프레스': 8 }, '고친 MET는 이름 기준으로 저장 (모든 날짜에 적용)');
  await met.fill('99');
  await met.dispatchEvent('change');
  await wait(page, 100);
  t.eq(await page.evaluate(() => metOf('벤치프레스')), 20, 'MET는 20을 못 넘김');
  await page.click('[data-reset-met]');
  await wait(page, 100);
  t.eq(await page.evaluate(() => [metOf('벤치프레스'), customMet('벤치프레스')]), [5, null], '↺ 자동으로 되돌림');

  // ── ± 버튼 (중량 단위) ──
  const w0 = () => page.evaluate(() => day().workouts[0].sets[0].weight);
  await page.locator('[data-step$=":weight:-1"]').first().click();
  t.eq(await w0(), 57.5, '− 한 번 = 2.5kg');
  await page.fill('#weightStep', '5');
  await page.dispatchEvent('#weightStep', 'input');
  await page.locator('[data-step$=":weight:1"]').first().click();
  t.eq(await w0(), 62.5, '단위를 5로 바꾸면 + 한 번 = 5kg');
  for (let i = 0; i < 20; i++) await page.locator('[data-step$=":reps:-1"]').first().click();
  t.eq(await page.evaluate(() => day().workouts[0].sets[0].reps), 0, '횟수는 0 밑으로 안 내려감');

  // ── 음수는 직접 쳐 넣어도 안 들어감 ──
  const wIn = page.locator('[data-edit$=":weight"]').nth(2);
  await wIn.fill('-50');
  await wIn.dispatchEvent('change');
  await wait(page, 100);
  t.eq(await page.evaluate(() => day().workouts[0].sets[2].weight), 0, '세트 칸에 -50을 쳐도 0으로');

  // ── 체중은 날짜별 ──
  t.eq(await page.evaluate(() => day().weight), 75, '오늘 체중 75 저장');
  const bw = await page.evaluate(() => {
    const d = shiftDate(currentDate, 3);
    const y = shiftDate(currentDate, -10);
    state.days[y] = { meals: [], workouts: [], note: '', weight: 80 };
    return { future: bodyWeight(d), past: bodyWeight(y), before: bodyWeight(shiftDate(y, -1)) };
  });
  t.eq(bw.future, 75, '안 적은 날은 그 전 마지막 체중');
  t.eq(bw.past, 80, '과거 날짜는 그때 체중');
  t.ok(bw.before > 0, '아무것도 없으면 기본값 (0이 아님)');

  // ── 단백질 목표 ──
  t.eq(await page.evaluate(() => proteinGoal()), 120, '목표를 안 적으면 체중 × 1.6 = 120g');

  // ── 물 ──
  await tab(page, 'meals');
  for (let i = 0; i < 3; i++) await page.click('[data-water="1"]');
  await page.click('[data-water="-1"]');
  t.eq(await page.evaluate(() => day().water), 2, '물 +3 −1 = 2잔');
  t.eq(await page.locator('.cup.on').count(), 2, '채워진 잔 2개');

  // ── 운동 전체 시간 ──
  await tab(page, 'workouts');
  await page.click('#sessionBtn');
  t.ok(await page.evaluate(() => sessionOn()), '시작 누르면 진행 중');
  await page.evaluate(() => { day().sessionStart = Date.now() - 47 * 60000; });
  await page.click('#sessionBtn');
  t.eq(await page.evaluate(() => day().sessionMin), 47, '47분 뒤 끝내면 47분');
  await page.click('#sessionBtn');
  await page.evaluate(() => { day().sessionStart = Date.now() - 10 * 60000; });
  await page.click('#sessionBtn');
  t.eq(await page.evaluate(() => day().sessionMin), 57, '한 번 더 하면 누적 57분');

  // ── 휴식 타이머는 벽시계 기준 ──
  const left = await page.evaluate(() => { startRest(90); restEndAt = Date.now() + 5000; return restLeft(); });
  t.ok(left <= 5 && left >= 4, `남은 시간은 끝나는 시각에서 계산 (${left}초)`);
  await page.click('#restPlus');
  t.ok(await page.evaluate(() => restLeft()) >= 33, '+30초');
  await page.click('#restStop');
  t.ok(await page.locator('#restBar').isHidden(), '정지하면 바가 사라짐');

  // ── 삭제 → 되돌리기 ──
  await page.click('[data-del-workout]');
  t.eq(await page.evaluate(() => day().workouts.length), 0, '운동 삭제');
  await page.click('#undoBtn');
  t.eq(await page.evaluate(() => day().workouts.length), 1, '되돌리기로 복구');

  // ── 테마 ──
  t.eq(await page.getAttribute('html', 'data-theme'), 'dark', '기본은 어두운 테마');
  await page.click('#themeBtn');
  t.eq(await page.getAttribute('html', 'data-theme'), 'light', '버튼으로 밝은 테마');

  // ── 새로고침 뒤에도 전부 남나 ──
  await page.evaluate(() => flushSave?.());
  await page.reload();
  await page.waitForSelector('#mealList', { state: 'attached' });
  const after = await page.evaluate(() => ({
    meals: day().meals.length, workouts: day().workouts.length, weight: day().weight,
    water: day().water, session: day().sessionMin, theme: document.documentElement.dataset.theme,
  }));
  t.eq(after, { meals: 2, workouts: 1, weight: 75, water: 2, session: 57, theme: 'light' }, '새로고침 뒤에도 그대로');
  t.noErrors(page);
}
