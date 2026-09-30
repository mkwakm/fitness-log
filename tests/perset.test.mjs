// 세트마다 다른 무게·횟수 (피라미드 등): 폼 입력, 다음번 자동 채움, 과부하 제안, 루틴·계획, 집중 모드
import { tab, text, wait, ago } from './lib.mjs';

export default async function (t) {
  let answer;
  const page = await t.open({ dialog: (d) => (d.type() === 'prompt' ? d.accept(answer ?? d.defaultValue()) : d.accept()) });
  await tab(page, 'workouts');
  const rows = () => page.evaluate(() => [...document.querySelectorAll('#perSetBox .perset-row')].map((r) =>
    [...r.querySelectorAll('input')].map((i) => i.value)));
  const sets = (i = -1) => page.evaluate((i) => day().workouts.at(i).sets.map((s) => [s.weight, s.reps]), i);
  const fillRow = async (i, w, r) => {
    await page.fill(`[data-ps="${i}:weight"]`, String(w));
    await page.fill(`[data-ps="${i}:reps"]`, String(r));
  };

  // ── 폼에서 세트마다 다르게 ──
  t.ok(await page.locator('#perSetBox').isHidden(), '처음엔 "모든 세트 같게"');
  await page.fill('#exName', '벤치프레스');
  await page.fill('#exSets', '3');
  await page.fill('#exWeight', '60');
  await page.fill('#exReps', '12');
  await page.click('#perSetToggle');
  t.eq(await rows(), [['60', '12'], ['60', '12'], ['60', '12']], '켜면 세트 수만큼 칸, 위에 적은 값으로 채움');
  t.ok(await page.locator('#exWeight').isHidden(), '표를 쓰는 동안 공통 중량 칸은 숨김');
  await fillRow(1, 70, 10);
  await fillRow(2, 80, 8);
  await page.fill('#exSets', '4');
  await page.dispatchEvent('#exSets', 'input');
  t.eq((await rows())[3], ['80', '8'], '세트를 늘리면 마지막 세트를 따라 한 줄 추가');
  await page.fill('#exSets', '3');
  await page.dispatchEvent('#exSets', 'input');
  t.eq((await rows()).length, 3, '줄이면 뒤에서부터 뺌');
  await page.click('#workoutForm button[type=submit]');
  t.eq(await sets(), [[60, 12], [70, 10], [80, 8]], '세트마다 다른 무게·횟수로 저장');
  t.ok(await page.locator('#perSetBox').isHidden(), '추가하고 나면 표는 접힘');
  const cardRows = await page.locator('#workoutList .card').last().locator('[data-edit$=":weight"]').evaluateAll((els) => els.map((e) => e.value));
  t.eq(cardRows, ['60', '70', '80'], '카드에도 세트마다 다른 무게');

  // ── 끄면 다시 모든 세트 같게 ──
  await page.fill('#exName', '스쿼트');
  await page.click('#perSetToggle');
  await page.click('#perSetToggle');
  await page.fill('#exWeight', '100');
  await page.fill('#exReps', '5');
  await page.fill('#exSets', '2');
  await page.click('#workoutForm button[type=submit]');
  t.eq(await sets(), [[100, 5], [100, 5]], '다시 끄면 모든 세트 같게');

  // ── 다음번엔 지난번 모양대로 자동 채움 ──
  await page.evaluate(() => {
    state.days = {};
    state.days[shiftDate(todayStr(), -3)] = { meals: [], note: '', workouts: [{ id: 'p', name: '벤치프레스',
      sets: [[60, 12], [70, 10], [80, 8]].map(([weight, reps]) => ({ weight, reps, done: true })) }] };
    save(); render();
  });
  await page.fill('#exName', '');
  await page.fill('#exName', '벤치프레스');
  await wait(page, 80);
  t.eq(await rows(), [['60', '12'], ['70', '10'], ['80', '8']], '지난번이 피라미드면 그 모양 그대로 표를 채움');
  t.eq(await page.inputValue('#exSets'), '3', '세트 수도 지난번대로');
  t.ok((await text(page, '#exHint')).includes('세트마다 다르게 채웠어요'), '그렇게 채웠다고 알려줌');
  t.ok(!(await text(page, '#exHint')).includes('💪'), '횟수가 줄어든 피라미드는 "다 채웠다"로 보지 않음 (무게를 멋대로 안 올림)');
  await fillRow(0, 65, 12);
  await page.fill('#exName', '벤치프레스 ');
  await wait(page, 80);
  t.eq((await rows())[0], ['65', '12'], '표를 직접 고쳤으면 이름을 다시 쳐도 안 덮어씀');
  await page.click('#workoutForm button[type=submit]');
  t.eq(await sets(), [[65, 12], [70, 10], [80, 8]], '고친 값 그대로 저장');

  // ── 무게만 올리는 방식을 다 채웠으면: 세트마다 한 단위씩 ──
  await page.evaluate(() => {
    state.days = {};
    state.days[shiftDate(todayStr(), -3)] = { meals: [], note: '', workouts: [{ id: 'a', name: '레그프레스',
      sets: [[100, 10], [120, 10], [140, 10]].map(([weight, reps]) => ({ weight, reps, done: true })) }] };
    save(); render();
  });
  await page.fill('#exName', '레그프레스');
  await wait(page, 80);
  t.eq(await rows(), [['102.5', '10'], ['122.5', '10'], ['142.5', '10']], '다 채웠으면 세트마다 +2.5kg로 채움');
  t.ok((await text(page, '#exHint')).includes('세트마다 +2.5kg'), '제안도 "첫 세트 무게"가 아니라 "세트마다"로');
  await page.fill('#exName', '');

  // ── 루틴: 횟수 모양은 저장, 무게는 최근 기록에서 세트마다 (올리지 않음) ──
  await page.evaluate(() => {
    state.days = {};
    state.days[todayStr()] = { meals: [], note: '', workouts: [{ id: 'r', name: '벤치프레스',
      sets: [[60, 12], [70, 10], [80, 8]].map(([weight, reps]) => ({ weight, reps, done: true })) }] };
    state.profile.routines = {}; save(); render();
  });
  answer = '피라미드 날';
  await page.click('#saveRoutineBtn');
  const saved = await page.evaluate(() => state.profile.routines['피라미드 날'][0]);
  t.eq([saved.sets, saved.reps, 'weight' in saved], [3, [12, 10, 8], false], '루틴엔 세트 수와 횟수 모양만 (무게는 저장 안 함)');
  await page.evaluate(() => { currentDate = shiftDate(todayStr(), 1); render(); });
  await page.click('[data-load-routine]');
  t.eq(await sets(0), [[60, 12], [70, 10], [80, 8]], '불러오면 최근 기록의 세트별 무게 그대로 (루틴은 멋대로 안 올림)');
  await page.evaluate(() => { state.profile.routines['예전 루틴'] = [{ name: '벤치프레스', sets: 2, reps: 10, minutes: null }]; day().workouts = []; save(); render(); });
  await page.click('[data-load-routine="예전 루틴"]');
  t.eq(await sets(0), [[60, 10], [70, 10]], '예전 형식 루틴(횟수 숫자 하나)도 그대로 불러옴');

  // ── 계획에서 한 줄 추가: 지난번 모양 + 다 채웠으면 올림 ──
  await page.evaluate(() => {
    day().workouts = []; day().plan = '피라미드 날'; save(); render();
  });
  await page.locator('[data-plan-add]').first().click();
  t.eq(await sets(0), [[60, 12], [70, 10], [80, 8]], '계획에서 추가해도 세트별 무게 (피라미드는 안 올림)');

  // ── 집중 모드: 세트마다 다른 값은 서로 안 따라감 ──
  await page.evaluate(() => { currentDate = todayStr(); render(); });
  await page.evaluate(() => { day().workouts[0].sets.forEach((s) => { s.done = false; }); save(); render(); });
  await page.click('#focusBtn');
  await page.click('[data-focus-step="weight:1"]');
  t.eq(await sets(0), [[62.5, 12], [70, 10], [80, 8]], '1세트 무게를 올려도 무게가 다른 2·3세트는 그대로');
  await page.click('#focusClose');

  // ── 휴대폰 화면 ──
  for (const w of [375, 320]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.fill('#exName', '');
    await page.fill('#exName', '데드리프트');
    await page.click('#perSetToggle');
    const r = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - innerWidth,
      small: [...document.querySelectorAll('#perSetBox input, #perSetToggle')].filter((x) => x.getBoundingClientRect().height < 40).length,
      font: Math.min(...[...document.querySelectorAll('#perSetBox input')].map((x) => parseFloat(getComputedStyle(x).fontSize))),
    }));
    t.ok(r.over <= 0, `${w}px 가로 스크롤 없음`);
    t.eq(r.small, 0, `${w}px 세트별 칸·버튼 40px 이상`);
    t.ok(r.font >= 16, `${w}px 입력칸 16px 이상 (아이폰 확대 방지)`);
    await page.click('#perSetToggle');
  }
  t.noErrors(page);
}
