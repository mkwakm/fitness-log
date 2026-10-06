// 워밍업 세트 (set.warmup): 폼에서 세트 번호를 눌러 표시, 카드의 "+ 워밍업", 볼륨·세트 수·최고 기록·과부하에서 빠짐,
// 시간(칼로리) 추정엔 들어감, 다음번엔 워밍업 모양 그대로(워밍업 무게는 안 올림), 집중 모드 표시.
import { tab, text, wait } from './lib.mjs';

export default async function (t) {
  const page = await t.open();
  await tab(page, 'workouts');
  const w0 = () => page.evaluate(() => day().workouts.at(-1));

  // ── 폼: 세트 번호를 누르면 워밍업 ──
  await page.fill('#exName', '스쿼트');
  await page.fill('#exSets', '4');
  await page.dispatchEvent('#exSets', 'input');
  t.ok((await text(page, '#perSetBox')).includes('세트 번호 → 워밍업'), '폼에 워밍업·드롭 안내가 보임');
  await page.click('[data-psw="0"]');
  t.eq(await page.evaluate(() => [...document.querySelectorAll('#perSetBox .perset-no')].map((b) => b.textContent)),
    ['워밍업', '1세트', '2세트', '3세트'], '누르면 "워밍업"으로, 본 세트 번호는 1부터 다시');
  const fill = async (i, w, r) => { await page.fill(`[data-ps="${i}:weight"]`, String(w)); await page.fill(`[data-ps="${i}:reps"]`, String(r)); };
  await fill(0, 60, 10); await fill(1, 100, 5); await fill(2, 100, 5); await fill(3, 100, 5);
  await page.click('#workoutForm button[type=submit]');
  let w = await w0();
  t.eq(w.sets.map((s) => !!s.warmup), [true, false, false, false], '워밍업 표시가 저장됨');

  // ── 집계에서 빠짐 ──
  t.eq(await page.evaluate(() => volumeOf(day().workouts.at(-1))), 1500, '볼륨은 본 세트만 (100×5×3, 워밍업 60×10은 빠짐)');
  t.ok((await text(page, '#workoutSummary')).includes('3세트'), '오늘 요약 세트 수도 본 세트만');
  t.eq(await page.evaluate(() => minutesOf(day().workouts.at(-1)) / MIN_PER_SET), 4, '시간 추정엔 워밍업도 들어감 (실제로 시간이 드니까)');
  t.eq(await page.evaluate(() => [...document.querySelectorAll('#workoutList .set-no')].map((b) => b.textContent.trim())), ['W', '1', '2', '3'], '카드 세트 번호: W, 1, 2, 3');
  await page.click('[data-toggle$=":0"]');
  t.eq(await page.evaluate(() => volumeOf(day().workouts.at(-1))), 1500, '워밍업만 완료해도 볼륨에 안 들어감');
  t.ok(!(await text(page, '#workoutList')).includes('1/3세트 완료'), '완료 세트 수에도 워밍업은 안 셈');

  // ── 최고 기록·과부하 제안은 본 세트로 ──
  await page.evaluate(() => {
    state.days = {};
    state.days[shiftDate(todayStr(), -2)] = { meals: [], note: '', workouts: [{ id: 'b', name: '벤치프레스', sets: [
      { weight: 40, reps: 12, done: true, warmup: true }, { weight: 60, reps: 8, done: true, warmup: true },
      { weight: 80, reps: 8, done: true }, { weight: 80, reps: 8, done: true }, { weight: 80, reps: 8, done: true }] }] };
    save(); render();
  });
  t.eq(await page.evaluate(() => personalBest('벤치프레스').weight), 80, '최고 기록은 본 세트');
  const tip = await page.evaluate(() => overloadTip('벤치프레스'));
  t.eq([tip?.from, tip?.to, tip?.varied], [80, 82.5, false], '과부하 제안은 본 세트 기준 (워밍업 12회가 "목표 횟수"로 잡히지 않음)');

  // ── 다음번: 워밍업 모양 그대로, 워밍업 무게는 안 올림 ──
  await page.fill('#exName', '벤치프레스');
  await wait(page, 80);
  t.eq(await page.evaluate(() => perSet.map((s) => [s.weight, s.reps, !!s.warmup])),
    [[40, 12, true], [60, 8, true], [82.5, 8, false], [82.5, 8, false], [82.5, 8, false]], '지난번 워밍업 2개 + 본 세트 3개, 올리는 건 본 세트만');
  t.eq(await page.evaluate(() => [...document.querySelectorAll('#perSetBox .perset-no')].map((b) => b.textContent)),
    ['워밍업', '워밍업', '1세트', '2세트', '3세트'], '폼에도 워밍업으로 보임');
  t.ok((await text(page, '#exHint')).includes('W40kg×12, W60×8, 80×8'), '지난번 줄에 W 표시');
  await page.fill('#exSets', '6');
  await page.dispatchEvent('#exSets', 'input');
  t.eq(await page.evaluate(() => !!perSet[5].warmup), false, '세트를 늘리면 본 세트로 늘어남');

  // ── 카드: + 워밍업 ──
  await page.evaluate(() => { day().workouts = [{ id: 'd', name: '데드리프트', sets: [{ weight: 140, reps: 5, done: false }, { weight: 140, reps: 5, done: false }] }]; save(); render(); });
  await page.click('[data-add-warmup="d"]');
  w = await w0();
  t.eq(w.sets.map((s) => [s.weight, !!s.warmup]), [[70, true], [140, false], [140, false]], '+ 워밍업: 본 세트 앞에 절반 무게로');
  await page.click('[data-add-warmup="d"]');
  w = await w0();
  t.eq(w.sets.map((s) => [s.weight, !!s.warmup]), [[70, true], [105, true], [140, false], [140, false]], '한 번 더: 직전 워밍업과 본 세트의 가운데, 본 세트 바로 앞에');
  await page.click('[data-add-set="d"]');
  t.eq(!!(await w0()).sets.at(-1).warmup, false, '+ 세트 추가는 본 세트로');

  // ── 집중 모드 ──
  await page.evaluate(() => stopRest());
  await page.click('#focusBtn');
  t.ok((await text(page, '#focusSheet .focus-set')).startsWith('워밍업'), '집중 모드에 "워밍업"으로 보임');
  await page.click('#focusSheet [data-focus-done]');
  await page.click('#focusSheet [data-focus-rest="skip"]').catch(() => {});
  await page.click('#focusSheet [data-focus-done]');
  await page.click('#focusSheet [data-focus-rest="skip"]').catch(() => {});
  t.ok((await text(page, '#focusSheet .focus-set')).startsWith('1세트'), '워밍업 다음은 "1세트"');
  await page.click('#focusClose');

  // ── 휴대폰 화면 ──
  await page.fill('#exName', '벤치프레스');
  await wait(page, 80);
  for (const vw of [375, 320]) {
    await page.setViewportSize({ width: vw, height: 800 });
    const r = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - innerWidth,
      small: [...document.querySelectorAll('#perSetBox .perset-no, [data-add-warmup]')].filter((x) => x.getBoundingClientRect().height < 40).length,
    }));
    t.ok(r.over <= 0, `${vw}px 가로 스크롤 없음`);
    t.eq(r.small, 0, `${vw}px 워밍업 버튼 40px 이상`);
  }
  t.noErrors(page);
}
