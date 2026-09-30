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

  // ── 기본은 세트별 표 ──
  t.ok(await page.locator('#perSetBox').isVisible(), '처음부터 세트별 표가 보임 (기본)');
  t.eq(await rows(), [['', '10'], ['', '10'], ['', '10']], '빈 표 3세트 (횟수 10)');
  t.ok(await page.locator('#exWeight').isHidden(), '한 칸짜리 중량 칸은 숨김');
  t.eq(await text(page, '#perSetToggle'), '모든 세트 같게', '"모든 세트 같게"는 표 아래 작은 보조 버튼');
  const order = await page.evaluate(() => $('#perSetBox').compareDocumentPosition($('#perSetToggle')) & Node.DOCUMENT_POSITION_FOLLOWING);
  t.ok(order, '버튼이 표 아래에 있음');
  await page.fill('#exName', '벤치프레스');
  await fillRow(0, 60, 12);
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
  t.ok(await page.locator('#perSetBox').isVisible(), '추가하고 나도 다음 운동은 다시 세트별 표');
  t.eq(await rows(), [['', '10'], ['', '10'], ['', '10']], '표는 빈 3세트로 돌아감');
  const cardRows = await page.locator('#workoutList .card').last().locator('[data-edit$=":weight"]').evaluateAll((els) => els.map((e) => e.value));
  t.eq(cardRows, ['60', '70', '80'], '카드에도 세트마다 다른 무게');

  // ── 보조: 모든 세트 같게 ──
  await page.fill('#exName', '스쿼트');
  await fillRow(0, 100, 5);
  await page.click('#perSetToggle');
  t.ok(await page.locator('#perSetBox').isHidden() && await page.locator('#exWeight').isVisible(), '누르면 한 칸짜리 중량·횟수로');
  t.eq([await page.inputValue('#exWeight'), await page.inputValue('#exReps')], ['100', '5'], '표의 1세트 값을 옮겨 옴');
  t.eq(await text(page, '#perSetToggle'), '세트마다 다르게 적기', '다시 표로 돌아가는 버튼');
  await page.fill('#exSets', '2');
  await page.click('#workoutForm button[type=submit]');
  t.eq(await sets(), [[100, 5], [100, 5]], '모든 세트 같게 저장');
  t.ok(await page.locator('#perSetBox').isVisible(), '추가하고 나면 다시 기본(세트별 표)');
  await page.fill('#exName', '레그프레스');
  await page.click('#perSetToggle');
  await page.fill('#exWeight', '140');
  await page.fill('#exReps', '12');
  await page.click('#perSetToggle');
  t.eq(await rows(), [['140', '12'], ['140', '12'], ['140', '12']], '한 칸에 적던 값은 표로 돌아와도 따라옴');
  await page.reload();                 // 폼을 새로 (직접 만진 표는 운동을 추가하기 전까지 그대로 두므로)
  await page.waitForSelector('#mealList', { state: 'attached' });
  await tab(page, 'workouts');

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
  t.ok((await text(page, '#exHint')).includes('지난번 세트대로 채웠어요'), '그렇게 채웠다고 알려줌');
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
    const r = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - innerWidth,
      small: [...document.querySelectorAll('#perSetBox input, #perSetToggle')].filter((x) => x.getBoundingClientRect().height < 40).length,
      font: Math.min(...[...document.querySelectorAll('#perSetBox input')].map((x) => parseFloat(getComputedStyle(x).fontSize))),
    }));
    t.ok(r.over <= 0, `${w}px 가로 스크롤 없음`);
    t.eq(r.small, 0, `${w}px 세트별 칸·버튼 40px 이상`);
    t.ok(r.font >= 16, `${w}px 입력칸 16px 이상 (아이폰 확대 방지)`);
  }
  t.noErrors(page);
}
