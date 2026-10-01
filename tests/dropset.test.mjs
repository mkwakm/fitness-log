// 드롭세트: 한 세트 안에 무게·횟수 여러 개 (set.drops). 카드·집중 모드에서 붙이고 고치고 지우기,
// 볼륨·세트 수·최고 기록, 다음번 자동 채움, 세트 추가·복사, 망가진 값, 휴대폰 화면.
import { tab, text, wait, ago, addWorkout } from './lib.mjs';

export default async function (t) {
  const page = await t.open({ dialog: (d) => d.accept() });
  await tab(page, 'workouts');
  const sets = () => page.evaluate(() => day().workouts.at(-1).sets.map((s) => ({ w: s.weight, r: s.reps, drops: s.drops ?? null })));

  await addWorkout(page, '덤벨컬', { sets: 3, weight: 15, reps: 10 });
  t.ok(await page.locator('[data-drop-add]').first().isVisible(), '운동 카드에 "↘ 드롭" 버튼');

  // ── 방금 완료한 세트에 붙는다 ──
  await page.click('[data-toggle$=":1"]');               // 2세트 완료
  await page.click('[data-drop-add]');
  let s = await sets();
  t.eq(s[1].drops, [{ weight: 12.5, reps: 10 }], '방금 완료한 2세트에 붙음 (무게 80% → 2.5kg 단위, 횟수 그대로)');
  t.eq([s[0].drops, s[2].drops], [null, null], '다른 세트는 그대로');
  t.eq(await page.locator('.set-row.drop').count(), 1, '2세트 아래에 드롭 줄이 생김');
  await page.click('[data-drop-add]');
  s = await sets();
  t.eq(s[1].drops[1], { weight: 10, reps: 10 }, '한 번 더 누르면 직전 드롭에서 또 내림');

  // ── 고치기·지우기 ──
  await page.fill('[data-drop-edit$=":1:0:reps"]', '8');
  await page.dispatchEvent('[data-drop-edit$=":1:0:reps"]', 'change');
  await page.fill('[data-drop-edit$=":1:1:weight"]', '7.5');
  await page.dispatchEvent('[data-drop-edit$=":1:1:weight"]', 'change');
  await page.fill('[data-drop-edit$=":1:1:reps"]', '6');
  await page.dispatchEvent('[data-drop-edit$=":1:1:reps"]', 'change');
  await wait(page, 100);
  s = await sets();
  t.eq(s[1].drops, [{ weight: 12.5, reps: 8 }, { weight: 7.5, reps: 6 }], '드롭 무게·횟수를 고침');
  await page.fill('[data-drop-edit$=":1:1:reps"]', '-5');
  await page.dispatchEvent('[data-drop-edit$=":1:1:reps"]', 'change');
  await wait(page, 100);
  t.eq((await sets())[1].drops[1].reps, 0, '음수는 0으로');
  await page.fill('[data-drop-edit$=":1:1:reps"]', '6');
  await page.dispatchEvent('[data-drop-edit$=":1:1:reps"]', 'change');
  await wait(page, 100);

  // ── 집계: 세트 수는 그대로, 볼륨엔 드롭까지 ──
  const vol = await page.evaluate(() => volumeOf(day().workouts.at(-1)));
  t.eq(vol, 15 * 10 + 12.5 * 8 + 7.5 * 6, '볼륨 = 완료한 세트의 본 무게 + 드롭 (완료 체크한 세트만)');
  t.ok((await text(page, '#workoutSummary')).includes('1/3세트'), '드롭은 세트 수에 안 들어감');
  t.eq(await page.evaluate(() => setsText(day().workouts.at(-1))), '15kg×10, 15×10↘12.5×8↘7.5×6, 15×10', '짧은 글: 세트 안에 ↘로 이어 씀');
  t.eq(await page.evaluate(() => personalBest('덤벨컬').weight), 15, '최고 기록은 본 세트 무게로 (드롭은 가벼워서)');

  await page.click('[data-drop-del$=":1:1"]');
  s = await sets();
  t.eq(s[1].drops, [{ weight: 12.5, reps: 8 }], '✕로 그 드롭만 지움');
  await page.click('[data-drop-del$=":1:0"]');
  s = await sets();
  t.eq(s[1].drops, null, '다 지우면 보통 세트로 돌아감');

  // ── 아무 세트도 완료 안 했으면 마지막 세트에 ──
  await addWorkout(page, '레그익스텐션', { sets: 2, weight: 50, reps: 12 });
  await page.locator('[data-drop-add]').last().click();
  s = await sets();
  t.eq([s[0].drops, s[1].drops], [null, [{ weight: 40, reps: 12 }]], '완료한 세트가 없으면 마지막 세트에');
  await page.locator('[data-add-set]').last().click();
  t.eq((await sets())[2].drops, [{ weight: 40, reps: 12 }], '+ 세트 추가는 마지막 세트의 드롭 모양도 따라감');

  // ── 다음번: 지난번 드롭 모양대로 채움 ──
  await page.evaluate(() => {
    state.days = {};
    state.days[shiftDate(todayStr(), -2)] = { meals: [], note: '', workouts: [{ id: 'd', name: '랫풀다운',
      sets: [{ weight: 50, reps: 10, done: true }, { weight: 50, reps: 10, done: true, drops: [{ weight: 40, reps: 8 }, { weight: 30, reps: 6 }] }] }] };
    save(); render();
  });
  await page.fill('#exName', '랫풀다운');
  await wait(page, 80);
  t.ok((await text(page, '#perSetBox')).includes('↘ 40kg×8'), '운동 폼에 지난번 드롭이 보임');
  t.ok((await text(page, '#exHint')).includes('50×10↘40×8↘30×6'), '지난번 줄에도 드롭');
  await page.click('#workoutForm button[type=submit]');
  s = await sets();
  t.eq(s[1].drops, [{ weight: 40, reps: 8 }, { weight: 30, reps: 6 }], '추가하면 지난번 드롭 모양 그대로 (무게를 멋대로 안 올림)');
  t.eq(s[0].drops, null, '드롭 없던 세트는 그대로');
  t.ok((await page.locator('#workoutList .card').last().textContent()).includes('↘'), '카드의 "지난번" 줄에도 ↘');

  // ── 지난 운동 불러오기에도 ──
  await page.evaluate(() => { currentDate = shiftDate(todayStr(), 1); render(); });
  await page.evaluate(() => {
    const src = shiftDate(todayStr(), -2);
    document.body.insertAdjacentHTML('beforeend', `<button id="cp" data-copy-day="${src}"></button>`);
  });
  await page.click('#cp');
  t.eq((await sets())[1].drops?.length, 2, '지난 운동 통째로 불러와도 드롭이 따라옴');

  // ── 집중 모드: 지금 세트에 바로 붙이기 ──
  await page.evaluate(() => { currentDate = todayStr(); day().workouts = [{ id: 'f', name: '체스트프레스', sets: [{ weight: 40, reps: 10, done: false }, { weight: 40, reps: 10, done: false }] }]; save(); render(); });
  await page.evaluate(() => stopRest());
  await page.click('#focusBtn');
  await page.click('#focusSheet [data-drop-add]');
  t.eq((await sets())[0].drops, [{ weight: 32.5, reps: 10 }], '집중 모드 "↘ 드롭 추가"는 지금 세트에');
  t.eq(await page.locator('#focusSheet .set-row.drop').count(), 1, '집중 모드에 드롭 줄이 보임');
  await page.fill('#focusSheet [data-drop-edit$=":0:0:reps"]', '7');
  await page.dispatchEvent('#focusSheet [data-drop-edit$=":0:0:reps"]', 'change');
  await wait(page, 100);
  t.eq((await sets())[0].drops[0].reps, 7, '집중 모드에서 드롭 횟수 고침');
  await page.click('#focusSheet [data-focus-done]');
  await wait(page, 100);
  t.eq(await page.evaluate(() => volumeOf(day().workouts[0])), 40 * 10 + 32.5 * 7, '완료하면 드롭까지 볼륨에');
  // 완료하고 나서 드롭을 했으면: 휴식 화면에서 방금 세트에 붙이고, 휴식은 지금부터 다시
  t.ok(await page.locator('#focusSheet .focus-rest').isVisible(), '세트를 완료하면 휴식 화면');
  t.eq(await page.locator('#focusSheet .set-row.drop').count(), 1, '휴식 화면에 방금 세트의 드롭이 보임 (바로 고칠 수 있게)');
  await page.evaluate(() => { restEndAt = Date.now() + 5000; day().workouts[0].sets[0].doneAt = Date.now() - 60000; });
  await page.click('#focusSheet [data-drop-add="last"]');
  await wait(page, 100);
  const after = await page.evaluate(() => ({ drops: day().workouts[0].sets[0].drops, left: restLeft(), fresh: Date.now() - day().workouts[0].sets[0].doneAt < 5000 }));
  t.eq(after.drops, [{ weight: 32.5, reps: 7 }, { weight: 25, reps: 7 }], '휴식 화면 "방금 세트에 드롭"은 방금 완료한 세트에 이어 붙음');
  t.ok(after.left > 30 && after.fresh, '드롭을 붙이면 휴식을 지금부터 다시 셈');
  await page.click('#focusClose');

  // ── 망가진 값이 넘어와도 ──
  await page.evaluate(() => {
    day().workouts = [{ id: 'x', name: '이상한운동', sets: [{ weight: 20, reps: 5, drops: 'x' }, { weight: 20, reps: 5, drops: [null, 3, { weight: -10, reps: 4 }] }] }];
    save(); render();
  });
  t.eq(await page.evaluate(() => volumeOf(day().workouts[0])), 200, '드롭이 망가져 있어도 볼륨은 멀쩡 (음수 무게는 0)');
  t.eq(await page.locator('#workoutList .set-row.drop').count(), 1, '이상한 값은 빼고 그림');

  // ── 동기화: 드롭이 다른 기기로 넘어감 ──
  const merged = await page.evaluate(() => {
    const theirs = JSON.parse(JSON.stringify(state));
    const d = theirs.days[todayStr()];
    d.workouts.push({ id: 'y', name: '케이블컬', sets: [{ weight: 20, reps: 10, done: true, drops: [{ weight: 15, reps: 8 }] }] });
    d.updatedAt = Date.now() + 1000;
    mergeState(theirs);
    return day().workouts.find((w) => w.id === 'y')?.sets[0].drops;
  });
  t.eq(merged, [{ weight: 15, reps: 8 }], '병합해도 드롭이 남음');

  // ── 휴대폰 화면 ──
  await page.evaluate(() => {
    day().workouts = [{ id: 'm', name: '벤치프레스', sets: [{ weight: 100, reps: 8, done: true, drops: [{ weight: 80, reps: 6 }, { weight: 60, reps: 6 }] }] }];
    save(); render();
  });
  for (const w of [375, 320]) {
    await page.setViewportSize({ width: w, height: 800 });
    const r = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - innerWidth,
      small: [...document.querySelectorAll('#workoutList .set-row.drop input, #workoutList .set-row.drop button, #workoutList [data-drop-add]')].filter((x) => x.getBoundingClientRect().height < 40).length,
      font: Math.min(...[...document.querySelectorAll('#workoutList .set-row.drop input')].map((x) => parseFloat(getComputedStyle(x).fontSize))),
    }));
    t.ok(r.over <= 0, `${w}px 가로 스크롤 없음`);
    t.eq(r.small, 0, `${w}px 드롭 칸·버튼 40px 이상`);
    t.ok(r.font >= 16, `${w}px 드롭 입력칸 16px 이상 (아이폰 확대 방지)`);
  }
  t.noErrors(page);
}
