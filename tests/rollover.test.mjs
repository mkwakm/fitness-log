// 앱을 열어 둔 채 날이 바뀌었을 때 (휴대폰은 앱을 닫지 않고 두었다가 다음 날 다시 여는 일이 잦다)
// 예전엔 화면이 어제에 머물러 오늘 운동이 어제 날짜로 들어가고, "오늘"에만 뜨는 ⏱ 휴식 버튼이 사라졌다.
import { text, wait } from './lib.mjs';

const KST = { timezoneId: 'Asia/Seoul' };
const at = (s) => ({ time: new Date(`${s}+09:00`) });
const resume = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const addEx = async (page, name) => {
  await page.fill('#exName', name);
  await page.dispatchEvent('#exName', 'input');
  await page.click('#workoutForm button[type=submit]');
  await wait(page, 100);
};

export default async function (t) {
  // ── 어제를 오늘로 보고 있었으면 오늘로 ──
  let page = await t.open({ context: KST, clock: at('2026-11-03T23:50:00') });
  await addEx(page, '스쿼트');
  t.eq(await page.evaluate(() => [currentDate, !$('#restFab').hidden]), ['2026-11-03', true], '밤 11시 50분: 오늘(11/03) 운동, ⏱ 버튼');
  await page.clock.fastForward('09:00:00');
  await resume(page);
  t.eq(await page.evaluate(() => [currentDate, $('#date').value]), ['2026-11-04', '2026-11-04'], '다음 날 앱으로 돌아오면 오늘(11/04)로');
  t.ok(!(await page.$eval('#datePill', (e) => e.hidden)), '날짜가 바뀐 걸 알려줌');
  await addEx(page, '벤치프레스');
  t.eq(await page.evaluate(() => Object.fromEntries(Object.entries(state.days).filter(([, d]) => d.workouts.length).map(([k, d]) => [k, d.workouts.map((w) => w.name)]))),
    { '2026-11-03': ['스쿼트'], '2026-11-04': ['벤치프레스'] }, '오늘 넣은 운동은 오늘 날짜로 (예전엔 어제로 들어갔다)');
  t.ok(await page.evaluate(() => !$('#restFab').hidden), '⏱ 휴식 버튼도 그대로 보임');
  t.noErrors(page);

  // ── 일부러 지난 날짜를 보고 있었으면 그대로 ──
  page = await t.open({ context: KST, clock: at('2026-11-03T23:50:00') });
  await page.evaluate(() => { currentDate = '2026-11-01'; render(); });
  await page.clock.fastForward('09:00:00');
  await resume(page);
  t.eq(await page.evaluate(() => currentDate), '2026-11-01', '지난 날짜를 정리하던 중이면 안 옮김');
  await page.clock.fastForward('24:00:00');
  await resume(page);
  t.eq(await page.evaluate(() => currentDate), '2026-11-01', '하루 더 지나도 그대로');

  // ── 자정을 넘겨 운동하는 중이면 그 날 그대로, 끝나고 다시 돌아오면 오늘로 ──
  page = await t.open({ context: KST, clock: at('2026-11-03T23:30:00') });
  await addEx(page, '데드리프트');
  await page.evaluate(() => toggleSession());          // 운동 시간 재는 중
  await page.clock.fastForward('40:00');
  await resume(page);
  t.eq(await page.evaluate(() => currentDate), '2026-11-03', '00:10 운동 시간 재는 중이면 어제(운동 시작한 날) 그대로');
  t.ok(await page.evaluate(() => { render(); return !$('#restFab').hidden; }), '자정을 넘겨도 운동 중이면 ⏱ 버튼');
  await page.evaluate(() => { day().workouts[0].sets[0].done = true; day().workouts[0].sets[0].doneAt = Date.now(); toggleSession(); save(); render(); });
  t.ok(await page.evaluate(() => !$('#restFab').hidden), '운동 시간을 끝내도 3시간 안에 세트를 끝낸 날이면 ⏱ 버튼');
  await page.clock.fastForward('03:10:00');
  await page.evaluate(() => render());
  t.ok(await page.evaluate(() => $('#restFab').hidden), '3시간이 지나면 지난 날의 ⏱ 버튼은 안 보임');
  await resume(page);
  t.eq(await page.evaluate(() => currentDate), '2026-11-04', '운동이 끝난 뒤 돌아오면 오늘로');

  // 휴식 중에도 안 옮김
  page = await t.open({ context: KST, clock: at('2026-11-03T23:58:00') });
  await addEx(page, '바벨로우');
  await page.evaluate(() => { day().workouts[0].rest = 300; save(); render(); });
  await page.click('#restFab');                           // 5분 휴식
  await page.clock.fastForward('03:00');                 // 00:01, 휴식은 아직 2분 남음
  t.ok(await page.evaluate(() => !!restEndAt), '00:01 휴식이 아직 도는 중');
  await resume(page);
  t.eq(await page.evaluate(() => currentDate), '2026-11-03', '휴식이 도는 중이면 안 옮김');
  await page.evaluate(() => stopRest());
  await resume(page);
  t.eq(await page.evaluate(() => currentDate), '2026-11-04', '휴식이 끝나고 돌아오면 오늘로');
  t.noErrors(page);
}
